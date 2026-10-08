import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireActiveUmpire, requireAuth } from '../auth.js'
import {
  DEFAULT_POINT_TARGET,
  POINT_TARGETS,
  deriveMatchState,
  eventToRow,
} from '../pickleball.js'
import { isUuid, stackingFromColumns, stackingToColumns } from '../validate.js'
import { rallyEndingProblem } from '../rally-endings.js'
import { invalidateRallyRatings } from '../rally-rating-store.js'
import { umpireScope } from '../facility-rules.js'
import { LEASE_MINUTES, heldByAnotherDevice } from '../scoring-lease.js'

const router = Router()
router.use(requireAuth, requireActiveUmpire(query))

function refusal(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

/** Sends a refusal thrown inside a transaction, or rethrows anything else. */
function sendRefusal(res, error) {
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message })
  throw error
}

// A game to 11 win-by-2 is 20-60 events, and one to 21 perhaps double
// that; 500 would be a marathon. The cap is a sanity bound on a single
// request, not a real gameplay limit.
const MAX_EVENTS = 500

const MATCH_SELECT = `
  SELECT m.id, m.session_id, m.team_a, m.team_b,
         m.stacking_a, m.stacking_b,
         m.first_server_team, m.first_server_player,
         m.right_start_a, m.right_start_b,
         m.point_target,
         m.status, m.winner, m.ended_early,
         m.voided_at, m.void_reason,
         m.started_at, m.ended_at,
         m.scoring_device, m.scoring_claimed_at,
         u.name AS recorded_by_name,
         (SELECT count(*)::int FROM match_events e WHERE e.match_id = m.id) AS event_count
    FROM matches m
    LEFT JOIN umpires u ON u.id = m.recorded_by
    -- A match belongs to the facility its session belongs to. An inner
    -- join, not a left one: a match whose session is somehow gone is
    -- out of everyone's reach rather than in everyone's.
    JOIN sessions sess ON sess.id = m.session_id
`

/** Reshapes a database row into the shape the app already speaks. */
function toClientMatch(row, events = undefined) {
  return {
    id: row.id,
    sessionId: row.session_id,
    teamA: row.team_a,
    teamB: row.team_b,
    stacking: stackingFromColumns(row),
    firstServer: { team: row.first_server_team, playerId: row.first_server_player },
    // Who began on the right, per team. Null on matches recorded before
    // setup asked; the engine says what stands in for that.
    rightStart: { A: row.right_start_a, B: row.right_start_b },
    pointTarget: row.point_target,
    status: row.status,
    winner: row.winner,
    endedEarly: row.ended_early,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    recordedByName: row.recorded_by_name,
    scoringDevice: row.scoring_device,
    scoringClaimedAt: row.scoring_claimed_at,
    eventCount: row.event_count,
    ...(events === undefined ? {} : { events }),
  }
}

/** Events in replay order, shaped as the scoring engine expects. */
async function loadEvents(matchId, client = { query }) {
  const { rows } = await client.query(
    `SELECT id, seq, type, payload, at
       FROM match_events WHERE match_id = $1 ORDER BY seq`,
    [matchId],
  )
  return rows.map((e) => ({
    id: e.id,
    seq: e.seq,
    type: e.type,
    at: e.at,
    ...e.payload,
  }))
}

router.get('/session/:sessionId', async (req, res) => {
  const params = [req.params.sessionId]
  const scope = umpireScope(req.umpire.facilityId, params, 'sess.facility_id')
  const { rows } = await query(
    `${MATCH_SELECT} WHERE m.session_id = $1 AND ${scope} ORDER BY m.started_at DESC`,
    params,
  )
  res.json({ matches: rows.map((r) => toClientMatch(r)) })
})

router.get('/:id', async (req, res) => {
  const params = [req.params.id]
  const scope = umpireScope(req.umpire.facilityId, params, 'sess.facility_id')
  const { rows } = await query(`${MATCH_SELECT} WHERE m.id = $1 AND ${scope}`, params)
  if (!rows[0]) return res.status(404).json({ error: 'No such match' })
  res.json({ match: toClientMatch(rows[0], await loadEvents(req.params.id)) })
})

/**
 * Creates a match from a device-minted id. Idempotent on replay.
 *
 * Everything here is re-validated even though the app already enforces
 * it in MatchSetup: this row is the durable record, and a stale app
 * version or a hand-made request reaches the same endpoint.
 */
router.post('/', async (req, res) => {
  const { id, sessionId, teamA, teamB, stacking, firstServer, rightStart, startedAt } =
    req.body ?? {}
  // An older app build sends no target; it only ever played to 11, so
  // that is the honest reading of what it recorded.
  const pointTarget = req.body?.pointTarget ?? DEFAULT_POINT_TARGET

  if (!isUuid(id)) return res.status(400).json({ error: 'A valid match id is required' })
  if (!isUuid(sessionId)) return res.status(400).json({ error: 'A valid session id is required' })
  if (!Array.isArray(teamA) || !Array.isArray(teamB)) {
    return res.status(400).json({ error: 'Both teams must be arrays' })
  }
  if (teamA.length !== teamB.length || teamA.length < 1 || teamA.length > 2) {
    return res.status(400).json({ error: 'Teams must be equal size, 1 or 2 players each' })
  }
  if (![...teamA, ...teamB].every(isUuid)) {
    return res.status(400).json({ error: 'Every player id must be a valid id' })
  }
  if (new Set([...teamA, ...teamB]).size !== teamA.length + teamB.length) {
    return res.status(400).json({ error: 'A player cannot appear twice in one match' })
  }
  if (!POINT_TARGETS.includes(pointTarget)) {
    return res.status(400).json({
      error: `pointTarget must be one of ${POINT_TARGETS.join(', ')}`,
    })
  }
  if (firstServer?.team !== 'A' && firstServer?.team !== 'B') {
    return res.status(400).json({ error: 'firstServer.team must be A or B' })
  }
  const serverTeam = firstServer.team === 'A' ? teamA : teamB
  if (!serverTeam.includes(firstServer.playerId)) {
    return res.status(400).json({ error: 'The first server must be on the team that serves first' })
  }

  // Who started on the right, per team. Optional: an older app build
  // sends none, and singles has no use for it. Whatever arrives must
  // still name someone on that team, since a stray id here would make
  // the app announce a server who is not on court.
  const rightStartA = rightStart?.A ?? null
  const rightStartB = rightStart?.B ?? null
  if (rightStartA !== null && !teamA.includes(rightStartA)) {
    return res.status(400).json({ error: "rightStart.A must be a player on team A" })
  }
  if (rightStartB !== null && !teamB.includes(rightStartB)) {
    return res.status(400).json({ error: "rightStart.B must be a player on team B" })
  }

  const { stacking_a, stacking_b } = stackingToColumns(stacking)

  try {
    await withTransaction(async (client) => {
      // team_a/team_b are plain uuid[] columns with no foreign key, so an
      // offline tablet replaying a queued create could otherwise name a
      // player merged away since it last synced with nothing to catch it.
      // Skipped for a match that already exists: that is a pure idempotent
      // replay (ON CONFLICT DO NOTHING below leaves the stored row, already
      // fixed up by any merge, untouched regardless of what this stale body
      // says), not a new row for Postgres to check.
      // The check and the insert share one transaction, and the check
      // takes FOR SHARE on the player rows it reads, so a merge landing
      // between the two (which takes FOR UPDATE on the same rows) blocks
      // until this commits rather than deleting a player this insert is
      // about to name. ORDER BY id matches the merge's own ordering: two
      // statements that lock the same rows in the same order can only ever
      // queue behind each other, never deadlock holding half of what the
      // other wants.
      // The session decides the facility, so this is the one place a
      // match could be smuggled into another facility. 404 rather than
      // 403: a session at another facility does not exist as far as
      // this umpire is concerned.
      const sessionParams = [sessionId]
      const sessionScope = umpireScope(req.umpire.facilityId, sessionParams, 'facility_id')
      const { rows: ownSession } = await client.query(
        `SELECT 1 FROM sessions WHERE id = $1 AND ${sessionScope}`,
        sessionParams,
      )
      if (ownSession.length === 0) throw refusal(404, 'No such session')

      const { rows: already } = await client.query('SELECT 1 FROM matches WHERE id = $1', [id])
      if (already.length === 0) {
        const allPlayerIds = [...new Set([...teamA, ...teamB])]
        const { rows: found } = await client.query(
          'SELECT id FROM players WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE',
          [allPlayerIds],
        )
        if (found.length !== allPlayerIds.length) throw refusal(409, 'One of those players no longer exists')
      }

      await client.query(
        `INSERT INTO matches (id, session_id, recorded_by, team_a, team_b,
                              stacking_a, stacking_b,
                              first_server_team, first_server_player, point_target,
                              right_start_a, right_start_b,
                              started_at)
         VALUES ($1, $2, $3, $4::uuid[], $5::uuid[], $6, $7, $8, $9, $10, $11, $12,
                 COALESCE($13::timestamptz, now()))
         ON CONFLICT (id) DO NOTHING`,
        [
          id, sessionId, req.umpire.id, teamA, teamB,
          stacking_a, stacking_b,
          firstServer.team, firstServer.playerId, pointTarget,
          rightStartA, rightStartB,
          startedAt ? new Date(startedAt).toISOString() : null,
        ],
      )
    })

    const readParams = [id]
    const readScope = umpireScope(req.umpire.facilityId, readParams, 'sess.facility_id')
    const { rows } = await query(`${MATCH_SELECT} WHERE m.id = $1 AND ${readScope}`, readParams)
    if (!rows[0]) return res.status(404).json({ error: 'Match could not be created' })
    res.status(201).json({ match: toClientMatch(rows[0]) })
  } catch (error) {
    // 23503 = foreign_key_violation: a player id that isn't in the
    // registry any more (merged into another record). first_server_player
    // and right_start_a/b are real foreign keys, so this is the backstop
    // for those; team_a/team_b have no foreign key at all, which is what
    // the check above exists to cover. A clear 409 is a permanent refusal
    // to the app's sync, rather than a 500 it would retry forever.
    if (error.code === '23503') return res.status(409).json({ error: 'One of those players no longer exists' })
    sendRefusal(res, error)
  }
})

/**
 * Claims (or force-takes) the right to score a match.
 *
 * Taking over is deliberately destructive: the taking-over device's log
 * replaces what is stored. There is no reconciliation, because two
 * umpires scoring one match are not producing complementary halves --
 * they are producing two independent opinions of the same rallies, and
 * interleaving them yields a sequence matching neither.
 */
router.post('/:id/claim', async (req, res) => {
  const deviceId = String(req.body?.deviceId ?? '')
  const force = Boolean(req.body?.force)

  if (!deviceId) return res.status(400).json({ error: 'A deviceId is required' })

  const params = [req.params.id, deviceId, force, LEASE_MINUTES]
  const scope = umpireScope(req.umpire.facilityId, params, 'sessions.facility_id')
  const { rows } = await query(
    `UPDATE matches
        SET scoring_device = $2, scoring_claimed_at = now()
      WHERE id = $1
        AND EXISTS (SELECT 1 FROM sessions
                     WHERE sessions.id = matches.session_id AND ${scope})
        AND ($3
             OR scoring_device IS NULL
             OR scoring_device = $2
             OR scoring_claimed_at < now() - ($4 || ' minutes')::interval)
      RETURNING id`,
    params,
  )

  if (rows.length === 0) {
    // Scoped too: a match at another facility must read as missing, not
    // as held by someone -- naming the umpire holding it would leak
    // that it exists and who is scoring it.
    const heldParams = [req.params.id]
    const heldScope = umpireScope(req.umpire.facilityId, heldParams, 'sess.facility_id')
    const held = await query(
      `SELECT m.scoring_device, m.scoring_claimed_at, u.name AS umpire_name
         FROM matches m
         LEFT JOIN umpires u ON u.id = m.recorded_by
         JOIN sessions sess ON sess.id = m.session_id
        WHERE m.id = $1 AND ${heldScope}`,
      heldParams,
    )
    if (held.rowCount === 0) return res.status(404).json({ error: 'No such match' })
    return res.status(409).json({
      error: 'Another device is scoring this match',
      heldBy: {
        umpireName: held.rows[0].umpire_name,
        since: held.rows[0].scoring_claimed_at,
      },
    })
  }

  const matchParams = [req.params.id]
  const matchScope = umpireScope(req.umpire.facilityId, matchParams, 'sess.facility_id')
  const match = await query(`${MATCH_SELECT} WHERE m.id = $1 AND ${matchScope}`, matchParams)
  res.json({ match: toClientMatch(match.rows[0]) })
})

/**
 * Replaces a match's entire event log: "this match's log is exactly
 * these events."
 *
 * Full-state replacement rather than append/undo operations. A game is
 * at most a few tens of kilobytes, and paying that on every push buys
 * away a whole category of bugs: a retry is free because re-sending is
 * the same request, an undo needs no protocol of its own because the
 * next push simply carries a shorter array, and there is no
 * acknowledgement cursor that can drift out of step with the device.
 *
 * Status, winner and ended_at are DERIVED here from the submitted log,
 * never taken from the request. If a device could assert
 * `status: completed, winner: A`, a bug or a crafted request could put
 * a fabricated final score into the ML export with nothing to catch it.
 * That is the whole reason the scoring engine is shared rather than
 * duplicated.
 */
router.put('/:id/log', async (req, res) => {
  const deviceId = String(req.body?.deviceId ?? '')
  const events = req.body?.events
  const endedEarly = Boolean(req.body?.endedEarly)
  const endedEarlyAt = req.body?.endedEarlyAt

  if (!deviceId) return res.status(400).json({ error: 'A deviceId is required' })
  if (!Array.isArray(events)) return res.status(400).json({ error: 'events must be an array' })
  if (events.length > MAX_EVENTS) {
    return res.status(400).json({ error: `A match cannot have more than ${MAX_EVENTS} events` })
  }

  const existingParams = [req.params.id]
  const existingScope = umpireScope(req.umpire.facilityId, existingParams, 'sess.facility_id')
  const existing = await query(`${MATCH_SELECT} WHERE m.id = $1 AND ${existingScope}`, existingParams)
  if (!existing.rows[0]) return res.status(404).json({ error: 'No such match' })
  const row = existing.rows[0]

  if (heldByAnotherDevice(row, deviceId)) {
    return res.status(409).json({
      error: 'Another device is scoring this match',
      heldBy: { umpireName: row.recorded_by_name, since: row.scoring_claimed_at },
    })
  }

  const players = new Set([...row.team_a, ...row.team_b])

  // Sequence numbers must be exactly 0..n-1. Insisting on contiguity
  // means the UNIQUE (match_id, seq) index only ever fires on a genuine
  // bug, rather than being the thing quietly absorbing normal traffic.
  for (const [index, event] of events.entries()) {
    if (event?.seq !== index) {
      return res.status(400).json({ error: `Event ${index} has seq ${event?.seq}; expected ${index}` })
    }
    if (!isUuid(event.id)) {
      return res.status(400).json({ error: `Event ${index} needs a valid id` })
    }
    if (
      event.type !== 'rally' &&
      event.type !== 'thirdShot' &&
      event.type !== 'serverCorrection'
    ) {
      return res.status(400).json({ error: `Event ${index} has unknown type ${event.type}` })
    }
    // A rally may name the third shot it followed, which is what makes
    // "did dropping win the point" answerable. Optional on purpose:
    // logging a third shot is optional for the umpire, and clients from
    // before this existed send rallies without it.
    if (
      event.type === 'rally' &&
      event.thirdShotId !== undefined &&
      !isUuid(event.thirdShotId)
    ) {
      return res.status(400).json({ error: `Event ${index} has an invalid thirdShotId` })
    }
    // What ended the rally, when the app says. Optional, because copies
    // of the app from before this existed are still installed on
    // phones; but when present it must be a known ending that agrees
    // with the outcome and zone filed beside it.
    if (event.type === 'rally') {
      const problem = rallyEndingProblem(event)
      if (problem) {
        return res.status(400).json({ error: `Event ${index} has a ${problem}` })
      }
    }
    // Both non-rally types name their player the same way, so the check
    // below covers a correction naming someone outside the match too.
    const actor = event.type === 'rally' ? event.actingPlayerId : event.playerId
    if (!players.has(actor)) {
      return res.status(400).json({ error: `Event ${index} references a player not in this match` })
    }
  }

  const derived = deriveMatchState({
    teamA: row.team_a,
    teamB: row.team_b,
    firstServer: { team: row.first_server_team, playerId: row.first_server_player },
    rightStart: { A: row.right_start_a, B: row.right_start_b },
    // Without this the server would score a game played to 15 as though
    // it were to 11 and declare a winner partway through.
    pointTarget: row.point_target,
    events,
  })

  // A match ends either by being won on court (derivable) or by being
  // stopped early (NOT derivable -- ending early appends no event). The
  // second case is why ended_early is stored: without it, every
  // manually-ended match would reopen as in-progress on the next sync.
  const completed = derived.completed || endedEarly
  const endedAtSource = derived.completed
    ? events[events.length - 1]?.at
    : (endedEarlyAt ?? Date.now())

  await withTransaction(async (client) => {
    await client.query('DELETE FROM match_events WHERE match_id = $1', [req.params.id])

    for (const event of events) {
      const { id, seq, type, at, payload } = eventToRow(event)
      await client.query(
        `INSERT INTO match_events (id, match_id, seq, type, payload, at)
         VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, now()))`,
        [id, req.params.id, seq, type, JSON.stringify(payload),
         at ? new Date(at).toISOString() : null],
      )
    }

    await client.query(
      `UPDATE matches
          SET status = $2,
              winner = $3,
              ended_early = $4,
              ended_at = CASE WHEN $2 = 'completed' THEN COALESCE($5::timestamptz, now()) END,
              scoring_device = $6,
              scoring_claimed_at = now()
        WHERE id = $1`,
      [
        req.params.id,
        completed ? 'completed' : 'in_progress',
        derived.winner,
        endedEarly && !derived.completed,
        completed && endedAtSource ? new Date(endedAtSource).toISOString() : null,
        deviceId,
      ],
    )
  })

  // Events, completion and ending early all arrive here, so any of them
  // can change the rally rating.
  invalidateRallyRatings()

  const updatedParams = [req.params.id]
  const updatedScope = umpireScope(req.umpire.facilityId, updatedParams, 'sess.facility_id')
  const updated = await query(`${MATCH_SELECT} WHERE m.id = $1 AND ${updatedScope}`, updatedParams)
  res.json({ match: toClientMatch(updated.rows[0], await loadEvents(req.params.id)) })
})

/**
 * Cancels an unfinished match outright -- wrong pairing, wrong court,
 * started by mistake. There is nothing worth keeping in a match
 * abandoned before it counted.
 *
 * Idempotent on purpose: a device may queue this while offline and
 * retry it later, possibly after another umpire already removed the
 * same match. Answering 404 would dead-letter a request that in fact
 * achieved exactly what was asked.
 */
router.delete('/:id', async (req, res) => {
  const params = [req.params.id]
  const scope = umpireScope(req.umpire.facilityId, params, 'sess.facility_id')
  const { rows } = await query(
    `SELECT m.status FROM matches m JOIN sessions sess ON sess.id = m.session_id
      WHERE m.id = $1 AND ${scope}`,
    params,
  )

  if (rows.length === 0) {
    // Gone is success (a queued delete retried after someone else
    // removed it); existing at another facility is not.
    const elsewhere = await query('SELECT 1 FROM matches WHERE id = $1', [req.params.id])
    if (elsewhere.rowCount > 0) return res.status(404).json({ error: 'No such match' })
    return res.status(204).end()
  }

  if (rows[0].status === 'completed') {
    return res.status(409).json({
      error: 'That match is already finished — void it instead of deleting it',
    })
  }

  await query('DELETE FROM matches WHERE id = $1', [req.params.id])
  invalidateRallyRatings()
  res.status(204).end()
})

/**
 * Voids a COMPLETED match, excluding it from the ML export while
 * keeping the row.
 *
 * A mis-paired match is worse for the pipeline than no match: it
 * credits one player's rallies to another, and nothing downstream can
 * detect that. But hard-deleting finished play throws away a real
 * record of something that happened, so this is reversible and
 * attributed instead.
 *
 * An umpire's void or restore always replaces an admin's (voided_by_admin is cleared), so the umpire keeps the last word.
 */
router.post('/:id/void', async (req, res) => {
  const voided = req.body?.voided !== false
  const reason = String(req.body?.reason ?? '').trim() || null

  const params = [req.params.id, voided, req.umpire.id, reason]
  const scope = umpireScope(req.umpire.facilityId, params, 'sessions.facility_id')
  const { rows } = await query(
    `UPDATE matches
        SET voided_at = CASE WHEN $2 THEN now() END,
            voided_by = CASE WHEN $2 THEN $3::uuid END,
            voided_by_admin = NULL,
            void_reason = CASE WHEN $2 THEN $4 END
      WHERE id = $1
        AND EXISTS (SELECT 1 FROM sessions
                     WHERE sessions.id = matches.session_id AND ${scope})
      RETURNING id`,
    params,
  )
  if (rows.length === 0) return res.status(404).json({ error: 'No such match' })
  invalidateRallyRatings()

  const readParams = [req.params.id]
  const readScope = umpireScope(req.umpire.facilityId, readParams, 'sess.facility_id')
  const updated = await query(`${MATCH_SELECT} WHERE m.id = $1 AND ${readScope}`, readParams)
  res.json({ match: toClientMatch(updated.rows[0]) })
})

export default router
