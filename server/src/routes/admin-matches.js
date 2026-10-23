// ============================================================
// One match, for the admin site's match page: the score, who played,
// every point, and its video when it has one. A manager reads only
// their own facility's matches; the owner reads any.
// ============================================================

import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { bucketConfig, deleteFile } from '../bucket.js'
import { recordActivity } from '../admin-activity.js'
import { matchLabel } from '../overview-store.js'
import { requireAdminAccount } from '../auth.js'
import { facilityFilterFor } from '../facility-rules.js'
import { deriveMatchState } from '../pickleball.js'
import { matchPagePoints, pageMatch } from '../match-page.js'
import { pointVideo } from '../point-video.js'
import { isUuid } from '../validate.js'

const router = Router()
router.use(requireAdminAccount(query))

const NO_MATCH = { error: 'No such match' }

/** The match, if it exists, its session is not voided, and this admin may see its facility. */
async function matchInScope(req) {
  if (!isUuid(req.params.id)) return null
  const { rows } = await query(
    `SELECT m.id, m.team_a, m.team_b, m.first_server_team, m.first_server_player, m.right_start_a, m.right_start_b,
            m.point_target, m.status, m.winner, m.started_at, m.ended_at, m.ended_early, m.clock_offset_ms,
            m.voided_at, m.void_reason, m.recorded_by, u.name AS umpire_name,
            s.name AS session_name, s.facility_id, f.name AS facility_name
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
       LEFT JOIN umpires u ON u.id = m.recorded_by
       LEFT JOIN facilities f ON f.id = s.facility_id
      WHERE m.id = $1 AND s.voided_at IS NULL`,
    [req.params.id],
  )
  const row = rows[0]
  if (!row) return null
  const filter = facilityFilterFor(req.admin, null)
  return filter.all || (filter.id && filter.id === row.facility_id) ? row : null
}

router.get('/:id', async (req, res) => {
  const row = await matchInScope(req)
  if (!row) return res.status(404).json(NO_MATCH)
  const [{ rows: events }, { rows: people }, { rows: held }] = await Promise.all([
    query('SELECT id, type, payload, at FROM match_events WHERE match_id = $1 ORDER BY seq', [row.id]),
    query('SELECT id, name FROM players WHERE id = ANY($1::uuid[])', [[...row.team_a, ...row.team_b]]),
    query('SELECT 1 FROM match_videos WHERE match_id = $1', [row.id]),
  ])
  const log = events.map((e) => ({ type: e.type, ...e.payload }))
  const names = new Map(people.map((p) => [p.id, p.name]))
  const { score } = deriveMatchState({
    teamA: row.team_a, teamB: row.team_b,
    firstServer: { team: row.first_server_team, playerId: row.first_server_player },
    rightStart: { A: row.right_start_a, B: row.right_start_b },
    pointTarget: row.point_target, events: log,
  })
  res.json({
    match: pageMatch(row, {
      points: matchPagePoints(row, log, names),
      video: await pointVideo(row, events, log),
      names, score, hasVideoRow: held.length > 0, isOwner: req.admin.role === 'owner',
    }),
  })
})

router.delete('/:id/video', async (req, res) => {
  const config = bucketConfig()
  if (!config) return res.status(404).json({ error: 'Video is not set up here' })
  if (req.admin.role !== 'owner') return res.status(403).json({ error: 'Only the owner can remove a video' })
  const row = await matchInScope(req)
  if (!row) return res.status(404).json(NO_MATCH)
  const { rows } = await query('SELECT file_key FROM match_videos WHERE match_id = $1', [row.id])
  if (!rows[0]) return res.status(404).json({ error: 'This match has no video' })
  // File first, then the row: a row with no file would offer a video that cannot play.
  if (rows[0].file_key) await deleteFile(config, rows[0].file_key)
  await withTransaction(async (client) => {
    const removed = await client.query('DELETE FROM match_videos WHERE match_id = $1', [row.id])
    if (removed.rowCount === 0) return // a second, overlapping removal: the first one records it
    await recordActivity(client, {
      adminId: req.admin.id, action: 'match.video_removed', targetType: 'match', targetId: row.id, facilityId: row.facility_id,
      summary: `Removed the video of ${await matchLabel(client.query.bind(client), row)}`,
    })
  })
  res.status(204).end()
})

export default router
