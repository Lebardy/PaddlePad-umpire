// ============================================================
// Sending a match's video: the steps every camera shares, the umpire
// app's phone in a holder and a player's own phone.
//
// The routes decide WHO may send (routes/video.js, routes/player-video.js).
// What a send must carry, and when it counts as finished, is the same
// for both and lives here.
// ============================================================

import { randomBytes } from 'node:crypto'
import { query } from './db.js'
import { MAX_VIDEO_BYTES, bucketConfig, fileSize, signedUploadForm } from './bucket.js'

// A filming claim whose phone has said nothing for this long may be taken over.
export const CLAIM_SILENT_SECONDS = 60
const MAX_DURATION_MS = 6 * 60 * 60 * 1000
const NOT_FILMING = { status: 409, body: { error: 'This phone is not filming that match' } }
const NOT_ARRIVED = { status: 409, body: { error: 'The video has not arrived in full' } }

/** A phone's own name for itself: text, and not a book. */
export const deviceName = (value) => (typeof value === 'string' && value.length >= 1 && value.length <= 100 ? value : '')

const wholeNumber = (value, max) => Number.isInteger(value) && value >= 1 && value <= max

export async function findVideo(matchId) {
  const { rows } = await query('SELECT * FROM match_videos WHERE match_id = $1', [matchId])
  return rows[0] ?? null
}

/**
 * A camera says what it filmed and asks to send it. Answers
 * `{ status, body }`: the bucket's form, or why not. `holds(video)` is
 * the route's own test that the asker is the one filming this match;
 * the phone must be the same one either way.
 */
export async function startUpload(matchId, body, holds) {
  const { deviceId, bytes, width, height, durationMs, firstFrameAt, repacked } = body ?? {}
  if (Number.isInteger(bytes) && bytes > MAX_VIDEO_BYTES) return { status: 413, body: { error: 'A video can be at most 2 GB' } }
  if (!wholeNumber(bytes, MAX_VIDEO_BYTES) || !wholeNumber(width, 10_000) || !wholeNumber(height, 10_000) ||
      !wholeNumber(durationMs, MAX_DURATION_MS) || !Number.isFinite(firstFrameAt) || Math.abs(firstFrameAt - Date.now()) > 24 * 60 * 60 * 1000) {
    return { status: 400, body: { error: 'The video needs its size, its picture size, its length and when it began' } }
  }

  const video = await findVideo(matchId)
  if (!video || !holds(video) || video.device_id !== String(deviceId ?? '') || video.state === 'ready') return NOT_FILMING
  // Trying again after a failed send reuses the name, so nothing is left behind.
  const key = video.file_key ?? `videos/${matchId}/${randomBytes(8).toString('hex')}.mp4`
  const claimed = await query(
    `UPDATE match_videos
        SET state = 'sending', file_key = $2, bytes = $3, width = $4, height = $5, duration_ms = $6,
            first_frame_at = to_timestamp($7::double precision / 1000), repacked = $8, seen_at = now()
      WHERE match_id = $1 AND device_id = $9`,
    [matchId, key, bytes, width, height, durationMs, firstFrameAt, repacked !== false, video.device_id],
  )
  // The claim was taken over since it was read.
  if (claimed.rowCount === 0) return NOT_FILMING
  return { status: 200, body: { form: signedUploadForm(bucketConfig(), key, { bytes }) } }
}

/** The camera says the file has gone. Believed only once the bucket holds exactly that many bytes. */
export async function finishUpload(matchId, deviceId, holds) {
  const video = await findVideo(matchId)
  if (!video || !holds(video) || video.device_id !== String(deviceId ?? '')) return NOT_FILMING
  if (video.state === 'ready') return { status: 200, body: { ok: true } }
  if (video.state !== 'sending') return NOT_ARRIVED
  // Believe the bucket, not the phone.
  const size = await fileSize(bucketConfig(), video.file_key)
  if (size !== Number(video.bytes)) return NOT_ARRIVED
  const marked = await query(
    `UPDATE match_videos SET state = 'ready', ready_at = now() WHERE match_id = $1 AND device_id = $2 AND state = 'sending'`,
    [matchId, video.device_id],
  )
  if (marked.rowCount === 0) return NOT_FILMING
  return { status: 200, body: { ok: true } }
}
