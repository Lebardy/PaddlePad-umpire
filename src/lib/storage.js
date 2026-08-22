import { deriveMatchState } from './pickleball'

// ============================================================
// PaddlePad Umpire persistence layer
//
// Everything lives in the browser's localStorage under three keys --
// there is no backend yet. Three record types:
//
//   sessions -- a named event (e.g. a league night); holds the roster
//               (a list of known-player ids) it draws players from.
//   players  -- "known players", shared across every session, so the
//               same player_id accumulates match history over time
//               (the ML pipeline needs repeat matches per player to
//               compute consistency/std features, not just one-off
//               session-local rows).
//   matches  -- one pickleball game (to 11, win by 2). Stores only an
//               append-only event log (see pickleball.js) plus setup
//               info (teams/stacking/first server); score, server
//               rotation and per-player raw stats are always derived
//               from that log, never stored redundantly. This is what
//               makes "undo last point" trivial (see undoLastEvent).
// ============================================================

const SESSIONS_KEY = 'paddlepad.sessions'
const PLAYERS_KEY = 'paddlepad.players'
const MATCHES_KEY = 'paddlepad.matches'

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

/** Every session, newest first. */
export function getSessions() {
  return readJSON(SESSIONS_KEY, [])
}

/** A single session by id, or null if it doesn't exist. */
export function getSession(sessionId) {
  return getSessions().find((s) => s.id === sessionId) ?? null
}

/** Creates a session with an empty roster and stores it. */
export function createSession(name) {
  const session = {
    id: crypto.randomUUID(),
    name: name.trim(),
    createdAt: Date.now(),
    playerIds: [],
  }
  writeJSON(SESSIONS_KEY, [session, ...getSessions()])
  return session
}

/** Every player ever tracked, shared across all sessions. */
export function getKnownPlayers() {
  return readJSON(PLAYERS_KEY, [])
}

// Returns the existing known player if the name already matches one
// (case-insensitive), otherwise creates and stores a new one. Stands in
// for a real player identity until sessions have a backend to join
// against.
export function upsertKnownPlayer(name) {
  const trimmed = name.trim()
  const players = getKnownPlayers()
  const existing = players.find(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
  )
  if (existing) return existing

  const player = { id: crypto.randomUUID(), name: trimmed }
  writeJSON(PLAYERS_KEY, [...players, player])
  return player
}

/** Adds a known player to a session's roster (idempotent). */
export function addPlayerToSession(sessionId, playerId) {
  const updated = getSessions().map((s) =>
    s.id === sessionId && !s.playerIds.includes(playerId)
      ? { ...s, playerIds: [...s.playerIds, playerId] }
      : s,
  )
  writeJSON(SESSIONS_KEY, updated)
  return updated.find((s) => s.id === sessionId)
}

/**
 * Removes a player from a session's roster. Does not touch any match
 * already recorded for them -- past match history and stats stay
 * intact even if they're later removed from the session roster.
 */
export function removePlayerFromSession(sessionId, playerId) {
  const updated = getSessions().map((s) =>
    s.id === sessionId
      ? { ...s, playerIds: s.playerIds.filter((id) => id !== playerId) }
      : s,
  )
  writeJSON(SESSIONS_KEY, updated)
  return updated.find((s) => s.id === sessionId)
}

// ============================================================
// Matches
// ============================================================

/** All matches ever played, across every session, newest first. */
export function getMatches() {
  return readJSON(MATCHES_KEY, [])
}

/** Matches belonging to one session, for the SessionDetail match list. */
export function getMatchesForSession(sessionId) {
  return getMatches().filter((m) => m.sessionId === sessionId)
}

/** A single match by id, or null if it doesn't exist. */
export function getMatch(matchId) {
  return getMatches().find((m) => m.id === matchId) ?? null
}

function saveMatch(match) {
  const updated = getMatches().map((m) => (m.id === match.id ? match : m))
  writeJSON(MATCHES_KEY, updated)
  return match
}

/**
 * Starts a new match and persists it as `in_progress` with an empty
 * event log.
 *
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string[]} params.teamA - 1 player id (singles) or 2 (doubles).
 * @param {string[]} params.teamB - same length as teamA.
 * @param {{A: boolean, B: boolean}} params.stacking - per-team doubles
 *   stacking flag; recorded as `uses_stacking` on every player on that
 *   team when the match is exported.
 * @param {{team: 'A'|'B', playerId: string}} params.firstServer - who
 *   serves first; for doubles this also fixes which of the two
 *   teammates is "server 1" vs "server 2" for the rest of the game.
 * @returns {object} the created match record.
 */
export function createMatch({ sessionId, teamA, teamB, stacking, firstServer }) {
  const match = {
    id: crypto.randomUUID(),
    sessionId,
    createdAt: Date.now(),
    startedAt: Date.now(),
    endedAt: null,
    status: 'in_progress',
    teamA,
    teamB,
    stacking, // { A: bool, B: bool }
    firstServer, // { team: 'A'|'B', playerId }
    events: [],
    winner: null,
  }
  writeJSON(MATCHES_KEY, [match, ...getMatches()])
  return match
}

// Recomputes derived score/completion after mutating a match's event
// log, and freezes endedAt/status/winner the moment the game is won so
// exported match_duration_mins stays fixed once play stops.
function finalizeAfterEventChange(match) {
  const derived = deriveMatchState(match)
  if (derived.completed && match.status !== 'completed') {
    match.status = 'completed'
    match.endedAt = Date.now()
    match.winner = derived.winner
  } else if (!derived.completed && match.status === 'completed') {
    // an undo reverted the winning point
    match.status = 'in_progress'
    match.endedAt = null
    match.winner = null
  }
  return saveMatch(match)
}

/**
 * Logs how a rally ended: `outcome` is 'winner' (actingPlayerId hit an
 * outright winner, so their team scores/keeps serve per side-out
 * rules) or 'error' (actingPlayerId committed the fault, so the OTHER
 * team scores/keeps serve). `zone` is 'dink' or 'open', and together
 * with `outcome` selects which of the four raw stat buckets
 * (dink/clean winners, dink/unforced errors) gets incremented -- see
 * deriveMatchState in pickleball.js. No-op once the match is completed.
 */
export function addRallyEvent(matchId, { actingPlayerId, outcome, zone }) {
  const match = getMatch(matchId)
  if (!match || match.status === 'completed') return match
  match.events = [
    ...match.events,
    { type: 'rally', id: crypto.randomUUID(), at: Date.now(), actingPlayerId, outcome, zone },
  ]
  return finalizeAfterEventChange(match)
}

/**
 * Logs a serving team's 3rd-shot choice (drop or drive), independent
 * of how the rally that contained it eventually ended. `success` only
 * applies to drops (did it land as an effective drop) and is ignored
 * for drives, matching drop_attempts/drop_successes/drive_attempts in
 * the ML schema.
 */
export function addThirdShotEvent(matchId, { playerId, shotType, success }) {
  const match = getMatch(matchId)
  if (!match || match.status === 'completed') return match
  match.events = [
    ...match.events,
    { type: 'thirdShot', id: crypto.randomUUID(), at: Date.now(), playerId, shotType, success },
  ]
  return finalizeAfterEventChange(match)
}

/**
 * Removes the most recent event and re-derives state from what's left.
 * Because score/stats are never stored directly (only the event log
 * is), this correctly un-does a mis-tap even if it was the point that
 * had just ended the game -- finalizeAfterEventChange reopens the
 * match if the undo drops it back below the win condition.
 */
export function undoLastEvent(matchId) {
  const match = getMatch(matchId)
  if (!match || match.events.length === 0) return match
  match.events = match.events.slice(0, -1)
  return finalizeAfterEventChange(match)
}

/**
 * Force-ends a match that won't reach its normal win condition (e.g.
 * a retirement or forfeit mid-game), locking in whatever score and
 * per-player stats have accumulated so far. `winner` is left null on
 * a tied score, since side-out play has no tiebreak concept to fall
 * back on here.
 */
export function endMatchManually(matchId) {
  const match = getMatch(matchId)
  if (!match || match.status === 'completed') return match
  const derived = deriveMatchState(match)
  match.status = 'completed'
  match.endedAt = Date.now()
  match.winner = derived.score.A === derived.score.B ? null : derived.winner
  return saveMatch(match)
}

// ============================================================
// ML pipeline export
//
// Produces one row per player per completed match, matching the exact
// column shape aggregate_player_profiles() in the PaddlePad ML repo
// expects (see data_generator.generate_unlabeled_match_logs there).
// ============================================================

// The 12 columns the ML pipeline actually reads today. Kept first and
// in this exact order so the CSV stays a drop-in superset of what
// data_generator.generate_unlabeled_match_logs() produces.
const ML_PIPELINE_COLUMNS = [
  'player_id',
  'match_id',
  'match_number',
  'drop_attempts',
  'drop_successes',
  'drive_attempts',
  'dink_errors',
  'clean_winners',
  'dink_winners',
  'unforced_errors',
  'match_duration_mins',
  'uses_stacking',
]

// Match context the pipeline does NOT read yet, recorded now because
// it's already captured during play and costs the umpire nothing.
//
// Without these, the pipeline can never do the two things it currently
// can't: opponent-adjusted skill (so beating weak players doesn't
// inflate a rating the way raw per-minute rates do) and growth over
// time (aggregate_player_profiles collapses a player's whole history
// into one row, so improvement is invisible and even reads as
// inconsistency in the *_std features).
//
// Opponents are separate columns rather than one packed field on
// purpose: matchLogsToCSV does a bare comma join with no quoting, so
// any value containing a comma would silently corrupt the file.
//
// Adding these is safe. Every stage of the ML pipeline selects its
// columns by explicit name (player_profiles.py, feature_engineering.py
// and clustering.py all use literal column lists, never select_dtypes
// or positional slicing), so unknown columns are dropped at the first
// step rather than leaking into the feature space. `uses_stacking` is
// the existing precedent -- it has been carried and ignored all along.
const CONTEXT_COLUMNS = [
  'team',
  'won',
  'partner_id',
  'opponent_1_id',
  'opponent_2_id',
  'ended_at',
]

const RAW_MATCH_LOG_COLUMNS = [...ML_PIPELINE_COLUMNS, ...CONTEXT_COLUMNS]

/**
 * Flattens every completed match into one row per player per match,
 * in exactly the shape the PaddlePad ML pipeline's
 * aggregate_player_profiles() consumes (see
 * ~/skul/PaddlePad/PaddlePad/data_generator.py for the reference
 * column set this mirrors). In-progress matches are excluded since
 * their stats and match_duration_mins aren't final yet.
 *
 * match_number is computed here rather than stored, because it means
 * "this player's Nth completed match ever" -- it has to be assigned
 * across the whole export in chronological order, not per match.
 *
 * Rows also carry the CONTEXT_COLUMNS (who won, partner, opponents,
 * timestamp), which the pipeline ignores today but which are required
 * for any future opponent-adjusted rating or growth-over-time work.
 * Because those are derived from data already stored on each match,
 * re-exporting recovers them for matches logged before this existed.
 *
 * @returns {object[]} rows keyed by the RAW_MATCH_LOG_COLUMNS names.
 */
export function exportRawMatchLogs() {
  const completed = getMatches().filter((m) => m.status === 'completed')

  const rows = []
  for (const match of completed) {
    const derived = deriveMatchState(match)
    const durationMins = (match.endedAt - match.startedAt) / 60000
    const players = [
      ...match.teamA.map((playerId) => ({ playerId, team: 'A' })),
      ...match.teamB.map((playerId) => ({ playerId, team: 'B' })),
    ]

    for (const { playerId, team } of players) {
      const stats = derived.stats[playerId]
      const ownTeam = team === 'A' ? match.teamA : match.teamB
      const opponents = team === 'A' ? match.teamB : match.teamA
      const partnerId = ownTeam.find((id) => id !== playerId) ?? ''

      rows.push({
        player_id: playerId,
        match_id: match.id,
        drop_attempts: stats.drop_attempts,
        drop_successes: stats.drop_successes,
        drive_attempts: stats.drive_attempts,
        dink_errors: stats.dink_errors,
        clean_winners: stats.clean_winners,
        dink_winners: stats.dink_winners,
        unforced_errors: stats.unforced_errors,
        match_duration_mins: Math.round(durationMins * 100) / 100,
        uses_stacking: match.stacking[team] ? 1 : 0,

        // Context columns -- see CONTEXT_COLUMNS. `won` is left blank
        // rather than 0 when a match was ended early at a tied score,
        // so "did not win" and "no result" stay distinguishable.
        team,
        won: match.winner === null ? '' : match.winner === team ? 1 : 0,
        partner_id: partnerId,
        opponent_1_id: opponents[0] ?? '',
        opponent_2_id: opponents[1] ?? '',
        ended_at: new Date(match.endedAt).toISOString(),

        _endedAt: match.endedAt,
      })
    }
  }

  // match_number: each player's Nth completed match, in play order.
  const countByPlayer = {}
  rows.sort((a, b) => a._endedAt - b._endedAt)
  for (const row of rows) {
    countByPlayer[row.player_id] = (countByPlayer[row.player_id] ?? 0) + 1
    row.match_number = countByPlayer[row.player_id]
    delete row._endedAt
  }

  return rows
}

/** Serializes exportRawMatchLogs() rows to a CSV string, header first. */
export function matchLogsToCSV(rows) {
  const lines = [RAW_MATCH_LOG_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(RAW_MATCH_LOG_COLUMNS.map((col) => row[col]).join(','))
  }
  return lines.join('\n')
}
