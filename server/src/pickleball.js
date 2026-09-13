// ============================================================
// Pickleball scoring engine  —  SHARED by the server and the app
//
// The app imports this through the re-export shim at
// src/lib/pickleball.js. It lives here rather than in src/ because the
// Railway API service builds with its root directory set to `server/`,
// so a file outside this directory would not be uploaded and a server
// import of it would break in production while working locally. The
// client build runs from the repo root and can reach in here fine, so
// this is the only path both sides can resolve.
//
// Keep it dependency-free. It must stay importable from plain Node with
// no bundler and no browser APIs.
//
// The server re-derives match status from this on every sync rather
// than trusting what a device reports, so a client bug cannot push a
// fabricated final score into the ML export. That is the whole reason
// the two sides share one engine instead of each having their own.
//
// Official side-out scoring: only the serving team can score. Doubles
// gets two servers per side-out except the very first service of the
// game, which is a single "server #2" turn (the standard 0-0-2 start
// announced at the beginning of a game).
//
// The point target travels with each match (11, 15 or 21) since it
// varies by format; win-by-two applies to all of them. One match here
// is one "game" at the granularity the PaddlePad ML pipeline expects
// (see pklmart_import.py in that repo).
//
// This module is pure and has no dependency on storage.js: every
// function here takes plain data in and returns plain data out, so
// score/server/stat state is always a deterministic fold over a
// match's event log rather than something mutated and persisted
// separately. That's what makes "undo the last point" in storage.js
// safe -- popping an event and re-running deriveMatchState always
// reproduces the correct prior state.
// ============================================================

/** A fresh zeroed accumulator for the ML pipeline's raw per-player stat columns. */
export function emptyStats() {
  return {
    drop_attempts: 0,
    drop_successes: 0,
    drive_attempts: 0,
    dink_errors: 0,
    clean_winners: 0,
    dink_winners: 0,
    unforced_errors: 0,
    // Whether the third shot actually WON the point, which is a
    // different question from whether the drop landed.
    // drop_successes is the umpire's judgement that the ball arrived
    // soft at the net; these say what happened to the rally afterwards.
    //
    // Only rallies carrying a thirdShotId count here, so they are
    // always <= the attempt counts above: a third shot the umpire
    // skipped, or one logged by a client from before rallies recorded
    // the link, is absent rather than assumed lost.
    drop_rallies: 0,
    drop_rallies_won: 0,
    drive_rallies: 0,
    drive_rallies_won: 0,
  }
}

// Games are usually to 11, but 15 and 21 are both normal depending on
// the format, so the target travels with the match rather than being
// baked into the rules. Older matches carry no target and are read as
// 11, which is what they were scored under.
export const DEFAULT_POINT_TARGET = 11

/** Point targets the app offers. Win-by-two applies to all of them. */
export const POINT_TARGETS = [11, 15, 21]

/**
 * How an event is split to be stored in match_events: its id, order,
 * type and time get columns of their own, and everything else goes in
 * `payload`.
 */
export function eventToRow(event) {
  const { id, seq, type, at, ...payload } = event
  return { id, seq, type, at, payload }
}

/**
 * The reverse of eventToRow, for a row read back from match_events.
 *
 * The id has to come back with it. A rally names the third shot it
 * followed by that shot's id, and the id lives in its own column, not
 * in the payload -- so a reader that rebuilt events from `type` and
 * `payload` alone silently lost every link, and "when you drop, you
 * win the point" came out empty for every player.
 */
export function eventFromRow(row) {
  return { id: row.id, type: row.type, ...row.payload }
}

/**
 * The winning team once someone has reached the target with a two-point
 * lead, else null.
 *
 * Win-by-two is universal across these formats, so it is not separately
 * configurable -- a game tied at target-minus-one keeps going until
 * someone is clear by two, whatever the target.
 */
function checkGameWon(score, target) {
  const leadScore = Math.max(score.A, score.B)
  const trailScore = Math.min(score.A, score.B)
  if (leadScore >= target && leadScore - trailScore >= 2) {
    return score.A > score.B ? 'A' : 'B'
  }
  return null
}

/**
 * Which of a doubles pair is standing on the RIGHT, and therefore
 * serves when their team gains the serve.
 *
 * A pair swaps sides only when their own team scores, and in side-out
 * scoring a team can only score while serving -- so the number of
 * swaps they have made is exactly their score. Even score: whoever
 * started the game on the right is still there. Odd: their partner is.
 *
 * This is the rule the engine used to miss. It served `serverIndex: 0`
 * -- the first player listed on the team -- which is the order an
 * umpire happened to tap names in, and has nothing to do with where
 * anyone is standing.
 */
function incomingServerIndex(state, team) {
  const right = state.rightStart[team]
  return state.score[team] % 2 === 0 ? right : 1 - right
}

/**
 * Advances server state after the serving team loses a rally.
 *
 * Singles: serve just passes to the other team.
 * Doubles: the serving team gets a second server (server #2) before
 * really losing serve, UNLESS this is the very first service of the
 * whole game, which by rule only ever gets one server.
 */
function sideOut(state, isDoubles) {
  const otherTeam = state.servingTeam === 'A' ? 'B' : 'A'

  if (!isDoubles) {
    return { ...state, servingTeam: otherTeam, firstServiceOfGame: false }
  }

  if (state.firstServiceOfGame) {
    return {
      ...state,
      servingTeam: otherTeam,
      serverNumber: 1,
      serverIndex: incomingServerIndex(state, otherTeam),
      firstServiceOfGame: false,
    }
  }

  // Server 2 is the partner of whoever just faulted, wherever they are
  // standing -- not "the second player listed".
  if (state.serverNumber === 1) {
    return { ...state, serverNumber: 2, serverIndex: 1 - state.serverIndex }
  }

  return {
    ...state,
    servingTeam: otherTeam,
    serverNumber: 1,
    serverIndex: incomingServerIndex(state, otherTeam),
  }
}

/**
 * Applies one rally's result to the score/server state: the serving
 * team scores and keeps serve if they won the rally, otherwise it's a
 * side-out (see sideOut) and the score is unchanged.
 */
function applyRallyResult(state, winningTeam, isDoubles, target) {
  if (winningTeam === state.servingTeam) {
    const score = {
      ...state.score,
      [winningTeam]: state.score[winningTeam] + 1,
    }
    const winner = checkGameWon(score, target)
    return { ...state, score, completed: !!winner, winner }
  }
  return sideOut(state, isDoubles)
}

/**
 * The score/server state a brand-new match starts in, before any events.
 *
 * `rightStart` is who began the game on the right for each team, as an
 * index into that team's array. The serving team's is never in doubt --
 * by rule the first server starts on the right -- but the receiving
 * pair's is a fact only the umpire can supply, which is why match setup
 * asks for it.
 */
export function initialScoreState({
  firstServerTeam,
  firstServerIndex,
  rightStart,
  isDoubles,
}) {
  return {
    score: { A: 0, B: 0 },
    servingTeam: firstServerTeam,
    serverIndex: firstServerIndex,
    serverNumber: isDoubles ? 2 : null,
    rightStart,
    firstServiceOfGame: true,
    completed: false,
    winner: null,
  }
}

/**
 * Reads each team's right-side starter off the match, as indices.
 *
 * Falls back to the best available guess when the field is absent --
 * every match recorded before it existed, and anything sent by an older
 * app build. The serving team's right-side starter IS its first server,
 * which is known; the other pair's is not, so index 0 stands in, which
 * is what this engine always used to assume for both.
 *
 * Nothing recorded depends on the answer: serverIndex reaches only the
 * "Serving: ..." line, which a finished match does not show. So an old
 * match deriving a different server than it once did changes nothing
 * anyone can see, and changes no exported number.
 */
function rightStartIndices(match, firstServerTeam, firstServerIndex) {
  const indexIn = (team, playerId) => {
    const found = team.indexOf(playerId)
    return found === -1 ? null : found
  }
  const fallback = (team) => (team === firstServerTeam ? firstServerIndex : 0)

  return {
    A: indexIn(match.teamA, match.rightStart?.A) ?? fallback('A'),
    B: indexIn(match.teamB, match.rightStart?.B) ?? fallback('B'),
  }
}

/**
 * Folds a match's append-only event log into its current score,
 * server position, completion state, and every player's accumulated
 * raw stats -- the exact columns aggregate_player_profiles() in the
 * PaddlePad ML pipeline expects.
 *
 * Two event types are recognized:
 *   'rally'     - a point-ending shot. `outcome` ('winner'|'error') and
 *                 `zone` ('dink'|'open') together select which of the
 *                 four stat buckets (dink/clean winners, dink/unforced
 *                 errors) the acting player is credited with, and
 *                 whose team wins the rally for scoring purposes.
 *                 A rally may also carry `detail`, a key from
 *                 rally-endings.js saying what ended it; it is counted
 *                 per player in the returned `endings`.
 *   'thirdShot' - a serving-team drop or drive attempt, tracked
 *                 independently of how that rally ended.
 *
 * Folding stops as soon as the game is won, so any events appended
 * after that point (there shouldn't be any -- storage.js blocks
 * writes once a match is completed) are ignored rather than corrupting
 * a finished match's score.
 */
export function deriveMatchState(match) {
  const isDoubles = match.teamA.length === 2
  // Read off the match rather than passed in separately, so every
  // existing caller keeps working and a match simply carries the rules
  // it was played under.
  const target = match.pointTarget ?? DEFAULT_POINT_TARGET

  const firstServerTeam = match.firstServer.team
  const firstServerIndex =
    firstServerTeam === 'A'
      ? match.teamA.indexOf(match.firstServer.playerId)
      : match.teamB.indexOf(match.firstServer.playerId)

  let scoreState = initialScoreState({
    firstServerTeam,
    firstServerIndex,
    rightStart: rightStartIndices(match, firstServerTeam, firstServerIndex),
    isDoubles,
  })

  const stats = {}
  const ensure = (id) => {
    if (!stats[id]) stats[id] = emptyStats()
  }
  ;[...match.teamA, ...match.teamB].forEach(ensure)

  // What ended each rally, counted per player: { [playerId]: { out: 2 } }.
  // Kept apart from `stats` on purpose. stats is the fixed column set
  // the ML pipeline and the player app read, and a map of free keys
  // inside it would change the shape of every one of those rows.
  // Only rallies carrying a `detail` count; older ones have none.
  const endings = {}
  ;[...match.teamA, ...match.teamB].forEach((id) => {
    endings[id] = {}
  })

  // Third shots seen so far, so a rally can find the one it names.
  // Built as the log is replayed rather than indexed up front, which
  // keeps a rally from ever crediting a third shot logged after it.
  const thirdShots = new Map()

  for (const event of match.events) {
    if (scoreState.completed) break

    if (event.type === 'rally') {
      const actingTeam = match.teamA.includes(event.actingPlayerId) ? 'A' : 'B'
      const bucket =
        event.outcome === 'winner'
          ? event.zone === 'dink'
            ? 'dink_winners'
            : 'clean_winners'
          : event.zone === 'dink'
            ? 'dink_errors'
            : 'unforced_errors'

      ensure(event.actingPlayerId)
      stats[event.actingPlayerId][bucket] += 1
      if (event.detail) {
        const mine = (endings[event.actingPlayerId] ??= {})
        mine[event.detail] = (mine[event.detail] ?? 0) + 1
      }

      const winningTeam =
        event.outcome === 'winner'
          ? actingTeam
          : actingTeam === 'A'
            ? 'B'
            : 'A'

      // Did the third shot that opened this rally go on to win it?
      //
      // The rally names the third shot it followed (see addRallyEvent
      // in the umpire app); before that existed the two were two
      // unrelated lines in the log and this could not be asked. Credit
      // goes to the player who PLAYED the third shot, judged by whether
      // THEIR side won -- not the acting player of this event, who is
      // whoever ended the rally and is often an opponent.
      const opener = event.thirdShotId ? thirdShots.get(event.thirdShotId) : null
      if (opener) {
        const openerTeam = match.teamA.includes(opener.playerId) ? 'A' : 'B'
        const bucket = opener.shotType === 'drop' ? 'drop' : 'drive'
        ensure(opener.playerId)
        stats[opener.playerId][`${bucket}_rallies`] += 1
        if (openerTeam === winningTeam) {
          stats[opener.playerId][`${bucket}_rallies_won`] += 1
        }
      }

      scoreState = applyRallyResult(scoreState, winningTeam, isDoubles, target)
    } else if (event.type === 'serverCorrection') {
      // The umpire saying the app has the wrong one of a pair serving.
      //
      // It moves the serve AND flips that team's starting sides,
      // because the two are the same statement: if the wrong partner is
      // serving now, the pair began the other way round from what setup
      // recorded. Without the flip the same wrong guess would come back
      // at their next side-out and need correcting again every time.
      //
      // Ignored unless it names someone on the team currently serving.
      // The serving TEAM is derived from the rallies and is not in
      // doubt; only which of the two partners is.
      const team = scoreState.servingTeam === 'A' ? match.teamA : match.teamB
      const index = team.indexOf(event.playerId)
      if (isDoubles && index !== -1 && index !== scoreState.serverIndex) {
        scoreState = {
          ...scoreState,
          serverIndex: index,
          rightStart: {
            ...scoreState.rightStart,
            [scoreState.servingTeam]: 1 - scoreState.rightStart[scoreState.servingTeam],
          },
        }
      }
    } else if (event.type === 'thirdShot') {
      // Kept by id so a later rally can name this one. Recorded for
      // every third shot, including ones no rally ever points at.
      thirdShots.set(event.id, event)
      ensure(event.playerId)
      if (event.shotType === 'drop') {
        stats[event.playerId].drop_attempts += 1
        if (event.success) stats[event.playerId].drop_successes += 1
      } else {
        stats[event.playerId].drive_attempts += 1
      }
    }
  }

  return { ...scoreState, isDoubles, pointTarget: target, stats, endings }
}

/**
 * Where each doubles player is standing right now, as they face the net:
 * `{ A: { left, right }, B: { left, right } }`, or null for singles.
 *
 * The same rule that picks the incoming server: a pair swaps only when
 * their own team scores, so whoever began on the right is still there
 * on an even score and their partner is on an odd one. A serve
 * correction has already flipped `rightStart` in the derived state.
 *
 * For a match recorded before setup asked who started on the right,
 * the receiving pair's starting side is the engine's guess, and so is
 * this.
 */
export function courtSides(derived, match) {
  if (!derived.isDoubles) return null
  const sidesOf = (key) => {
    const team = key === 'A' ? match.teamA : match.teamB
    const right =
      derived.score[key] % 2 === 0 ? derived.rightStart[key] : 1 - derived.rightStart[key]
    return { left: team[1 - right], right: team[right] }
  }
  return { A: sidesOf('A'), B: sidesOf('B') }
}

/** The player id currently serving, given a match and its derived state. */
export function currentServerPlayerId(derived, match) {
  const team = derived.servingTeam === 'A' ? match.teamA : match.teamB
  return team[derived.serverIndex] ?? team[0]
}
