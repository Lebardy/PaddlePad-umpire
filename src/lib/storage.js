import { DEFAULT_POINT_TARGET, deriveMatchState } from './pickleball'
import { read, write } from './localstore'
import { markDirty, pending as outboxPending } from './outbox'

// ============================================================
// PaddlePad Umpire local persistence layer
//
// This is the DEVICE-LOCAL half of storage. Every write here lands in
// the browser immediately and synchronously, which is what lets an
// umpire keep scoring with no signal: taps are never waiting on a
// network round trip. A separate syncer (lib/sync.js) pushes what is
// here up to the server in the background.
//
// The functions below stay synchronous deliberately. LiveMatch calls
// them between every rally, and making them async would add a loading
// state to an operation that is genuinely instantaneous -- as well as
// an interleaving point where two fast taps could race.
//
// Three record types:
//
//   sessions -- a named event (e.g. a league night); holds the roster
//               (a list of known-player ids) it draws players from.
//   players  -- "known players", shared across every session, so the
//               same player_id accumulates match history over time
//               (the ML pipeline needs repeat matches per player to
//               compute consistency/std features, not just one-off
//               session-local rows).
//   matches  -- one pickleball game (to its own point target, win by
//               2). Stores only an append-only event log (see
//               pickleball.js) plus setup info (teams, stacking,
//               first server, point target); score, server
//               rotation and per-player raw stats are always derived
//               from that log, never stored redundantly. This is what
//               makes "undo last point" trivial (see undoLastEvent).
// ============================================================

const SESSIONS_KEY = 'paddlepad.sessions'
const PLAYERS_KEY = 'paddlepad.players'
const MATCHES_KEY = 'paddlepad.matches'

// Both delegate to localstore, which parses on write and hands back a
// reference-stable value. That stability is what lets the React hooks
// in useLocalStore.js subscribe to these keys without re-rendering
// forever -- see the comment at the top of localstore.js.
function readJSON(key, fallback) {
  return read(key, fallback)
}

function writeJSON(key, value) {
  write(key, value)
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
  markDirty('session', session.id)
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
  markDirty('roster', sessionId)
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
  markDirty('roster', sessionId)
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

// NOTE: `match` must be a NEW object, never one mutated in place.
//
// Reads are reference-stable (see localstore.js), and the React hooks
// compare snapshots with Object.is. Mutating the cached match and
// storing it back leaves getMatch() returning the identical reference,
// so React concludes nothing changed and skips the re-render -- taps
// land in storage but never appear until something else forces a
// render. Every mutator below therefore spreads into a new object.
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
 * @param {number} [params.pointTarget] - 11, 15 or 21. Recorded on the
 *   match rather than assumed, because the winner is re-derived from
 *   the event log on every sync and deriving a game played to 15
 *   against a target of 11 would declare a winner partway through.
 *   Defaults to 11, which is what matches created before this existed
 *   were scored under.
 * @returns {object} the created match record.
 */
export function createMatch({
  sessionId,
  teamA,
  teamB,
  stacking,
  firstServer,
  pointTarget = DEFAULT_POINT_TARGET,
}) {
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
    pointTarget, // 11 | 15 | 21; fixed for the life of the match
    events: [],
    winner: null,
  }
  writeJSON(MATCHES_KEY, [match, ...getMatches()])
  markDirty('match', match.id)
  return match
}

// Recomputes derived score/completion after mutating a match's event
// log, and freezes endedAt/status/winner the moment the game is won so
// exported match_duration_mins stays fixed once play stops.
function finalizeAfterEventChange(match) {
  const derived = deriveMatchState(match)

  let next = match
  if (derived.completed && match.status !== 'completed') {
    next = {
      ...match,
      status: 'completed',
      endedAt: Date.now(),
      winner: derived.winner,
    }
  } else if (!derived.completed && match.status === 'completed') {
    // an undo reverted the winning point
    next = { ...match, status: 'in_progress', endedAt: null, winner: null }
  }

  markDirty('log', next.id)
  return saveMatch(next)
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
  return finalizeAfterEventChange({
    ...match,
    events: [
      ...match.events,
      { type: 'rally', id: crypto.randomUUID(), at: Date.now(), actingPlayerId, outcome, zone },
    ],
  })
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
  return finalizeAfterEventChange({
    ...match,
    events: [
      ...match.events,
      { type: 'thirdShot', id: crypto.randomUUID(), at: Date.now(), playerId, shotType, success },
    ],
  })
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
  return finalizeAfterEventChange({
    ...match,
    events: match.events.slice(0, -1),
  })
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
  const next = {
    ...match,
    status: 'completed',
    endedAt: Date.now(),
    winner: derived.score.A === derived.score.B ? null : derived.winner,
    endedEarly: true,
  }
  markDirty('log', next.id)
  return saveMatch(next)
}

// ============================================================
// Merging server state into the local cache
// ============================================================

/**
 * Folds freshly pulled server data into local storage.
 *
 * THE RULE: a pull must never destroy work this device still owes the
 * server. If a match is queued in the outbox, its local version is the
 * newer one -- the server simply hasn't heard about those taps yet --
 * so the local copy wins and the pull skips it. Overwriting it would
 * silently delete an umpire's rallies, which is the worst bug this app
 * could have.
 *
 * Everything not queued is safe to replace, since the server is the
 * shared source of truth for it.
 */
export function replaceServerState({
  players,
  sessions,
  sessionDetail,
  matches,
  // Overrides the never-clobber-queued-work rule. Used ONLY by an
  // explicit takeover, where the umpire has been asked and has chosen
  // the server's version. Never set it for a background pull.
  force = false,
}) {
  if (players) {
    writeJSON(
      PLAYERS_KEY,
      players.map((p) => ({ id: p.id, name: p.name })),
    )
  }

  if (sessions) {
    const dirty = new Set(
      pendingEntities('session').concat(pendingEntities('roster')),
    )
    const local = getSessions()
    const merged = sessions.map((s) => {
      const mine = local.find((l) => l.id === s.id)
      // Keep the local roster if this device still owes the server one.
      if (mine && dirty.has(s.id)) return mine
      return {
        id: s.id,
        name: s.name,
        createdAt: new Date(s.created_at).getTime(),
        voidedAt: s.voided_at ? new Date(s.voided_at).getTime() : null,
        voidReason: s.void_reason ?? null,
        playerIds: mine?.playerIds ?? [],
      }
    })
    // Sessions created here and not yet accepted must survive the pull;
    // ones cancelled here but not yet deleted server-side must not come
    // back from the dead.
    const buriedSessions = new Set(getTombstones().sessions)
    const unsent = local.filter((l) => !sessions.some((s) => s.id === l.id))
    writeJSON(
      SESSIONS_KEY,
      [...unsent, ...merged].filter((s) => !buriedSessions.has(s.id)),
    )
  }

  if (sessionDetail?.session) {
    const dirty = new Set(pendingEntities('roster'))
    if (!dirty.has(sessionDetail.session.id)) {
      const updated = getSessions().map((s) =>
        s.id === sessionDetail.session.id
          ? { ...s, playerIds: sessionDetail.session.playerIds }
          : s,
      )
      writeJSON(SESSIONS_KEY, updated)
    }
  }

  if (matches) {
    const dirty = force
      ? new Set()
      : new Set(pendingEntities('match').concat(pendingEntities('log')))
    const local = getMatches()
    const fromServer = matches
      .filter((m) => !dirty.has(m.id))
      .map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        createdAt: new Date(m.startedAt).getTime(),
        startedAt: new Date(m.startedAt).getTime(),
        endedAt: m.endedAt ? new Date(m.endedAt).getTime() : null,
        status: m.status,
        teamA: m.teamA,
        teamB: m.teamB,
        stacking: m.stacking,
        firstServer: m.firstServer,
        // Must be carried across, not defaulted: deriveMatchState falls
        // back to 11 without it, so a game played to 15 would be
        // declared won at 11 on every device that pulled the match
        // rather than creating it.
        pointTarget: m.pointTarget,
        winner: m.winner,
        endedEarly: m.endedEarly,
        // Voiding happens on one device and has to be visible on the
        // others, otherwise a match thrown out here still looks live
        // there.
        voidedAt: m.voidedAt ? new Date(m.voidedAt).getTime() : null,
        voidReason: m.voidReason ?? null,
        // A match list carries no events -- only the single-match fetch
        // does. Defaulting to [] here would wipe the local log of an
        // already-synced match every time the session screen refreshed.
        events: m.events
          ? m.events.map((e) => ({ ...e }))
          : (local.find((l) => l.id === m.id)?.events ?? []),
      }))

    const buried = new Set(getTombstones().matches)
    const kept = fromServer.filter((m) => !buried.has(m.id))
    const serverIds = new Set(kept.map((m) => m.id))
    const keptLocal = local.filter((m) => dirty.has(m.id) || !serverIds.has(m.id))
    writeJSON(MATCHES_KEY, [...keptLocal, ...kept])
  }
}

/** Entity ids of a given kind currently queued for the server. */
function pendingEntities(kind) {
  return outboxPending()
    .filter((entry) => entry.kind === kind)
    .map((entry) => entry.entityId)
}

/**
 * Caches a server player locally so their name resolves offline.
 *
 * Unlike the old upsertKnownPlayer this never MINTS an id -- the server
 * is the only thing allowed to do that, because one name means one
 * person and two devices inventing ids for the same human is exactly
 * the fragmentation the shared registry exists to prevent.
 */
export function rememberPlayer(player) {
  const players = getKnownPlayers()
  if (players.some((p) => p.id === player.id)) return player
  writeJSON(PLAYERS_KEY, [...players, { id: player.id, name: player.name }])
  return player
}

// ============================================================
// One-time cleanup of pre-server data
// ============================================================

const SCHEMA_KEY = 'paddlepad.schemaVersion'
const SCHEMA_VERSION = 2

/**
 * Clears data written before the server existed.
 *
 * Those records carry player ids this device invented for itself, which
 * no longer resolve against the shared registry -- so a session would
 * render with players that cannot be found and matches that can never
 * sync. Discarding is what the project owner chose: it was all test
 * data, and keeping it would have meant an id-rewriting importer that
 * is far more risk than the data is worth.
 *
 * Runs once, guarded by a version stamp, so it cannot eat real data on
 * a later launch.
 */
export function migrateLegacyData() {
  const stored = read(SCHEMA_KEY, null)
  if (stored === SCHEMA_VERSION) return { cleared: false }

  const had = {
    sessions: getSessions().length,
    matches: getMatches().length,
    players: getKnownPlayers().length,
  }

  if (stored === null && (had.sessions || had.matches || had.players)) {
    writeJSON(SESSIONS_KEY, [])
    writeJSON(MATCHES_KEY, [])
    writeJSON(PLAYERS_KEY, [])
    write(SCHEMA_KEY, SCHEMA_VERSION)
    return { cleared: true, had }
  }

  write(SCHEMA_KEY, SCHEMA_VERSION)
  return { cleared: false }
}

// ============================================================
// Cancelling sessions and matches
// ============================================================

const TOMBSTONES_KEY = 'paddlepad.tombstones'

/**
 * Ids deleted here but not yet deleted on the server.
 *
 * Tombstones exist because the outbox reads each entry's payload from
 * local storage at push time, and a deleted record has none -- without
 * a marker the queued delete would look like a vanished entity and be
 * quietly dropped. They also stop a pull that lands before the delete
 * syncs from resurrecting what the umpire just cancelled.
 */
function getTombstones() {
  return read(TOMBSTONES_KEY, { matches: [], sessions: [] })
}

function addTombstone(kind, id) {
  const current = getTombstones()
  if (current[kind].includes(id)) return
  write(TOMBSTONES_KEY, { ...current, [kind]: [...current[kind], id] })
}

export function clearTombstone(kind, id) {
  const current = getTombstones()
  write(TOMBSTONES_KEY, {
    ...current,
    [kind]: current[kind].filter((existing) => existing !== id),
  })
}

export function isTombstoned(kind, id) {
  return getTombstones()[kind].includes(id)
}

/**
 * Cancels an unfinished match -- wrong pairing, wrong court, started by
 * mistake. Removed outright, because nothing in it counted yet.
 */
export function deleteMatch(matchId) {
  const match = getMatch(matchId)
  if (!match || match.status === 'completed') return false

  writeJSON(MATCHES_KEY, getMatches().filter((m) => m.id !== matchId))
  addTombstone('matches', matchId)
  markDirty('matchDelete', matchId)
  return true
}

/**
 * Voids a FINISHED match so the ML export skips it, while keeping the
 * record.
 *
 * Finished play is a real thing that happened; it was just attributed
 * to the wrong people. Keeping the row leaves the mistake auditable and
 * lets it be undone, and what actually matters is that the export drops
 * it -- a mis-paired match credits one player's rallies to another, and
 * nothing downstream could ever notice.
 */
export function voidMatch(matchId, reason = '') {
  const match = getMatch(matchId)
  if (!match) return false
  saveMatch({ ...match, voidedAt: Date.now(), voidReason: reason || null })
  markDirty('matchVoid', matchId)
  return true
}

export function unvoidMatch(matchId) {
  const match = getMatch(matchId)
  if (!match) return false
  saveMatch({ ...match, voidedAt: null, voidReason: null })
  markDirty('matchVoid', matchId)
  return true
}

/**
 * Cancels a session and any unfinished matches in it.
 *
 * Refused when a match inside has finished: that is real recorded play,
 * and the server refuses too. Those should be voided individually if
 * they were wrong, which keeps the decision explicit per match rather
 * than sweeping several away at once.
 */
export function deleteSession(sessionId) {
  const matches = getMatches().filter((m) => m.sessionId === sessionId)
  if (matches.some((m) => m.status === 'completed')) return false

  writeJSON(MATCHES_KEY, getMatches().filter((m) => m.sessionId !== sessionId))
  writeJSON(SESSIONS_KEY, getSessions().filter((s) => s.id !== sessionId))
  for (const match of matches) addTombstone('matches', match.id)
  addTombstone('sessions', sessionId)
  markDirty('sessionDelete', sessionId)
  return true
}

/**
 * Voids a whole session so the export skips every match in it, while
 * keeping all the records.
 *
 * The answer for a session that can't be deleted because real play
 * happened in it -- a duplicate night, the wrong court, a practice run
 * recorded in earnest. Deleting would destroy genuine history; voiding
 * only stops the ML pipeline being fed it.
 *
 * Individual matches keep their own voided state, so restoring this
 * later brings back only the ones that were fine.
 */
export function voidSession(sessionId, reason = '') {
  const session = getSession(sessionId)
  if (!session) return false
  const updated = getSessions().map((s) =>
    s.id === sessionId ? { ...s, voidedAt: Date.now(), voidReason: reason || null } : s,
  )
  writeJSON(SESSIONS_KEY, updated)
  markDirty('sessionVoid', sessionId)
  return true
}

export function unvoidSession(sessionId) {
  const session = getSession(sessionId)
  if (!session) return false
  const updated = getSessions().map((s) =>
    s.id === sessionId ? { ...s, voidedAt: null, voidReason: null } : s,
  )
  writeJSON(SESSIONS_KEY, updated)
  markDirty('sessionVoid', sessionId)
  return true
}
