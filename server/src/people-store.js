// ============================================================
// Reading people for the admin site. Writes live in the routes, inside
// the transaction that records the activity entry.
// ============================================================

import { PEOPLE_PAGE_SIZE, likePattern, makeCursor, playerListItem, readCursor, umpireListItem } from './people-rules.js'
import { countMatchesInProgress, getPlayerMatches, getRatingState } from './player-stats.js'
import { deriveMatchState, eventFromRow } from './pickleball.js'

const PLAYER_COLUMNS = `p.id, p.name, p.username, p.password_hash, p.google_sub, p.google_email,
  p.claim_code, p.claimed_at, p.name_visible, p.created_at, p.last_signed_in_at,
  p.paused_at, p.paused_reason, p.deactivated_at, p.closed_by_admin_at, p.created_by`
const UMPIRE_COLUMNS = `u.id, u.name, u.email, u.password_hash, u.google_sub, u.google_email,
  u.created_at, u.last_signed_in_at, u.paused_at, u.paused_reason, u.closed_at`

const STATUS_SQL = {
  players: {
    all: 'TRUE',
    active: 'p.deactivated_at IS NULL AND p.paused_at IS NULL',
    paused: 'p.deactivated_at IS NULL AND p.paused_at IS NOT NULL',
    closed: 'p.deactivated_at IS NOT NULL',
  },
  umpires: {
    all: 'TRUE',
    active: 'u.closed_at IS NULL AND u.paused_at IS NULL',
    paused: 'u.closed_at IS NULL AND u.paused_at IS NOT NULL',
    closed: 'u.closed_at IS NOT NULL',
  },
}

/** One page of a list, newest first, plus the cursor for the next page. */
async function listPage(queryFn, { table, alias, columns, searchColumns, status, q, after, toItem }) {
  const params = []
  const where = [STATUS_SQL[table][status]]
  const pattern = likePattern(q)
  if (pattern) {
    params.push(pattern)
    where.push(`(${searchColumns.map((c) => `lower(${alias}.${c}) LIKE $${params.length} ESCAPE '\\'`).join(' OR ')})`)
  }
  const cursor = readCursor(after)
  if (cursor) {
    params.push(cursor.createdAt, cursor.id)
    where.push(`(${alias}.created_at, ${alias}.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
  }
  params.push(PEOPLE_PAGE_SIZE + 1)
  const { rows } = await queryFn(
    `SELECT ${columns} FROM ${table} ${alias}
      WHERE ${where.join(' AND ')}
      ORDER BY ${alias}.created_at DESC, ${alias}.id DESC
      LIMIT $${params.length}`,
    params,
  )
  const page = rows.slice(0, PEOPLE_PAGE_SIZE)
  return { items: page.map(toItem), next: rows.length > PEOPLE_PAGE_SIZE ? makeCursor(page[page.length - 1]) : null }
}

export function listPlayers(queryFn, { status, q, after }) {
  return listPage(queryFn, {
    table: 'players', alias: 'p', columns: PLAYER_COLUMNS,
    searchColumns: ['name', 'username', 'google_email'], status, q, after, toItem: playerListItem,
  })
}

export function listUmpires(queryFn, { status, q, after }) {
  return listPage(queryFn, {
    table: 'umpires', alias: 'u', columns: UMPIRE_COLUMNS,
    searchColumns: ['name', 'email', 'google_email'], status, q, after, toItem: umpireListItem,
  })
}

export async function findPlayerRow(queryFn, id, { lock = false } = {}) {
  const { rows } = await queryFn(
    `SELECT ${PLAYER_COLUMNS}, c.name AS created_by_name
       FROM players p LEFT JOIN umpires c ON c.id = p.created_by
      WHERE p.id = $1${lock ? ' FOR UPDATE OF p' : ''}`,
    [id],
  )
  return rows[0] ?? null
}

export async function findUmpireRow(queryFn, id, { lock = false } = {}) {
  const { rows } = await queryFn(
    `SELECT ${UMPIRE_COLUMNS} FROM umpires u WHERE u.id = $1${lock ? ' FOR UPDATE' : ''}`,
    [id],
  )
  return rows[0] ?? null
}

const RECENT = 20

/** Everything the player page shows. Never the claim code or password hash. */
export async function playerDetail(queryFn, row) {
  const matches = await getPlayerMatches(queryFn, row.id)
  const recent = matches.slice(0, RECENT)
  const [matchesInProgress, rating, scoredBy] = await Promise.all([
    countMatchesInProgress(queryFn, row.id),
    getRatingState(queryFn, row.id, matches.length),
    scoringUmpireNames(queryFn, recent),
  ])
  return {
    ...playerListItem(row),
    googleEmail: row.google_email ?? null,
    pausedAt: row.paused_at ?? null,
    pausedReason: row.paused_reason ?? null,
    closedAt: row.deactivated_at ?? null,
    closedByAdmin: Boolean(row.closed_by_admin_at),
    createdBy: row.created_by_name ?? null,
    matchCount: matches.length,
    matches: recent.map((m) => ({
      id: m.id, endedAt: m.endedAt, sessionName: m.sessionName, isDoubles: m.isDoubles,
      partner: m.partner, opponents: m.opponents, yourScore: m.yourScore, theirScore: m.theirScore, won: m.won,
      scoredBy: scoredBy.get(m.id) ?? 'Unknown',
    })),
    matchesInProgress,
    rating: rating.state === 'rated'
      ? { state: 'rated', skillScore: rating.skillScore, playstyle: rating.playstyleArchetype, skillGroup: rating.skillGroup, fromMatches: rating.fromMatches, computedAt: rating.computedAt }
      : rating,
  }
}

/**
 * Which umpire scored each of these matches, by match id.
 *
 * getPlayerMatches doesn't carry recorded_by -- it is built for the
 * player's own history screen, which has no reason to name the umpire.
 * The admin page does, so this is one small extra lookup rather than a
 * change to a function several other screens share.
 */
async function scoringUmpireNames(queryFn, matches) {
  if (matches.length === 0) return new Map()
  const { rows } = await queryFn(
    `SELECT m.id, u.name
       FROM matches m LEFT JOIN umpires u ON u.id = m.recorded_by
      WHERE m.id = ANY($1::uuid[])`,
    [matches.map((m) => m.id)],
  )
  return new Map(rows.map((r) => [r.id, r.name ?? null]))
}

/** Everything the umpire page shows. */
export async function umpireDetail(queryFn, row) {
  const [{ rows: invite }, { rows: scored }, { rows: live }, { rows: total }] = await Promise.all([
    queryFn('SELECT code, note FROM invites WHERE used_by = $1 ORDER BY used_at DESC LIMIT 1', [row.id]),
    queryFn(
      `SELECT m.id, m.team_a, m.team_b, m.first_server_team, m.first_server_player, m.right_start_a, m.right_start_b,
              m.point_target, m.status, m.winner, m.started_at, m.ended_at, s.name AS session_name
         FROM matches m JOIN sessions s ON s.id = m.session_id
        WHERE m.recorded_by = $1 AND m.voided_at IS NULL AND s.voided_at IS NULL
        ORDER BY m.started_at DESC LIMIT ${RECENT}`,
      [row.id],
    ),
    queryFn(
      `SELECT count(*)::int AS n FROM matches m JOIN sessions s ON s.id = m.session_id
        WHERE m.recorded_by = $1 AND m.status = 'in_progress' AND m.voided_at IS NULL AND s.voided_at IS NULL`,
      [row.id],
    ),
    // The same filters as `scored` above, but every match rather than
    // the 20 shown -- so the page can tell 20 from 200 rather than
    // showing "20+" forever.
    queryFn(
      `SELECT count(*)::int AS n FROM matches m JOIN sessions s ON s.id = m.session_id
        WHERE m.recorded_by = $1 AND m.voided_at IS NULL AND s.voided_at IS NULL`,
      [row.id],
    ),
  ])

  let matches = []
  if (scored.length > 0) {
    const ids = scored.map((m) => m.id)
    const [{ rows: events }, { rows: people }] = await Promise.all([
      queryFn('SELECT match_id, id, type, payload FROM match_events WHERE match_id = ANY($1::uuid[]) ORDER BY match_id, seq', [ids]),
      queryFn('SELECT id, name FROM players WHERE id = ANY($1::uuid[])', [[...new Set(scored.flatMap((m) => [...m.team_a, ...m.team_b]))]]),
    ])
    const eventsByMatch = new Map()
    for (const event of events) {
      if (!eventsByMatch.has(event.match_id)) eventsByMatch.set(event.match_id, [])
      eventsByMatch.get(event.match_id).push(eventFromRow(event))
    }
    const nameOf = new Map(people.map((p) => [p.id, p.name]))
    matches = scored.map((m) => {
      const derived = deriveMatchState({
        teamA: m.team_a, teamB: m.team_b,
        firstServer: { team: m.first_server_team, playerId: m.first_server_player },
        rightStart: { A: m.right_start_a, B: m.right_start_b },
        pointTarget: m.point_target,
        events: eventsByMatch.get(m.id) ?? [],
      })
      return {
        id: m.id, sessionName: m.session_name, startedAt: m.started_at, endedAt: m.ended_at, status: m.status, winner: m.winner,
        teamA: m.team_a.map((id) => nameOf.get(id) ?? 'Unknown'), teamB: m.team_b.map((id) => nameOf.get(id) ?? 'Unknown'),
        scoreA: derived.score.A, scoreB: derived.score.B,
      }
    })
  }

  return {
    ...umpireListItem(row),
    googleEmail: row.google_email ?? null,
    pausedAt: row.paused_at ?? null,
    pausedReason: row.paused_reason ?? null,
    closedAt: row.closed_at ?? null,
    invite: invite[0] ? { code: invite[0].code, note: invite[0].note } : null,
    matches,
    matchCount: total[0].n,
    matchesInProgress: live[0].n,
  }
}
