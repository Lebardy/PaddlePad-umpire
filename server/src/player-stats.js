// ============================================================
// A single player's own history.
//
// Deliberately NOT built on buildMatchLogRows(). That function takes no
// filter and assigns match_number in a second pass over the entire
// match history, so filtering its output would mean scanning every
// match ever played on each page view. It also returns partners and
// opponents as UUIDs, and a player wants names.
//
// The exclusions here mirror the export exactly -- completed, not
// voided, not in a voided session. A match an umpire threw out for a
// wrong pairing must not appear in a player's history either; showing
// someone a match they were wrongly credited with is worse than showing
// them nothing.
// ============================================================

import { deriveMatchState, eventFromRow } from './pickleball.js'
import { buildPlaystyleProof } from './playstyle.js'
import { rallyMatchFor } from './rally-rating.js'
import {
  MIN_MATCHES_PER_PLAYER,
  RECOMMENDED_PLAYERS,
} from './rating-gate.js'

/**
 * Every completed match this player appeared in, newest first.
 *
 * `matchNumber` is "this player's Nth match", computed with a window
 * function scoped to them rather than the export's global count.
 *
 * `ratings`, when given, is the cached rally rating (getRallyRatings):
 * each match then carries `rally`, what that match did to this player's
 * points -- see rallyMatchFor. Callers that only need totals (the
 * profile summary, the monthly board) leave it out.
 */
export async function getPlayerMatches(query, playerId, ratings = null) {
  const { rows } = await query(
    `SELECT m.id,
            m.team_a,
            m.team_b,
            m.stacking_a,
            m.stacking_b,
            m.first_server_team,
            m.first_server_player,
            m.right_start_a, m.right_start_b,
            m.point_target,
            m.winner,
            m.started_at,
            m.ended_at,
            m.ended_early,
            s.name AS session_name,
            row_number() OVER (ORDER BY m.ended_at) AS match_number
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
      WHERE (m.team_a @> ARRAY[$1]::uuid[] OR m.team_b @> ARRAY[$1]::uuid[])
        AND m.status = 'completed'
        AND m.ended_at IS NOT NULL
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL
      ORDER BY m.ended_at`,
    [playerId],
  )
  if (rows.length === 0) return []

  const matchIds = rows.map((r) => r.id)

  const { rows: events } = await query(
    `SELECT match_id, id, type, payload
       FROM match_events
      WHERE match_id = ANY($1::uuid[])
      ORDER BY match_id, seq`,
    [matchIds],
  )

  const eventsByMatch = new Map()
  for (const event of events) {
    if (!eventsByMatch.has(event.match_id)) eventsByMatch.set(event.match_id, [])
    eventsByMatch.get(event.match_id).push(eventFromRow(event))
  }

  // Resolve every id on court to a name in one query -- a player reading
  // their history wants "with Gemma, against Josh and Alice", not UUIDs.
  const everyone = new Set()
  for (const row of rows) {
    for (const id of [...row.team_a, ...row.team_b]) everyone.add(id)
  }
  const { rows: people } = await query(
    'SELECT id, name FROM players WHERE id = ANY($1::uuid[])',
    [[...everyone]],
  )
  const nameOf = new Map(people.map((p) => [p.id, p.name]))

  const result = rows.map((row) => {
    const derived = deriveMatchState({
      teamA: row.team_a,
      teamB: row.team_b,
      firstServer: {
        team: row.first_server_team,
        playerId: row.first_server_player,
      },
      rightStart: { A: row.right_start_a, B: row.right_start_b },
      pointTarget: row.point_target,
      events: eventsByMatch.get(row.id) ?? [],
    })

    const team = row.team_a.includes(playerId) ? 'A' : 'B'
    const ownTeam = team === 'A' ? row.team_a : row.team_b
    const opponents = team === 'A' ? row.team_b : row.team_a

    // How the lead moved through the match, from this player's side.
    //
    // Sent instead of the raw event log, which is both far larger and
    // far less interesting: forty lines of "clean winner, clean winner,
    // unforced error" is tedious to read, while this is the shape of
    // the game -- the runs, the comeback, where it turned. One small
    // integer per POINT (not per rally: under side-out rules most
    // rallies change only the serve), so a whole match costs a few
    // dozen bytes.
    const progression = scoreProgression(
      row,
      eventsByMatch.get(row.id) ?? [],
      team,
    )

    return {
      id: row.id,
      matchNumber: Number(row.match_number),
      sessionName: row.session_name,
      endedAt: row.ended_at,
      startedAt: row.started_at,
      endedEarly: row.ended_early,
      isDoubles: row.team_a.length === 2,
      pointTarget: row.point_target,
      // From this player's point of view, not team A's.
      won: row.winner === null ? null : row.winner === team,
      yourScore: derived.score[team],
      theirScore: derived.score[team === 'A' ? 'B' : 'A'],
      partner: ownTeam
        .filter((id) => id !== playerId)
        .map((id) => nameOf.get(id) ?? 'Unknown')[0] ?? null,
      opponents: opponents.map((id) => nameOf.get(id) ?? 'Unknown'),
      usedStacking: team === 'A' ? row.stacking_a : row.stacking_b,
      stats: derived.stats[playerId],
      progression,
      rallyCounts: rallyCounts(row.team_a, row.team_b, eventsByMatch.get(row.id) ?? [], playerId),
      // What this match did to this player's rally points, the
      // expectation in words, and how the rallies they ended ended.
      // Null when the caller passed no ratings, or the replay did not
      // count this match.
      rally: ratings
        ? rallyMatchFor(ratings, playerId, row.id, row.winner === null ? null : row.winner === team)
        : null,
    }
  })

  return result.reverse() // newest first for display
}

/**
 * Replays a match one rally at a time and records the score margin from
 * one team's point of view after every point that actually landed.
 *
 * Rallies that only changed the serve are skipped, because a flat
 * stretch in the middle of a chart says nothing a reader can use --
 * what they want to see is the scoring.
 */
export function scoreProgression(row, events, team) {
  return scoringRallies(row, events).map(({ score }) =>
    team === 'A' ? score.A - score.B : score.B - score.A,
  )
}

/**
 * How each point was won and who did it, one entry per point -- lined
 * up with scoreProgression's margins, since both come from the same
 * replay. `how` is 'winner' (the hitter's side scored) or 'mistake' (the
 * other side scored); `ending` is the rally-endings.js key, or null for
 * a rally logged before endings were recorded; `by` is the player id.
 */
export function pointEndings(row, events) {
  return scoringRallies(row, events).map(({ event }) => ({
    how: event.outcome === 'winner' ? 'winner' : 'mistake',
    ending: event.detail ?? null,
    by: event.actingPlayerId,
  }))
}

/**
 * How one player's rallies went in one match: how many were played, how
 * many their side won, and how many ended with their own mistake.
 *
 * Shares of these, not raw counts, are what the monthly Step up compares,
 * so a singles player and a doubles player are measured the same way.
 */
export function rallyCounts(teamA, teamB, events, playerId) {
  const own = teamA.includes(playerId) ? teamA : teamB
  let rallies = 0
  let sideWon = 0
  let ownMistakes = 0
  for (const event of events) {
    if (event.type !== 'rally') continue
    rallies += 1
    const actorOnOwnSide = own.includes(event.actingPlayerId)
    if (event.outcome === 'winner' ? actorOnOwnSide : !actorOnOwnSide) sideWon += 1
    if (event.outcome !== 'winner' && event.actingPlayerId === playerId) ownMistakes += 1
  }
  return { rallies, sideWon, ownMistakes }
}

/** Every rally that put a point on the board, with the score after it. */
function scoringRallies(row, events) {
  const base = {
    teamA: row.team_a,
    teamB: row.team_b,
    firstServer: {
      team: row.first_server_team,
      playerId: row.first_server_player,
    },
    rightStart: { A: row.right_start_a, B: row.right_start_b },
    pointTarget: row.point_target,
  }

  const points = []
  let previous = 0
  const replay = []

  for (const event of events) {
    replay.push(event)
    if (event.type !== 'rally') continue

    const state = deriveMatchState({ ...base, events: replay })
    const total = state.score.A + state.score.B
    if (total === previous) continue // a side-out, not a point
    previous = total

    points.push({ event, score: { ...state.score } })
  }

  return points
}

/**
 * Headline totals across a player's whole history.
 *
 * Only raw counts and simple ratios -- nothing here needs a population
 * to be meaningful. The skill group and playstyle archetype from the ML
 * pipeline deliberately are NOT computed here: those need many matches
 * per player and many players before they say anything true.
 */
// Below this, a conversion rate is a coin landing heads twice. Ten of
// each is still a small sample -- the app says so beside it -- but it
// is the point where the number stops being meaningless.
export const MIN_LINKED_THIRD_SHOTS = 10

export function summarisePlayer(matches) {
  const totals = {
    matches: matches.length,
    wins: 0,
    losses: 0,
    cleanWinners: 0,
    dinkWinners: 0,
    unforcedErrors: 0,
    dinkErrors: 0,
    dropAttempts: 0,
    dropSuccesses: 0,
    driveAttempts: 0,
    // Third shots the log ties to the rally they opened, and how many
    // of those rallies the player's side went on to win. Always <= the
    // attempts above: a third shot the umpire skipped linking, or one
    // recorded before rallies carried the link at all, is absent here
    // rather than counted as a loss.
    dropRallies: 0,
    dropRalliesWon: 0,
    driveRallies: 0,
    driveRalliesWon: 0,
  }

  for (const match of matches) {
    if (match.won === true) totals.wins += 1
    else if (match.won === false) totals.losses += 1

    const s = match.stats
    totals.cleanWinners += s.clean_winners
    totals.dinkWinners += s.dink_winners
    totals.unforcedErrors += s.unforced_errors
    totals.dinkErrors += s.dink_errors
    totals.dropAttempts += s.drop_attempts
    totals.dropSuccesses += s.drop_successes
    totals.driveAttempts += s.drive_attempts
    // ?? 0 because a match replayed by an older server has no such
    // counters, and adding undefined would poison every total.
    totals.dropRallies += s.drop_rallies ?? 0
    totals.dropRalliesWon += s.drop_rallies_won ?? 0
    totals.driveRallies += s.drive_rallies ?? 0
    totals.driveRalliesWon += s.drive_rallies_won ?? 0
  }

  const decided = totals.wins + totals.losses
  const thirdShots = totals.dropAttempts + totals.driveAttempts

  return {
    ...totals,
    totalWinners: totals.cleanWinners + totals.dinkWinners,
    totalErrors: totals.unforcedErrors + totals.dinkErrors,
    // Null rather than 0 when there's nothing to divide by, so the app
    // can say "not enough matches yet" instead of showing a confident 0%.
    winRate: decided > 0 ? totals.wins / decided : null,
    dropSuccessRate:
      totals.dropAttempts > 0 ? totals.dropSuccesses / totals.dropAttempts : null,
    dropPreference: thirdShots > 0 ? totals.dropAttempts / thirdShots : null,
    // Whether the choice actually won the point, which is a different
    // question from whether the drop landed -- dropSuccessRate above is
    // the umpire's judgement that the ball arrived soft at the net.
    //
    // Null below MIN_LINKED_THIRD_SHOTS. A conversion rate over three
    // attempts is noise, and this app withholds rather than guesses.
    dropConversion:
      totals.dropRallies >= MIN_LINKED_THIRD_SHOTS
        ? totals.dropRalliesWon / totals.dropRallies
        : null,
    driveConversion:
      totals.driveRallies >= MIN_LINKED_THIRD_SHOTS
        ? totals.driveRalliesWon / totals.driveRallies
        : null,
  }
}

/**
 * How many matches this player is in that haven't finished yet.
 *
 * Exists purely for the empty state. "No matches yet" and "a match of
 * yours is being scored right now" feel completely different to someone
 * who just claimed their code: the first reads like the app is broken,
 * the second reads like it is working and waiting. Without this the app
 * cannot tell them apart.
 */
export async function countMatchesInProgress(query, playerId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
      WHERE (m.team_a @> ARRAY[$1]::uuid[] OR m.team_b @> ARRAY[$1]::uuid[])
        AND m.status = 'in_progress'
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL`,
    [playerId],
  )
  return rows[0].n
}

// ============================================================
// The ML pipeline's result, and what to say when there isn't one
// ============================================================

/**
 * What this player's situation with the pipeline is right now.
 *
 * Returns one of four states rather than a nullable result, because
 * "we have not computed this yet" and "you have not played enough" and
 * "not enough people have played enough" are three genuinely different
 * things and the app should not be left guessing which it is looking
 * at. Only `rated` carries a skill group and a playstyle, from the
 * latest completed run the player is in.
 *
 * `matchCount` is passed in rather than re-queried: the caller has
 * already loaded this player's matches, and that array is filtered by
 * exactly the same rules the gate counts against.
 */
export async function getRatingState(query, playerId, matchCount) {
  const { rows: rated } = await query(
    `SELECT r.skill_group, r.playstyle_archetype,
            r.evidence, r.match_count,
            run.computed_at, run.player_count
       FROM player_ratings r
       JOIN rating_runs run ON run.id = r.run_id
      WHERE r.player_id = $1
        AND run.status = 'completed'
      ORDER BY run.computed_at DESC
      LIMIT 1`,
    [playerId],
  )

  if (rated[0]) {
    const row = rated[0]
    return {
      state: 'rated',
      playstyleArchetype: row.playstyle_archetype,
      skillGroup: row.skill_group,
      evidence: row.evidence,
      // The two facts that make a pool-relative result interpretable.
      // Never send the result without them.
      computedAt: row.computed_at,
      poolSize: row.player_count,
      fromMatches: row.match_count,
    }
  }

  // The player's own progress comes first, and is the only thing shown
  // until they clear it. Telling someone they are blocked by how many
  // OTHER people have played is telling them about something they
  // cannot influence.
  if (matchCount < MIN_MATCHES_PER_PLAYER) {
    return {
      state: 'not_enough_matches',
      have: matchCount,
      need: MIN_MATCHES_PER_PLAYER,
    }
  }

  // Only reached once this player personally qualifies, at which point
  // the pool condition is both true and specific.
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM (
        SELECT p.id
          FROM players p
          JOIN matches m
            ON (m.team_a @> ARRAY[p.id]::uuid[] OR m.team_b @> ARRAY[p.id]::uuid[])
          JOIN sessions s ON s.id = m.session_id
         WHERE m.status = 'completed'
           AND m.voided_at IS NULL
           AND s.voided_at IS NULL
         GROUP BY p.id
        HAVING count(*) >= $1
     ) qualifying`,
    [MIN_MATCHES_PER_PLAYER],
  )
  const qualifying = rows[0].n

  // Enough people qualify, but this player is not in the latest run --
  // they cleared the bar since it last ran, so the answer is "soon",
  // not "not yet".
  if (qualifying >= RECOMMENDED_PLAYERS) {
    return { state: 'pending', poolSize: qualifying }
  }

  return {
    state: 'not_enough_players',
    have: qualifying,
    need: RECOMMENDED_PLAYERS,
  }
}

/**
 * What the rating screen's playstyle card needs about this player's
 * place in the latest pipeline run: their group's name and size, and
 * their style with the numbers that earned each word. Never another
 * player's name, id or group.
 */
export async function getStanding(query, playerId) {
  // The latest completed run this player is actually IN. A later run
  // they missed would describe a group they were not part of.
  const { rows: mine } = await query(
    `SELECT r.run_id, r.skill_group, r.playstyle_cluster,
            r.playstyle_archetype, r.playstyle_traits, r.evidence
       FROM player_ratings r
       JOIN rating_runs run ON run.id = r.run_id
      WHERE r.player_id = $1
        AND run.status = 'completed'
      ORDER BY run.computed_at DESC
      LIMIT 1`,
    [playerId],
  )

  // No rating yet. The overview's rating card already explains why in
  // the player's own terms, so this says only that there is nothing to
  // stand beside rather than repeating the reasoning badly.
  if (!mine[0]) return { state: 'unrated' }

  const { run_id: runId, skill_group: group } = mine[0]

  // Everyone in the player's group, for its size and for the averages
  // that prove the style name -- see playstyle.js, including why a style
  // of one or two is never averaged.
  const { rows: peers } = group
    ? await query(
        `SELECT playstyle_cluster, playstyle_archetype, evidence
           FROM player_ratings
          WHERE run_id = $1 AND skill_group = $2`,
        [runId, group],
      )
    : { rows: [] }

  const playstyle = group && Array.isArray(mine[0].playstyle_traits)
    ? buildPlaystyleProof({
        traits: mine[0].playstyle_traits,
        mine: { playstyle_cluster: mine[0].playstyle_cluster, evidence: mine[0].evidence },
        peers,
      })
    : null

  return {
    state: 'rated',
    // The name the pipeline gave this player's style, and the numbers
    // that earned each word of it.
    playstyleArchetype: mine[0].playstyle_archetype ?? null,
    playstyle,
    // The clustering's level-1 group and how many share it -- the players
    // a style is compared with. Never who they are. The name is what the
    // app strips from the front of the style name (lib/styleName.js).
    band: group ? { name: group, size: peers.length } : null,
  }
}
