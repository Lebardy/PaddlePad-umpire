// ============================================================
// Match video, for a player's own phone.
//
// /player/video/camera/beat      the camera screen's 2-second beat
// /player/matches/:id/video/*    claim a match, send its video, remove it
//
// Only where the facility does not film: there, any player in a match
// may film it, one phone at a time. Watching is not here: a match's
// video rides on the player's match read (routes/player.js).
//
// No video bytes pass through here.
// ============================================================

import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireActivePlayer, requirePlayer } from '../auth.js'
import { isUuid } from '../validate.js'
import { bucketConfig, deleteFile } from '../bucket.js'
import { CLAIM_SILENT_SECONDS, deviceName, findVideo, finishUpload, startUpload } from '../video-send.js'
import { playerClaimVerdict } from '../claim-rules.js'

const router = Router()

// Mounted on /player beside the player's own routes, so the guards name
// the video paths: nothing else under /player passes through them.
// Off wherever the bucket is not set up, before anything else is asked.
router.use(['/video', '/matches/:id/video'], (req, res, next) => {
  if (!bucketConfig()) return res.status(404).json({ error: 'Video is not set up here' })
  next()
}, requirePlayer, requireActivePlayer(query))

/** The match, if this player is in it. Anything else reads as missing. */
async function ownMatch(req) {
  if (!isUuid(req.params.id)) return null
  const { rows } = await query(
    `SELECT m.id, m.status, COALESCE(f.films_matches, false) AS films_matches, f.name AS facility_name
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
       LEFT JOIN facilities f ON f.id = s.facility_id
      WHERE m.id = $1 AND m.voided_at IS NULL AND s.voided_at IS NULL
        AND (m.team_a @> ARRAY[$2]::uuid[] OR m.team_b @> ARRAY[$2]::uuid[])`,
    [req.params.id, req.player.id],
  )
  return rows[0] ?? null
}

// A player's phone sends only the video that player is filming.
const mine = (req) => (video) => video.source === 'player' && video.player_id === req.player.id

/** Who holds the video of a match this player is in, when it is not this phone: { by, name }, as a refused claim says it. */
async function takenBy(matchId, playerId, deviceId) {
  const { rows } = await query(
    `SELECT v.source, v.player_id, v.device_id, p.name AS holder, f.name AS facility_name
       FROM match_videos v
       JOIN matches m ON m.id = v.match_id
       JOIN sessions s ON s.id = m.session_id
       LEFT JOIN facilities f ON f.id = s.facility_id
       LEFT JOIN players p ON p.id = v.player_id
      WHERE v.match_id = $1 AND (m.team_a @> ARRAY[$2]::uuid[] OR m.team_b @> ARRAY[$2]::uuid[])`,
    [matchId, playerId],
  )
  const held = rows[0]
  if (!held || (held.source === 'player' && held.player_id === playerId && held.device_id === deviceId)) return undefined
  return held.source === 'facility'
    ? { by: 'facility', name: held.facility_name ?? 'The facility' }
    : { by: 'player', name: held.holder ?? 'Another player' }
}

router.post('/video/camera/beat', async (req, res) => {
  const deviceId = deviceName(req.body?.deviceId)
  if (!deviceId) return res.status(400).json({ error: 'A deviceId is required' })
  // A phone that says it is filming a match is told when the match's video
  // is somebody else's now, so it can stop instead of filming for nothing.
  let taken
  if (isUuid(req.body?.matchId)) {
    const kept = await query(
      `UPDATE match_videos SET seen_at = now() WHERE match_id = $1 AND device_id = $2 AND player_id = $3 AND state = 'filming'`,
      [req.body.matchId, deviceId, req.player.id],
    )
    if (kept.rowCount === 0) taken = await takenBy(req.body.matchId, req.player.id, deviceId)
  }

  // The newest match this player is in that is being played now. One
  // that began a while ago is named only while somebody is filming it,
  // so a match left open is not filmed when the next camera opens. The
  // claim, not the beat, says whether this phone may film it.
  const { rows } = await query(
    `SELECT m.id, m.team_a, m.team_b
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
       LEFT JOIN match_videos v ON v.match_id = m.id
      WHERE (m.team_a @> ARRAY[$1]::uuid[] OR m.team_b @> ARRAY[$1]::uuid[])
        AND m.status = 'in_progress' AND m.voided_at IS NULL AND s.voided_at IS NULL
        AND m.started_at > now() - interval '3 hours'
        AND (v.state = 'filming' OR GREATEST(m.started_at, m.scoring_claimed_at) > now() - interval '15 minutes')
      ORDER BY m.started_at DESC
      LIMIT 1`,
    [req.player.id],
  )
  const match = rows[0]
  if (!match) return res.json({ now: Date.now(), match: null, taken })
  const { rows: people } = await query('SELECT id, name FROM players WHERE id = ANY($1::uuid[])', [[...match.team_a, ...match.team_b]])
  const nameOf = new Map(people.map((p) => [p.id, p.name]))
  res.json({
    now: Date.now(),
    match: { id: match.id, teamA: match.team_a.map((id) => nameOf.get(id) ?? ''), teamB: match.team_b.map((id) => nameOf.get(id) ?? '') },
    taken,
  })
})

router.post('/matches/:id/video/claim', async (req, res) => {
  const match = await ownMatch(req)
  if (!match || match.status !== 'in_progress') return res.status(404).json({ error: 'No such match' })
  const deviceId = deviceName(req.body?.deviceId)
  if (!deviceId) return res.status(400).json({ error: 'A deviceId is required' })

  let verdict = 'player'
  let holder = null
  try {
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT v.source, v.state, v.device_id, v.player_id, p.name AS holder,
                v.seen_at < now() - make_interval(secs => $2) AS silent
           FROM match_videos v
           LEFT JOIN players p ON p.id = v.player_id
          WHERE v.match_id = $1
            FOR UPDATE OF v`,
        [match.id, CLAIM_SILENT_SECONDS],
      )
      const held = rows[0] ?? null
      holder = held?.holder ?? null
      verdict = playerClaimVerdict({ filmsMatches: match.films_matches, held, playerId: req.player.id, deviceId })
      if (verdict !== 'take') return
      // A phone that went silent while filming never sent anything, so there is no file to remove.
      if (held) await client.query('DELETE FROM match_videos WHERE match_id = $1', [match.id])
      await client.query(
        `INSERT INTO match_videos (match_id, source, player_id, device_id) VALUES ($1, 'player', $2, $3)`,
        [match.id, req.player.id, deviceId],
      )
    })
  } catch (error) {
    // Two phones claimed a match with no video at the same moment; the other one got there first.
    if (error.code !== '23505') throw error
    verdict = 'player'
  }
  if (verdict === 'take' || verdict === 'mine') return res.status(201).json({ ok: true })
  const covered = verdict === 'facility'
    ? { by: 'facility', name: match.facility_name ?? 'The facility' }
    : { by: 'player', name: holder ?? 'Another player' }
  res.status(409).json({ error: 'This match is already being filmed', covered })
})

router.post('/matches/:id/video/upload', async (req, res) => {
  const match = await ownMatch(req)
  if (!match) return res.status(404).json({ error: 'No such match' })
  const answer = await startUpload(match.id, req.body, mine(req))
  res.status(answer.status).json(answer.body)
})

router.post('/matches/:id/video/done', async (req, res) => {
  const match = await ownMatch(req)
  if (!match) return res.status(404).json({ error: 'No such match' })
  const answer = await finishUpload(match.id, req.body?.deviceId, mine(req))
  res.status(answer.status).json(answer.body)
})

// Only the player who filmed it. Its umpire and the owner remove a video from their own apps.
router.delete('/matches/:id/video', async (req, res) => {
  const match = await ownMatch(req)
  const video = match ? await findVideo(match.id) : null
  if (!video || !mine(req)(video)) return res.status(404).json({ error: 'No such video' })
  if (video.file_key) await deleteFile(bucketConfig(), video.file_key)
  await query('DELETE FROM match_videos WHERE match_id = $1 AND player_id = $2', [match.id, req.player.id])
  res.status(204).end()
})

export default router
