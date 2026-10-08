// ============================================================
// The Overview's reads: what's going on right now, the totals, the
// matches worth a look and (owner only) possible duplicate players.
// Everything is worked out on each request from the live tables; the
// rules themselves are in overview-rules.js.
// ============================================================

import { deriveMatchState, eventFromRow } from './pickleball.js'
import { scopeCondition } from './facility-rules.js'
import {
  PLAYER_ID_KEYS, WINDOW_DAYS, duplicatePairs, hasSignIn, leftOpenReason, matchReasons, pairKey, sameDayPairs, sharedMatchPairs,
} from './overview-rules.js'

const WEEK = "now() - interval '7 days'"

const toMs = (value) => (value == null ? null : value instanceof Date ? value.getTime() : Date.parse(value))

async function eventsFor(queryFn, matchIds) {
  const byMatch = new Map()
  if (matchIds.length === 0) return byMatch
  const { rows } = await queryFn(
    `SELECT match_id, id, type, payload FROM match_events WHERE match_id = ANY($1::uuid[]) ORDER BY match_id, seq`,
    [matchIds],
  )
  for (const row of rows) {
    if (!byMatch.has(row.match_id)) byMatch.set(row.match_id, [])
    byMatch.get(row.match_id).push(eventFromRow(row))
  }
  return byMatch
}

function derive(row, events) {
  return deriveMatchState({
    teamA: row.team_a,
    teamB: row.team_b,
    firstServer: { team: row.first_server_team, playerId: row.first_server_player },
    rightStart: { A: row.right_start_a, B: row.right_start_b },
    pointTarget: row.point_target,
    events: events ?? [],
  })
}

async function namesOf(queryFn, ids) {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const { rows } = await queryFn('SELECT id, name FROM players WHERE id = ANY($1::uuid[])', [unique])
  return new Map(rows.map((r) => [r.id, r.name]))
}

const MATCH_COLUMNS = `m.id, m.session_id, m.team_a, m.team_b, m.first_server_team, m.first_server_player,
  m.right_start_a, m.right_start_b, m.point_target, m.status, m.started_at, m.ended_at, m.ended_early,
  m.voided_at, m.void_reason, m.voided_by_admin, m.recorded_by AS recorded_by_id, u.name AS umpire_name, s.name AS session_name,
  s.facility_id, f.name AS facility_name, va.name AS voided_by_admin_name, s.voided_at AS session_voided_at`

const MATCH_FROM = `FROM matches m
  JOIN sessions s ON s.id = m.session_id
  LEFT JOIN umpires u ON u.id = m.recorded_by
  LEFT JOIN facilities f ON f.id = s.facility_id
  LEFT JOIN admins va ON va.id = m.voided_by_admin`

/** One match with what an Overview button needs to check it. */
export async function loadMatchForAction(queryFn, matchId, { lock = false } = {}) {
  const { rows } = await queryFn(
    `SELECT ${MATCH_COLUMNS} ${MATCH_FROM} WHERE m.id = $1${lock ? ' FOR UPDATE OF m' : ''}`,
    [matchId],
  )
  return rows[0] ?? null
}

/** A match in words for an activity entry: "Jon Cruz & Mia Santos vs Paolo Lim & Kat Villanueva". */
export async function matchLabel(queryFn, row) {
  const names = await namesOf(queryFn, [...row.team_a, ...row.team_b])
  const side = (ids) => ids.map((id) => names.get(id) ?? 'Someone').join(' & ')
  return `${side(row.team_a)} vs ${side(row.team_b)}`
}

const SESSION_COLUMNS = `s.id, s.name, s.facility_id, s.created_at AS opened_at, s.ended_at, s.ended_by_admin, s.voided_at,
  (SELECT max(m.ended_at) FROM matches m WHERE m.session_id = s.id AND m.status = 'completed' AND m.voided_at IS NULL) AS last_match_ended_at,
  (SELECT max(m.started_at) FROM matches m WHERE m.session_id = s.id AND m.voided_at IS NULL) AS last_match_started_at`

/** One session with what the Overview's "Close" button needs to check it. */
export async function loadSessionForAction(queryFn, sessionId, { lock = false } = {}) {
  const { rows } = await queryFn(
    `SELECT ${SESSION_COLUMNS} FROM sessions s WHERE s.id = $1${lock ? ' FOR UPDATE OF s' : ''}`,
    [sessionId],
  )
  return rows[0] ?? null
}

/** A session in words for an activity entry: the name it was given, e.g. "Friday Night". */
export function sessionLabel(row) {
  return row.name
}

/**
 * Why this session is, right now, left open -- or null when it's
 * ended, voided, or still within the quiet mark loadRightNow uses.
 * Reuses leftOpenReason rather than re-deriving the 3-hour rule.
 */
export async function sessionLeftOpenNow(queryFn, row, now = Date.now()) {
  if (row.ended_at || row.voided_at) return null
  const lastActivityAt = Math.max(...[row.opened_at, row.last_match_started_at, row.last_match_ended_at].map(toMs).filter((v) => v != null))
  return leftOpenReason({ openedAt: row.opened_at, lastActivityAt }, now)
}

/**
 * Closes a session an umpire left open. Only `ended_at` and
 * `ended_by_admin` are touched -- never `ended_by` (that column
 * belongs to the umpire's own end route) and never any match inside
 * the session.
 */
export async function closeSession(client, sessionId, adminId) {
  await client.query('UPDATE sessions SET ended_at = now(), ended_by_admin = $2 WHERE id = $1', [sessionId, adminId])
}

/**
 * The reasons this match is worth a look right now: inside the window,
 * with any reasons already marked "Looks fine" taken off.
 */
export async function matchReasonsNow(queryFn, row, now = Date.now()) {
  if (row.session_voided_at) return []
  const startedAt = row.started_at instanceof Date ? row.started_at.getTime() : Date.parse(row.started_at)
  if (startedAt < now - WINDOW_DAYS * 86_400_000) return []
  const events = await eventsFor(queryFn, [row.id])
  const derived = derive(row, events.get(row.id))
  const { rows: dismissed } = await queryFn(
    "SELECT reason FROM dismissed_warnings WHERE kind = 'match' AND match_id = $1",
    [row.id],
  )
  const hidden = new Set(dismissed.map((d) => d.reason))
  return matchReasons({
    status: row.status, startedAt: row.started_at, endedAt: row.ended_at, endedEarly: row.ended_early, score: derived.score,
  }, now).filter((r) => !hidden.has(r.reason))
}

async function loadRightNow(queryFn, filter, now) {
  const params = []
  const scope = scopeCondition(filter, params, 's.facility_id')
  const { rows: openSessions } = await queryFn(
    `SELECT s.id, s.name, s.created_at, s.created_by AS opened_by_id, f.name AS facility_name, u.name AS opened_by,
            (SELECT count(*)::int FROM session_players sp WHERE sp.session_id = s.id) AS player_count,
            (SELECT max(m.ended_at) FROM matches m WHERE m.session_id = s.id AND m.status = 'completed' AND m.voided_at IS NULL) AS last_match_ended_at,
            (SELECT max(m.started_at) FROM matches m WHERE m.session_id = s.id AND m.voided_at IS NULL) AS last_match_started_at
       FROM sessions s
       LEFT JOIN facilities f ON f.id = s.facility_id
       LEFT JOIN umpires u ON u.id = s.created_by
      WHERE s.ended_at IS NULL AND s.voided_at IS NULL AND ${scope}
      ORDER BY s.created_at DESC`,
    params,
  )
  // Last activity is the latest of opened, a non-voided match starting,
  // or one ending; going-on-or-left-open is decided from that, but the
  // "left open for" wording is measured from when it was opened.
  const withActivity = openSessions.map((s) => {
    const lastActivityAt = Math.max(...[s.created_at, s.last_match_started_at, s.last_match_ended_at].map(toMs).filter((v) => v != null))
    return { ...s, openReason: leftOpenReason({ openedAt: s.created_at, lastActivityAt }, now) }
  })
  const sessions = withActivity.filter((s) => !s.openReason)
  const leftOpen = withActivity.filter((s) => s.openReason).sort((a, b) => toMs(a.created_at) - toMs(b.created_at))

  const sessionIds = sessions.map((s) => s.id)
  const { rows: matches } = sessionIds.length === 0 ? { rows: [] } : await queryFn(
    `SELECT ${MATCH_COLUMNS} ${MATCH_FROM}
      WHERE m.session_id = ANY($1::uuid[]) AND m.status = 'in_progress' AND m.voided_at IS NULL
      ORDER BY m.started_at`,
    [sessionIds],
  )
  const { rows: listed } = sessionIds.length === 0 ? { rows: [] } : await queryFn(
    'SELECT count(DISTINCT player_id)::int AS n FROM session_players WHERE session_id = ANY($1::uuid[])',
    [sessionIds],
  )
  const events = await eventsFor(queryFn, matches.map((m) => m.id))
  const names = await namesOf(queryFn, matches.flatMap((m) => [...m.team_a, ...m.team_b]))
  const side = (ids) => ids.map((id) => ({ id, name: names.get(id) ?? 'Someone' }))
  const onCourt = new Set(matches.flatMap((m) => [...m.team_a, ...m.team_b]))

  return {
    live: { sessions: sessions.length, matches: matches.length, players: listed[0]?.n ?? 0, onCourt: onCourt.size },
    sessions: sessions.map((s) => {
      const own = matches.filter((m) => m.session_id === s.id)
      return {
        id: s.id,
        name: s.name,
        facilityName: s.facility_name,
        openedBy: s.opened_by,
        openedAt: s.created_at,
        playerCount: s.player_count,
        onCourt: new Set(own.flatMap((m) => [...m.team_a, ...m.team_b])).size,
        lastMatchEndedAt: s.last_match_ended_at,
        matches: own.map((m) => {
          const derived = derive(m, events.get(m.id))
          return {
            id: m.id, teamA: side(m.team_a), teamB: side(m.team_b), score: derived.score, servingTeam: derived.servingTeam,
            umpireName: m.umpire_name, startedAt: m.started_at, pointTarget: m.point_target,
          }
        }),
      }
    }),
    leftOpen: leftOpen.map((s) => ({
      sessionId: s.id,
      name: s.name,
      facilityName: s.facility_name,
      openedBy: s.opened_by,
      openedAt: s.created_at,
      playerCount: s.player_count,
      tag: s.openReason.tag,
    })),
    activeUmpires: [...new Set([...matches.map((m) => m.recorded_by_id), ...sessions.map((s) => s.opened_by_id)].filter(Boolean))],
  }
}

async function loadTotals(queryFn, filter, activeUmpireIds) {
  const params = []
  const scope = scopeCondition(filter, params, 's.facility_id')
  const umpireParams = []
  const umpireScope = scopeCondition(filter, umpireParams, 'u.facility_id')

  const [players, matches, sessions, umpires, ratings] = await Promise.all([
    filter?.all
      ? queryFn(`SELECT count(*)::int AS count, count(*) FILTER (WHERE created_at > ${WEEK})::int AS new_this_week
                   FROM players WHERE deactivated_at IS NULL`)
      : queryFn(
        `SELECT count(*)::int AS count, count(*) FILTER (WHERE first_played > ${WEEK})::int AS new_this_week
           FROM (SELECT p.player_id, min(m.started_at) AS first_played
                   FROM matches m
                   JOIN sessions s ON s.id = m.session_id
                   CROSS JOIN LATERAL unnest(m.team_a || m.team_b) AS p(player_id)
                  WHERE m.voided_at IS NULL AND s.voided_at IS NULL AND ${scope}
                  GROUP BY p.player_id) played`,
        params,
      ),
    queryFn(
      `SELECT count(*)::int AS count, count(*) FILTER (WHERE m.started_at > ${WEEK})::int AS new_this_week
         FROM matches m JOIN sessions s ON s.id = m.session_id
        WHERE m.voided_at IS NULL AND s.voided_at IS NULL AND ${scope}`,
      params,
    ),
    queryFn(
      `SELECT count(*)::int AS count, count(*) FILTER (WHERE s.created_at > ${WEEK})::int AS new_this_week
         FROM sessions s WHERE s.voided_at IS NULL AND ${scope}`,
      params,
    ),
    queryFn(
      `SELECT u.id FROM umpires u WHERE u.paused_at IS NULL AND u.closed_at IS NULL AND ${umpireScope}`,
      umpireParams,
    ),
    queryFn(
      `SELECT computed_at, player_count FROM rating_runs WHERE status = 'completed' ORDER BY computed_at DESC LIMIT 1`,
    ),
  ])
  const active = new Set(activeUmpireIds)
  const umpireIds = umpires.rows.map((r) => r.id)
  const activeCount = umpireIds.filter((id) => active.has(id)).length
  const pick = (r) => ({ count: r.rows[0]?.count ?? 0, newThisWeek: r.rows[0]?.new_this_week ?? 0 })
  return {
    players: pick(players),
    matches: pick(matches),
    sessions: pick(sessions),
    umpires: { active: activeCount, notActive: umpireIds.length - activeCount },
    ratings: ratings.rows[0] ? { computedAt: ratings.rows[0].computed_at, playerCount: ratings.rows[0].player_count } : null,
  }
}

async function loadWarnings(queryFn, filter, { now, adminId }) {
  const params = [new Date(now - WINDOW_DAYS * 86_400_000).toISOString()]
  const scope = scopeCondition(filter, params, 's.facility_id')
  const { rows } = await queryFn(
    `SELECT ${MATCH_COLUMNS} ${MATCH_FROM}
      WHERE m.started_at > $1::timestamptz
        AND (m.voided_at IS NULL OR m.voided_by_admin IS NOT NULL)
        AND s.voided_at IS NULL
        AND ${scope}
      ORDER BY m.started_at DESC`,
    params,
  )
  if (rows.length === 0) return []
  const events = await eventsFor(queryFn, rows.map((r) => r.id))
  const { rows: dismissed } = await queryFn(
    "SELECT match_id, reason FROM dismissed_warnings WHERE kind = 'match' AND match_id = ANY($1::uuid[])",
    [rows.map((r) => r.id)],
  )
  const hidden = new Set(dismissed.map((d) => `${d.match_id}:${d.reason}`))
  const flagged = []
  for (const row of rows) {
    const derived = derive(row, events.get(row.id))
    const reasons = matchReasons({
      status: row.status, startedAt: row.started_at, endedAt: row.ended_at, endedEarly: row.ended_early, score: derived.score,
    }, now).filter((r) => !hidden.has(`${row.id}:${r.reason}`))
    const voided = row.voided_at && row.voided_by_admin
      ? { byName: row.voided_by_admin_name, at: row.voided_at, reason: row.void_reason, byMe: row.voided_by_admin === adminId }
      : null
    if (reasons.length > 0 || voided) flagged.push({ row, reasons, voided, score: derived.score })
  }
  const names = await namesOf(queryFn, flagged.flatMap(({ row }) => [...row.team_a, ...row.team_b]))
  return flagged.map(({ row, reasons, voided, score }) => ({
    matchId: row.id,
    sessionName: row.session_name,
    facilityName: row.facility_name,
    teamA: row.team_a.map((id) => names.get(id) ?? 'Someone'),
    teamB: row.team_b.map((id) => names.get(id) ?? 'Someone'),
    score,
    status: row.status,
    umpireName: row.umpire_name,
    startedAt: row.started_at,
    reasons,
    voided,
  }))
}

async function loadDuplicates(queryFn, now) {
  const { rows: players } = await queryFn(
    `SELECT p.id, p.name, p.username, p.password_hash, p.google_sub, p.claimed_at, p.registered_at,
            (SELECT count(*)::int FROM matches m WHERE p.id = ANY(m.team_a) OR p.id = ANY(m.team_b)) AS match_count,
            (SELECT min(m.started_at) FROM matches m WHERE p.id = ANY(m.team_a) OR p.id = ANY(m.team_b)) AS first_match_at
       FROM players p WHERE p.deactivated_at IS NULL ORDER BY p.created_at, p.id`,
  )
  const { rows: allMatches } = await queryFn('SELECT session_id, team_a, team_b FROM matches')
  const since = new Date(now - WINDOW_DAYS * 86_400_000).toISOString()
  const { rows: recentSessions } = await queryFn(
    `SELECT s.id, array_agg(sp.player_id) AS player_ids
       FROM sessions s JOIN session_players sp ON sp.session_id = s.id
      WHERE s.created_at > $1::timestamptz AND s.voided_at IS NULL
      GROUP BY s.id`,
    [since],
  )
  const { rows: dismissed } = await queryFn("SELECT player_a, player_b FROM dismissed_warnings WHERE kind = 'players'")

  const matchesBySession = new Map()
  for (const m of allMatches) {
    if (!matchesBySession.has(m.session_id)) matchesBySession.set(m.session_id, [])
    matchesBySession.get(m.session_id).push({ teamA: m.team_a, teamB: m.team_b })
  }
  const pairs = duplicatePairs(players.map((p) => ({ id: p.id, name: p.name })), {
    sharedPairs: sharedMatchPairs(allMatches.map((m) => ({ teamA: m.team_a, teamB: m.team_b }))),
    sameDay: sameDayPairs(recentSessions.map((s) => ({ playerIds: s.player_ids, matches: matchesBySession.get(s.id) ?? [] }))),
    dismissed: new Set(dismissed.map((d) => pairKey(d.player_a, d.player_b))),
  })
  const byId = new Map(players.map((p) => [p.id, p]))
  const describe = (p) => ({ id: p.id, name: p.name, matchCount: p.match_count, firstMatchAt: p.first_match_at, hasSignIn: hasSignIn(p) })
  return pairs.map((pair) => ({ reason: pair.reason, text: pair.text, a: describe(byId.get(pair.a)), b: describe(byId.get(pair.b)) }))
}

/**
 * Moves everything of `removeId` onto `keepId` and deletes the removed
 * record, inside the caller's transaction. The caller has already
 * checked mergeRefusal. Team lists are plain uuid arrays (no foreign
 * key), and event payloads name players by id, so both are rewritten
 * here explicitly.
 */
export async function mergePlayers(client, keepId, removeId) {
  await client.query(
    `INSERT INTO session_players (session_id, player_id)
     SELECT session_id, $1 FROM session_players WHERE player_id = $2
     ON CONFLICT DO NOTHING`,
    [keepId, removeId],
  )
  const { rows: moved } = await client.query(
    `UPDATE matches
        SET team_a = array_replace(team_a, $2::uuid, $1::uuid),
            team_b = array_replace(team_b, $2::uuid, $1::uuid)
      WHERE $2::uuid = ANY(team_a) OR $2::uuid = ANY(team_b)
      RETURNING id`,
    [keepId, removeId],
  )
  await client.query('UPDATE matches SET first_server_player = $1 WHERE first_server_player = $2', [keepId, removeId])
  await client.query('UPDATE matches SET right_start_a = $1 WHERE right_start_a = $2', [keepId, removeId])
  await client.query('UPDATE matches SET right_start_b = $1 WHERE right_start_b = $2', [keepId, removeId])
  const movedIds = moved.map((m) => m.id)
  for (const key of PLAYER_ID_KEYS) {
    await client.query(
      `UPDATE match_events SET payload = jsonb_set(payload, ARRAY[$3::text], to_jsonb($1::text))
        WHERE match_id = ANY($4::uuid[]) AND payload->>$3 = $2::text`,
      [keepId, removeId, key, movedIds],
    )
  }
  // session_players, player_ratings and dismissed pairs go with the row (ON DELETE CASCADE).
  await client.query('DELETE FROM players WHERE id = $1', [removeId])
  return { movedMatches: movedIds.length }
}

/** Everything the Overview page shows, for one facilityFilterFor() result. */
export async function loadOverview(queryFn, filter, { isOwner, adminId, now = Date.now() }) {
  const rightNow = await loadRightNow(queryFn, filter, now)
  const [totals, warnings, duplicates] = await Promise.all([
    loadTotals(queryFn, filter, rightNow.activeUmpires),
    loadWarnings(queryFn, filter, { now, adminId }),
    isOwner ? loadDuplicates(queryFn, now) : Promise.resolve(null),
  ])
  const facilityName = filter?.id
    ? (await queryFn('SELECT name FROM facilities WHERE id = $1', [filter.id])).rows[0]?.name ?? null
    : null
  return {
    asOf: new Date(now).toISOString(),
    facilityName,
    live: rightNow.live,
    sessions: rightNow.sessions,
    leftOpen: rightNow.leftOpen,
    totals,
    warnings,
    duplicates,
  }
}
