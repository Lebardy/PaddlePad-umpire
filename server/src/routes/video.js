// ============================================================
// Match video, for the umpire app.
//
// /video/camera/*      the Camera screen's 2-second beat, and what the
//                      scoring tablet's icon shows
// /video/matches/:id*  one match's video: claim it, send it, watch it,
//                      fix its timing, remove it
//
// No video bytes pass through here. The phone sends its file straight
// to the bucket with a form signed by bucket.js, and a viewer plays it
// from the bucket with a link signed there too.
// ============================================================

import { randomBytes } from 'node:crypto'
import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireActiveUmpire, requireAuth } from '../auth.js'
import { isUuid } from '../validate.js'
import { MAX_VIDEO_BYTES, bucketConfig, deleteFile, fileSize, signedReadUrl, signedUploadForm } from '../bucket.js'
import { firstFrameFromLineUp, rallySeconds } from '../video-times.js'
import { cameraStatus, noteBeat } from '../camera-beats.js'

const router = Router()

// Off wherever the bucket is not set up, before anything else is asked.
router.use((req, res, next) => {
  if (!bucketConfig()) return res.status(404).json({ error: 'Video is not set up here' })
  next()
})
router.use(requireAuth, requireActiveUmpire(query))

const BEAT_STATES = ['ready', 'filming', 'sending']
// A filming claim whose phone has said nothing for this long may be taken over.
const CLAIM_SILENT_SECONDS = 60
const MAX_DURATION_MS = 6 * 60 * 60 * 1000

function refusal(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

/**
 * The match, if this umpire scored it at their own facility. Anything
 * else reads as missing, the same as the match routes do.
 */
async function ownMatch(req) {
  if (!isUuid(req.params.id) || !req.umpire.facilityId) return null
  const { rows } = await query(
    `SELECT m.id, m.started_at, m.clock_offset_ms, f.films_matches
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
       JOIN facilities f ON f.id = s.facility_id
      WHERE m.id = $1 AND m.recorded_by = $2 AND s.facility_id = $3`,
    [req.params.id, req.umpire.id, req.umpire.facilityId],
  )
  return rows[0] ?? null
}

async function findVideo(matchId, db = { query }) {
  const { rows } = await db.query('SELECT * FROM match_videos WHERE match_id = $1', [matchId])
  return rows[0] ?? null
}

/** What a watcher is told about a match's video, or null when it has none. */
async function videoAnswer(match, config) {
  const video = await findVideo(match.id)
  if (!video) return null
  const base = { state: video.state, linedUpBy: video.lined_up_by, repacked: video.repacked }
  if (video.state !== 'ready') return base
  const { rows: events } = await query(
    `SELECT id, at FROM match_events WHERE match_id = $1 AND type = 'rally' ORDER BY seq`,
    [match.id],
  )
  const seconds = rallySeconds({
    startedAtMs: new Date(match.started_at).getTime(),
    offsetMs: match.clock_offset_ms,
    firstFrameAtMs: new Date(video.first_frame_at).getTime(),
    durationMs: video.duration_ms,
    rallies: events.map((e) => ({ atMs: new Date(e.at).getTime() })),
  })
  return {
    ...base,
    url: signedReadUrl(config, video.file_key),
    durationMs: video.duration_ms,
    width: video.width,
    height: video.height,
    rallies: events.map((e, index) => ({ id: e.id, second: seconds[index] })),
  }
}

router.post('/camera/beat', async (req, res) => {
  const deviceId = String(req.body?.deviceId ?? '')
  if (!deviceId) return res.status(400).json({ error: 'A deviceId is required' })
  const state = BEAT_STATES.includes(req.body?.state) ? req.body.state : 'ready'
  noteBeat(req.umpire.id, state)
  if (isUuid(req.body?.matchId)) {
    await query(
      `UPDATE match_videos SET seen_at = now() WHERE match_id = $1 AND device_id = $2 AND state = 'filming'`,
      [req.body.matchId, deviceId],
    )
  }

  // Three hours, so a match somebody left open days ago does not start
  // a camera the moment its screen opens.
  const { rows } = await query(
    `SELECT m.id, m.team_a, m.team_b
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
       JOIN facilities f ON f.id = s.facility_id
       LEFT JOIN match_videos v ON v.match_id = m.id
      WHERE m.recorded_by = $1 AND s.facility_id = $2 AND f.films_matches
        AND m.status = 'in_progress' AND m.started_at > now() - interval '3 hours'
        AND (v.match_id IS NULL OR v.source = 'player' OR (v.state = 'filming' AND v.device_id = $3))
      ORDER BY m.started_at DESC
      LIMIT 1`,
    [req.umpire.id, req.umpire.facilityId, deviceId],
  )
  const match = rows[0]
  if (!match) return res.json({ now: Date.now(), match: null })
  const { rows: people } = await query('SELECT id, name FROM players WHERE id = ANY($1::uuid[])', [[...match.team_a, ...match.team_b]])
  const nameOf = new Map(people.map((p) => [p.id, p.name]))
  res.json({
    now: Date.now(),
    match: { id: match.id, teamA: match.team_a.map((id) => nameOf.get(id) ?? ''), teamB: match.team_b.map((id) => nameOf.get(id) ?? '') },
  })
})

router.get('/camera/status', (req, res) => {
  res.json({ camera: cameraStatus(req.umpire.id) })
})

router.post('/matches/:id/claim', async (req, res) => {
  const match = await ownMatch(req)
  if (!match || !match.films_matches) return res.status(404).json({ error: 'No such match' })
  const deviceId = String(req.body?.deviceId ?? '')
  if (!deviceId) return res.status(400).json({ error: 'A deviceId is required' })

  let replacedKey = null
  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT source, state, device_id, file_key, seen_at < now() - make_interval(secs => $2) AS silent
           FROM match_videos WHERE match_id = $1 FOR UPDATE`,
        [match.id, CLAIM_SILENT_SECONDS],
      )
      const held = rows[0]
      if (held && held.source === 'facility') {
        const mine = held.state === 'filming' && held.device_id === deviceId
        if (mine) return
        // A facility's finished or sending video stays; only a filming
        // claim whose phone has gone silent may be taken over.
        if (!(held.state === 'filming' && held.silent)) throw refusal(409, 'This match already has a video')
      }
      // The facility's video is the one kept, so a player's gives way.
      if (held) {
        replacedKey = held.file_key
        await client.query('DELETE FROM match_videos WHERE match_id = $1', [match.id])
      }
      await client.query(
        `INSERT INTO match_videos (match_id, source, umpire_id, device_id) VALUES ($1, 'facility', $2, $3)`,
        [match.id, req.umpire.id, deviceId],
      )
    })
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message })
    throw error
  }
  if (replacedKey) await deleteFile(bucketConfig(), replacedKey).catch((error) => console.error('could not delete a replaced video', error.message))
  res.status(201).json({ ok: true })
})

const wholeNumber = (value, max) => Number.isInteger(value) && value >= 1 && value <= max

router.post('/matches/:id/upload', async (req, res) => {
  const match = await ownMatch(req)
  if (!match) return res.status(404).json({ error: 'No such match' })
  const { deviceId, bytes, width, height, durationMs, firstFrameAt } = req.body ?? {}
  if (Number.isInteger(bytes) && bytes > MAX_VIDEO_BYTES) return res.status(413).json({ error: 'A video can be at most 2 GB' })
  if (!wholeNumber(bytes, MAX_VIDEO_BYTES) || !wholeNumber(width, 10_000) || !wholeNumber(height, 10_000) ||
      !wholeNumber(durationMs, MAX_DURATION_MS) || !Number.isFinite(firstFrameAt) || Math.abs(firstFrameAt - Date.now()) > 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: 'The video needs its size, its picture size, its length and when it began' })
  }

  const video = await findVideo(match.id)
  if (!video || video.source !== 'facility' || video.device_id !== String(deviceId ?? '') || video.state === 'ready') {
    return res.status(409).json({ error: 'This phone is not filming that match' })
  }
  // Trying again after a failed send reuses the name, so nothing is left behind.
  const key = video.file_key ?? `videos/${match.id}/${randomBytes(8).toString('hex')}.mp4`
  await query(
    `UPDATE match_videos
        SET state = 'sending', file_key = $2, bytes = $3, width = $4, height = $5, duration_ms = $6,
            first_frame_at = to_timestamp($7::double precision / 1000), repacked = $8, seen_at = now()
      WHERE match_id = $1`,
    [match.id, key, bytes, width, height, durationMs, firstFrameAt, req.body?.repacked !== false],
  )
  res.json({ form: signedUploadForm(bucketConfig(), key, { bytes }) })
})

router.post('/matches/:id/done', async (req, res) => {
  const match = await ownMatch(req)
  if (!match) return res.status(404).json({ error: 'No such match' })
  const video = await findVideo(match.id)
  if (!video || video.source !== 'facility' || video.device_id !== String(req.body?.deviceId ?? '')) {
    return res.status(409).json({ error: 'This phone is not filming that match' })
  }
  if (video.state === 'ready') return res.json({ ok: true })
  if (video.state !== 'sending') return res.status(409).json({ error: 'The video has not arrived in full' })
  // Believe the bucket, not the phone.
  const size = await fileSize(bucketConfig(), video.file_key)
  if (size !== Number(video.bytes)) return res.status(409).json({ error: 'The video has not arrived in full' })
  await query(`UPDATE match_videos SET state = 'ready', ready_at = now() WHERE match_id = $1`, [match.id])
  res.json({ ok: true })
})

router.get('/matches/:id', async (req, res) => {
  const match = await ownMatch(req)
  if (!match) return res.status(404).json({ error: 'No such match' })
  res.json({ video: await videoAnswer(match, bucketConfig()) })
})

router.post('/matches/:id/line-up', async (req, res) => {
  const match = await ownMatch(req)
  if (!match) return res.status(404).json({ error: 'No such match' })
  const second = Number(req.body?.second)
  const video = await findVideo(match.id)
  if (!video || video.state !== 'ready') return res.status(409).json({ error: 'This match has no video to line up' })
  const { rows } = isUuid(req.body?.eventId)
    ? await query(`SELECT at FROM match_events WHERE id = $1 AND match_id = $2 AND type = 'rally'`, [req.body.eventId, match.id])
    : { rows: [] }
  if (!rows[0] || !Number.isFinite(second) || second < 0 || second * 1000 > video.duration_ms) {
    return res.status(400).json({ error: 'Pick a rally of this match and a moment inside the video' })
  }
  const firstFrame = firstFrameFromLineUp({
    rallyAtMs: new Date(rows[0].at).getTime(), offsetMs: match.clock_offset_ms, videoSecond: second,
  })
  await query(
    `UPDATE match_videos SET first_frame_at = to_timestamp($2::double precision / 1000), lined_up_by = 'umpire' WHERE match_id = $1`,
    [match.id, firstFrame],
  )
  res.json({ video: await videoAnswer(match, bucketConfig()) })
})

router.delete('/matches/:id', async (req, res) => {
  const match = await ownMatch(req)
  if (!match) return res.status(404).json({ error: 'No such match' })
  const video = await findVideo(match.id)
  if (video?.file_key) await deleteFile(bucketConfig(), video.file_key)
  await query('DELETE FROM match_videos WHERE match_id = $1', [match.id])
  res.status(204).end()
})

export default router
