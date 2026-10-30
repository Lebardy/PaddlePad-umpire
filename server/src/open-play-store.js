// ============================================================
// Open play and visit ratings: the reads and writes. The rules are in
// visit-rules.js; each function is passed `query`, or a transaction's
// `client` where the write must hold a lock.
// ============================================================

import { levelNamer } from './levels.js'
import { latestRunLevels } from './player-stats.js'
import { getRallyRatings } from './rally-rating-store.js'
import { joinRefusal, weekEnd } from './visit-rules.js'

/**
 * Each player's level name by the latest real run's lines (levelNamer),
 * null for one not in that run ("new"). `levelsShown` is false when the
 * run has no clear levels.
 */
export async function levelLookup(query) {
  const [run, ratings] = await Promise.all([latestRunLevels(query), getRallyRatings(query)])
  const namer = run
    ? levelNamer({ levels: run.levels, runPoints: run.players.map((id) => ratings.get(id)?.points) })
    : null
  return {
    levelsShown: Boolean(namer),
    levelOf: (id) => (namer && run.players.includes(id) ? namer(ratings.get(id)?.points) : null),
  }
}

/** This week's open plays, soonest first, each with the active players going. One place's, given `facilityId`; just one, given `id`. */
export async function loadOpenPlays(query, { facilityId = null, id = null, now }) {
  const { rows } = await query(
    `SELECT o.id, o.facility_id, f.name AS facility_name, o.starts_at, o.ends_at, o.courts, o.spots,
            o.fee_centavos, o.umpire, o.note,
            COALESCE(array_agg(j.player_id) FILTER (WHERE p.id IS NOT NULL), '{}') AS joined
       FROM open_plays o
       JOIN facilities f ON f.id = o.facility_id
       LEFT JOIN open_play_joins j ON j.open_play_id = o.id
       LEFT JOIN players p ON p.id = j.player_id AND p.deactivated_at IS NULL AND p.paused_at IS NULL
      WHERE o.ends_at > $1 AND o.starts_at < $2 AND ($3::uuid IS NULL OR o.facility_id = $3) AND ($4::uuid IS NULL OR o.id = $4)
      GROUP BY o.id, f.name
      ORDER BY o.starts_at, f.name`,
    [now, weekEnd(now), facilityId, id],
  )
  return rows.map((row) => ({
    id: row.id,
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    courts: row.courts,
    spots: row.spots,
    feeCentavos: row.fee_centavos,
    umpire: row.umpire,
    note: row.note,
    joined: row.joined,
  }))
}

/** The names `viewerId` may see among `ids`: people they shared a non-voided match with who show their name. */
export async function namedFor(query, viewerId, ids) {
  const { rows } = await query(
    `SELECT p.id, p.name FROM players p
      WHERE p.id = ANY($2::uuid[]) AND p.id <> $1 AND p.name_visible
        AND EXISTS (SELECT 1 FROM matches m JOIN sessions s ON s.id = m.session_id
                     WHERE m.voided_at IS NULL AND s.voided_at IS NULL
                       AND (m.team_a || m.team_b) @> ARRAY[$1::uuid, p.id])`,
    [viewerId, ids],
  )
  return new Map(rows.map((row) => [row.id, row.name]))
}

/**
 * Joins one open play, inside the caller's transaction. Its row stays
 * locked until the transaction ends, so two last-spot joins cannot both
 * win. Null once joined, or `{ status, error }` when refused.
 */
export async function joinOpenPlay(client, openPlayId, playerId, now) {
  const { rows } = await client.query('SELECT id, ends_at, spots FROM open_plays WHERE id = $1 FOR UPDATE', [openPlayId])
  if (!rows[0]) return { status: 404, error: 'No such open play' }
  const { rows: going } = await client.query(
    `SELECT count(*)::int AS count, COALESCE(bool_or(j.player_id = $2), false) AS you
       FROM open_play_joins j JOIN players p ON p.id = j.player_id
      WHERE j.open_play_id = $1 AND p.deactivated_at IS NULL AND p.paused_at IS NULL`,
    [openPlayId, playerId],
  )
  const refusal = joinRefusal({ endsAt: rows[0].ends_at, spots: rows[0].spots, ...going[0] }, now)
  if (refusal) return { status: 409, error: refusal }
  await client.query(
    'INSERT INTO open_play_joins (open_play_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [openPlayId, playerId],
  )
  return null
}

export async function leaveOpenPlay(query, openPlayId, playerId) {
  await query('DELETE FROM open_play_joins WHERE open_play_id = $1 AND player_id = $2', [openPlayId, playerId])
}

/** This player's visit in one session: its place, whether it was voided and their latest match there; null if they never played in it. */
export async function visitFor(query, sessionId, playerId) {
  const { rows } = await query(
    `SELECT s.facility_id, s.voided_at IS NOT NULL AS voided, f.name AS facility_name, max(m.started_at) AS last_played_at
       FROM sessions s
       JOIN matches m ON m.session_id = s.id
       LEFT JOIN facilities f ON f.id = s.facility_id
      WHERE s.id = $1 AND m.voided_at IS NULL AND (m.team_a || m.team_b) @> ARRAY[$2::uuid]
      GROUP BY s.id, f.name`,
    [sessionId, playerId],
  )
  const row = rows[0]
  return row
    ? { facilityId: row.facility_id, facilityName: row.facility_name, voided: row.voided, lastPlayedAt: row.last_played_at }
    : null
}

/** Saves a visit rating; rating the same session again replaces it. */
export async function saveRating(query, { playerId, sessionId, facilityId, score, chips }) {
  const { rows } = await query(
    `INSERT INTO visit_ratings (player_id, session_id, facility_id, score, chips) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (player_id, session_id) DO UPDATE SET score = EXCLUDED.score, chips = EXCLUDED.chips, updated_at = now()
     RETURNING score, chips`,
    [playerId, sessionId, facilityId, score, chips],
  )
  return rows[0]
}

/** A place's ratings from the last 30 days, voided sessions left out. Anonymous: scores and chips only. */
export async function recentRatings(query, facilityId) {
  const { rows } = await query(
    `SELECT r.score, r.chips FROM visit_ratings r JOIN sessions s ON s.id = r.session_id
      WHERE r.facility_id = $1 AND s.voided_at IS NULL AND r.updated_at > now() - interval '30 days'`,
    [facilityId],
  )
  return rows
}

/**
 * Each open play's courts: who is assigned (and whether they can still
 * start it: not paused, not closed, still at that place) and which
 * session took it. Courts nobody touched are simply absent.
 */
export async function loadCourtState(query, openPlayIds) {
  const state = new Map(openPlayIds.map((id) => [id, new Map()]))
  if (openPlayIds.length === 0) return state
  const at = (id, court) => {
    const courts = state.get(id)
    if (!courts.has(court)) courts.set(court, { assignee: null, session: null })
    return courts.get(court)
  }
  const { rows: assigned } = await query(
    `SELECT c.open_play_id, c.court, u.id, u.name,
            (u.paused_at IS NULL AND u.closed_at IS NULL AND u.facility_id = o.facility_id) AS active
       FROM open_play_courts c
       JOIN umpires u ON u.id = c.umpire_id
       JOIN open_plays o ON o.id = c.open_play_id
      WHERE c.open_play_id = ANY($1::uuid[])`,
    [openPlayIds],
  )
  for (const row of assigned) at(row.open_play_id, row.court).assignee = { id: row.id, name: row.name, active: row.active }
  const { rows: taken } = await query(
    `SELECT s.open_play_id, s.court, u.name AS started_by, s.ended_at IS NOT NULL AS ended
       FROM sessions s LEFT JOIN umpires u ON u.id = s.created_by
      WHERE s.open_play_id = ANY($1::uuid[]) AND s.court IS NOT NULL AND s.voided_at IS NULL`,
    [openPlayIds],
  )
  for (const row of taken) at(row.open_play_id, row.court).session = { startedBy: row.started_by ?? 'another umpire', ended: row.ended }
  return state
}

/** The umpires a manager can put on a court: at this place, not paused, not closed. */
export async function loadFacilityUmpires(query, facilityId) {
  const { rows } = await query(
    `SELECT id, name FROM umpires
      WHERE facility_id = $1 AND paused_at IS NULL AND closed_at IS NULL
      ORDER BY name`,
    [facilityId],
  )
  return rows
}
