import { Router } from 'express'
import { query } from '../db.js'
import { requireActiveUmpire, requireAuth } from '../auth.js'
import { umpireScope } from '../facility-rules.js'
import { isUuid } from '../validate.js'
import { heldByAnotherDevice } from '../scoring-lease.js'
import { MATCH_OVER, RULING_KINDS, TOO_LATE, rulingProblem } from '../scorekeeper-rules.js'

// ============================================================
// A second umpire taps the score while the match's own umpire watches
// and rules. The scorekeeper's phone stays the only writer of the log;
// rulings wait here until it applies them (see scorekeeper-rules.js).
//
// Not under /matches: GET /matches/:id would read "waiting" as an id.
// ============================================================

const router = Router()
router.use(requireAuth, requireActiveUmpire(query))

/** The match if it is at this umpire's place, else null (another place's match reads as missing). */
async function matchHere(req) {
  if (!isUuid(req.params.matchId)) return null
  const params = [req.params.matchId]
  const scope = umpireScope(req.umpire.facilityId, params, 'sess.facility_id')
  const { rows } = await query(
    `SELECT m.id, m.recorded_by, m.status, m.voided_at, m.scorekeeper_id, m.scorekeeper_state,
            m.scoring_device, m.scoring_claimed_at
       FROM matches m JOIN sessions sess ON sess.id = m.session_id
      WHERE m.id = $1 AND ${scope}`,
    params,
  )
  return rows[0] ?? null
}

const NO_MATCH = { error: 'No such match' }
const playing = (match) => match.status === 'in_progress' && !match.voided_at

router.get('/umpires', async (req, res) => {
  if (!req.umpire.facilityId) return res.json({ umpires: [] })
  const { rows } = await query(
    `SELECT id, name FROM umpires
      WHERE facility_id = $1 AND id <> $2 AND paused_at IS NULL AND closed_at IS NULL
      ORDER BY name`,
    [req.umpire.facilityId, req.umpire.id],
  )
  res.json({ umpires: rows })
})

router.get('/waiting', async (req, res) => {
  const params = [req.umpire.id]
  const scope = umpireScope(req.umpire.facilityId, params, 'sess.facility_id')
  const { rows } = await query(
    `SELECT m.id, m.session_id, m.scorekeeper_state, u.name AS umpire_name, sess.name AS session_name, sess.court
       FROM matches m
       JOIN sessions sess ON sess.id = m.session_id
       LEFT JOIN umpires u ON u.id = m.recorded_by
      WHERE m.scorekeeper_id = $1 AND m.scorekeeper_state IN ('asked', 'scoring')
        AND m.status = 'in_progress' AND m.voided_at IS NULL AND ${scope}
      ORDER BY m.started_at`,
    params,
  )
  res.json({
    matches: rows.map((r) => ({
      id: r.id, sessionId: r.session_id, state: r.scorekeeper_state,
      umpireName: r.umpire_name, sessionName: r.session_name, court: r.court,
    })),
  })
})

router.put('/:matchId', async (req, res) => {
  const match = await matchHere(req)
  if (!match) return res.status(404).json(NO_MATCH)
  if (match.recorded_by !== req.umpire.id) return res.status(403).json({ error: 'Only the umpire running this match can pick its scorekeeper' })
  if (!playing(match)) return res.status(409).json({ error: 'This match is not being played' })
  if (match.scorekeeper_state === 'scoring') return res.status(409).json({ error: 'Take scoring back first' })
  const umpireId = req.body?.umpireId ?? null

  if (umpireId === null) {
    // Withdrawn before they started, so they never scored: forget them.
    await query(`UPDATE matches SET scorekeeper_id = NULL, scorekeeper_state = NULL WHERE id = $1`, [match.id])
    return res.json({ scorekeeper: null })
  }
  if (heldByAnotherDevice(match, String(req.body?.deviceId ?? ''))) {
    return res.status(409).json({ error: 'Another device is scoring this match' })
  }
  if (!isUuid(umpireId) || umpireId === req.umpire.id) return res.status(400).json({ error: 'Pick another umpire at your place' })
  const { rows: [picked] } = await query(
    `SELECT id, name FROM umpires WHERE id = $1 AND facility_id = $2 AND paused_at IS NULL AND closed_at IS NULL`,
    [umpireId, req.umpire.facilityId],
  )
  if (!picked) return res.status(400).json({ error: 'Pick another umpire at your place' })
  await query(
    `UPDATE matches SET scorekeeper_id = $2, scorekeeper_state = 'asked', scorekeeper_seen_at = NULL WHERE id = $1`,
    [match.id, picked.id],
  )
  res.json({ scorekeeper: { id: picked.id, name: picked.name, state: 'asked' } })
})

router.post('/:matchId/answer', async (req, res) => {
  const match = await matchHere(req)
  if (!match) return res.status(404).json(NO_MATCH)
  if (match.scorekeeper_id !== req.umpire.id) return res.status(403).json({ error: 'You were not asked to score this match' })
  const deviceId = String(req.body?.deviceId ?? '')
  if (!deviceId) return res.status(400).json({ error: 'A deviceId is required' })
  const start = req.body?.start === true
  // Guarded on 'asked' so a withdrawn or already-answered request changes nothing.
  const { rowCount } = await query(
    start
      ? `UPDATE matches SET scorekeeper_state = 'scoring', scoring_device = $3, scoring_claimed_at = now(), scorekeeper_seen_at = now()
          WHERE id = $1 AND scorekeeper_id = $2 AND scorekeeper_state = 'asked' AND status = 'in_progress' AND voided_at IS NULL`
      : `UPDATE matches SET scorekeeper_state = 'declined' WHERE id = $1 AND scorekeeper_id = $2 AND scorekeeper_state = 'asked'`,
    start ? [match.id, req.umpire.id, deviceId] : [match.id, req.umpire.id],
  )
  if (!rowCount) return res.status(409).json({ error: 'That request was withdrawn' })
  res.json({ state: start ? 'scoring' : 'declined' })
})

router.post('/:matchId/rulings', async (req, res) => {
  const match = await matchHere(req)
  if (!match) return res.status(404).json(NO_MATCH)
  if (match.recorded_by !== req.umpire.id) return res.status(403).json({ error: 'Only the umpire running this match can rule' })
  const { id, targetEventId, kind } = req.body ?? {}
  if (!isUuid(id) || !isUuid(targetEventId) || !RULING_KINDS.includes(kind)) return res.status(400).json({ error: 'Not a valid ruling' })

  const shape = (r) => ({ id: r.id, targetEventId: r.target_event_id, kind: r.kind, refused: r.refused })
  const answer = (r) => res.status(r.refused ? 409 : 200).json({ error: r.refused ?? undefined, ruling: shape(r) })
  const { rows: [already] } = await query(`SELECT * FROM match_rulings WHERE id = $1 AND match_id = $2`, [id, match.id])
  if (already) return answer(already)
  if (!playing(match)) return res.status(409).json({ error: MATCH_OVER })
  if (match.scorekeeper_state !== 'scoring') return res.status(409).json({ error: 'Nobody is scoring this match for you' })

  // Judged on the log the server has; the scorekeeper's phone judges again
  // on its own (newer) log when it applies the ruling.
  const { rows: events } = await query(`SELECT id, type FROM match_events WHERE match_id = $1 ORDER BY seq`, [match.id])
  const refused = rulingProblem(events, targetEventId)
  // ON CONFLICT: two sends of the same ruling racing (an outbox retry) must
  // not hit the primary key; the loser reads back what the winner stored.
  const { rows: [ruling] } = await query(
    `INSERT INTO match_rulings (id, match_id, target_event_id, kind, ruled_by, refused)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING RETURNING *`,
    [id, match.id, targetEventId, kind, req.umpire.id, refused],
  )
  if (!ruling) {
    const { rows: [stored] } = await query(`SELECT * FROM match_rulings WHERE id = $1 AND match_id = $2`, [id, match.id])
    if (!stored) return res.status(400).json({ error: 'Not a valid ruling' })
    return answer(stored)
  }
  if (refused) return res.status(409).json({ error: refused, ruling: shape(ruling) })
  res.status(201).json({ ruling: shape(ruling) })
})

router.get('/:matchId/rulings', async (req, res) => {
  const match = await matchHere(req)
  if (!match) return res.status(404).json(NO_MATCH)
  // The former scorekeeper's phone learns the split is over from this
  // answer; a 403 would print as an error.
  if (match.scorekeeper_id === req.umpire.id && match.scorekeeper_state !== 'scoring') {
    return res.json({ rulings: [], scoring: false })
  }
  if (match.scorekeeper_id !== req.umpire.id) {
    return res.status(403).json({ error: 'You are not scoring this match' })
  }
  // Feeds "Scorer last seen" on the main umpire's overview.
  await query(`UPDATE matches SET scorekeeper_seen_at = now() WHERE id = $1`, [match.id])
  const { rows } = await query(
    `SELECT r.id, r.target_event_id, r.kind, u.name AS ruled_by_name
       FROM match_rulings r LEFT JOIN umpires u ON u.id = r.ruled_by
      WHERE r.match_id = $1 AND r.applied_at IS NULL AND r.refused IS NULL
      ORDER BY r.ruled_at`,
    [match.id],
  )
  res.json({ rulings: rows.map((r) => ({ id: r.id, targetEventId: r.target_event_id, kind: r.kind, ruledByName: r.ruled_by_name })) })
})

router.post('/:matchId/rulings/:rulingId/refuse', async (req, res) => {
  const match = await matchHere(req)
  if (!match) return res.status(404).json(NO_MATCH)
  if (match.scorekeeper_id !== req.umpire.id) return res.status(403).json({ error: 'You are not scoring this match' })
  if (!isUuid(req.params.rulingId)) return res.status(400).json({ error: 'Not a valid ruling' })
  await query(
    `UPDATE match_rulings SET refused = $3 WHERE id = $1 AND match_id = $2 AND applied_at IS NULL AND refused IS NULL`,
    [req.params.rulingId, match.id, TOO_LATE],
  )
  res.status(204).end()
})

export default router
