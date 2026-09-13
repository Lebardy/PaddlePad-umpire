// ============================================================
// A single player's own history.
//
// Deliberately NOT built on buildMatchLogRows(). That function takes no
// filter and assigns match_number in a second pass over the entire
// club's history, so filtering its output would mean scanning every
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
import { buildRatingParts } from './rating-parts.js'
import { summariseGames } from './game-scores.js'
import { orderLadder } from './group-ladder.js'
import { expectationFor, sideRating } from './expectation.js'
import {
  MIN_MATCHES_PER_PLAYER,
  MIN_POOL_FOR_DISTRIBUTION,
  RECOMMENDED_PLAYERS,
} from './rating-gate.js'

/**
 * Every completed match this player appeared in, newest first.
 *
 * `matchNumber` is "this player's Nth match", computed with a window
 * function scoped to them rather than the export's global count.
 */
export async function getPlayerMatches(query, playerId) {
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

  // What the model expected of each match BEFORE it was played, and
  // what this player's own performance in it scored.
  //
  // Both come from rating runs, and both are deliberately anchored to
  // different runs: the expectation to the newest run that finished
  // before each match (see expectation.js -- a later run has already
  // seen the result), and the game score to the newest run overall, so
  // it agrees with the rating and the spread the Rating page shows.
  const runsNeeded = await query(
    `SELECT id, computed_at FROM rating_runs
      WHERE status = 'completed' AND computed_at <= $1
      ORDER BY computed_at`,
    [rows[rows.length - 1].ended_at],
  )
  const priorRunFor = (endedAt) => {
    let found = null
    for (const run of runsNeeded.rows) {
      if (new Date(run.computed_at) <= new Date(endedAt)) found = run.id
      else break
    }
    return found
  }

  const wanted = new Set()
  for (const row of rows) {
    const runId = priorRunFor(row.ended_at)
    if (runId) wanted.add(runId)
  }

  const scoresByRun = new Map()
  if (wanted.size > 0) {
    const { rows: scored } = await query(
      `SELECT run_id, player_id, skill_score
         FROM player_ratings
        WHERE run_id = ANY($1::uuid[]) AND player_id = ANY($2::uuid[])`,
      [[...wanted], [...everyone]],
    )
    for (const row of scored) {
      if (!scoresByRun.has(row.run_id)) scoresByRun.set(row.run_id, new Map())
      scoresByRun.get(row.run_id).set(row.player_id, Number(row.skill_score))
    }
  }

  // This player's own score for each game, from the newest run they are
  // in. Their own numbers only, so nothing is withheld.
  const { rows: latest } = await query(
    `SELECT r.game_scores
       FROM player_ratings r
       JOIN rating_runs run ON run.id = r.run_id
      WHERE r.player_id = $1 AND run.status = 'completed'
      ORDER BY run.computed_at DESC
      LIMIT 1`,
    [playerId],
  )
  const scoredGame = new Map(
    (Array.isArray(latest[0]?.game_scores) ? latest[0].game_scores : [])
      .map((game) => [game.matchId, Number(game.score)]),
  )

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
      // A verdict in words and nothing else -- see expectation.js for
      // why no figure about anybody may appear here. Null when the
      // match predates every run, or when anyone on court was unrated
      // at the time.
      expectation: (() => {
        const runId = priorRunFor(row.ended_at)
        const scores = runId ? scoresByRun.get(runId) : null
        if (!scores) return null
        const yours = sideRating(ownTeam, scores)
        const theirs = sideRating(opponents, scores)
        return expectationFor(
          yours,
          theirs,
          row.winner === null ? null : row.winner === team,
        )
      })(),
      // How this game scored on the rating's own scale. The player's
      // rating is the average of these across their games.
      ratedAs: scoredGame.has(row.id) ? Math.round(scoredGame.get(row.id) * 10) / 10 : null,
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

  const margins = []
  let previous = 0
  const replay = []

  for (const event of events) {
    replay.push(event)
    if (event.type !== 'rally') continue

    const state = deriveMatchState({ ...base, events: replay })
    const total = state.score.A + state.score.B
    if (total === previous) continue // a side-out, not a point
    previous = total

    margins.push(
      team === 'A' ? state.score.A - state.score.B : state.score.B - state.score.A,
    )
  }

  return margins
}

/**
 * Headline totals across a player's whole history.
 *
 * Only raw counts and simple ratios -- nothing here needs a population
 * to be meaningful. The skill score and playstyle archetype from the ML
 * pipeline deliberately are NOT computed here: those need many matches
 * per player and many players before they say anything true, and a
 * rating that moves because someone else played would destroy trust in
 * it immediately.
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
// The ML skill rating, and what to say when there isn't one
// ============================================================

/**
 * What this player's rating situation is right now.
 *
 * Returns one of four states rather than a nullable score, because
 * "we have not computed this yet" and "you have not played enough" and
 * "not enough people have played enough" are three genuinely different
 * things and the app should not be left guessing which it is looking
 * at. Only `rated` carries a number.
 *
 * `matchCount` is passed in rather than re-queried: the caller has
 * already loaded this player's matches, and that array is filtered by
 * exactly the same rules the gate counts against.
 */
// How many runs back to look when assembling a history. Nightly runs
// make this about two months. It is a scan bound, not a point count --
// most of these collapse away, see below.
const HISTORY_RUNS_SCANNED = 60

// How many points survive into the response. Enough to show a shape,
// few enough that the payload stays small forever.
const HISTORY_POINTS = 12

/**
 * Turns a player's rating rows into the points where their score CHANGED.
 *
 * Not a list of runs, and that distinction is the whole design.
 *
 * The pipeline is deterministic: `random_state=42` is fixed, and the
 * skill score does not come from K-Means at all -- it is a weighted sum
 * of min-max normalised features. So two runs over unchanged data
 * produce byte-identical scores. That is not a guess; on staging the
 * same player scored 36.1900 in two consecutive runs.
 *
 * Charting every nightly run would therefore draw a flat line almost
 * every day, with the occasional step lost among fifty identical
 * points. Collapsing runs of equal scores and keeping the EARLIEST of
 * each streak means every point answers "this is when it became that",
 * which is the question someone watching their score actually has.
 *
 * `rows` arrives newest-first; the result is oldest-first, because that
 * is the direction a chart is read.
 */
function buildRatingHistory(rows) {
  const points = []
  // Walked newest-first, so the LAST row of each equal streak is the
  // earliest one -- overwriting as we go leaves exactly that.
  for (const row of rows) {
    const previous = points[points.length - 1]
    if (previous && previous.skillScore === Math.round(row.skill_score)) {
      previous.computedAt = row.computed_at
      previous.poolSize = row.player_count
      continue
    }
    points.push({
      // Rounded to match the headline number. Comparing the raw floats
      // would treat 36.19 and 36.191 as a change and draw a step the
      // player could never see in the number itself.
      skillScore: Math.round(row.skill_score),
      computedAt: row.computed_at,
      poolSize: row.player_count,
    })
  }
  return points.slice(0, HISTORY_POINTS).reverse()
}

export async function getRatingState(query, playerId, matchCount) {
  const { rows: rated } = await query(
    `SELECT r.skill_score, r.skill_group, r.playstyle_archetype,
            r.evidence, r.match_count,
            run.computed_at, run.player_count
       FROM player_ratings r
       JOIN rating_runs run ON run.id = r.run_id
      WHERE r.player_id = $1
        AND run.status = 'completed'
      ORDER BY run.computed_at DESC
      LIMIT $2`,
    [playerId, HISTORY_RUNS_SCANNED],
  )

  if (rated[0]) {
    const row = rated[0]
    return {
      state: 'rated',
      // Rounded here rather than in the app: the extra decimals are
      // false precision on a score this relative, and rounding once at
      // the source stops two screens disagreeing.
      skillScore: Math.round(row.skill_score),
      playstyleArchetype: row.playstyle_archetype,
      skillGroup: row.skill_group,
      evidence: row.evidence,
      // The two facts that make a relative score interpretable. Never
      // send the score without them.
      computedAt: row.computed_at,
      poolSize: row.player_count,
      fromMatches: row.match_count,
      // When the score actually moved, and what pool it was measured
      // against each time. See buildRatingHistory for why this is a
      // list of CHANGES rather than a list of runs.
      history: buildRatingHistory(rated),
      // skill_tier is deliberately not returned. assign_skill_tier
      // applies absolute cutoffs (40 / 75) to a purely relative score,
      // so in a small pool the top player is labelled "Professional"
      // regardless of how they play -- a straightforwardly false claim
      // to put in front of a real person. The value stays in the
      // database for analysis.
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

// How many columns the club's spread is drawn in. Ten is one per ten
// points of a 0-100 score, which reads without a legend.
const BUCKETS = 10

/**
 * Where this player sits among everyone the pipeline rated, and who
 * else is in their group.
 *
 * Built to answer "am I getting anywhere" without ever producing a
 * rank. It returns counts and a shape, never another player's score,
 * name, id or group -- there is no ordering in it for a caller to
 * reconstruct a leaderboard from.
 *
 * That restraint is not only about competitiveness. skill_score is
 * POOL-RELATIVE (see rating-gate.js): in a small club the best player
 * scores 100 whatever their actual standard, so a ranked list would
 * publish a number that means less than it appears to. A position
 * within a spread, dated and with the pool size attached, is the
 * strongest honest claim available from this model.
 */
export async function getClubStanding(query, playerId) {
  // The latest completed run this player is actually IN. A later run
  // they missed would compare their old score against other people's
  // new ones.
  const { rows: mine } = await query(
    `SELECT r.run_id, r.skill_score, r.skill_group, r.playstyle_cluster,
            r.playstyle_archetype, r.playstyle_traits, r.evidence,
            r.score_parts, r.game_scores, run.computed_at, run.notes
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

  const { run_id: runId, skill_score: score, skill_group: group } = mine[0]

  // The player's own column is decided by the SAME expression as
  // everyone else's, in the same query language. Working it out again in
  // JavaScript got the edges wrong: width_bucket puts a score of exactly
  // 40 in the 40-50 column, and Math.ceil(40 / 10) says 30-40, so a
  // player on a round number saw "You" under the wrong bar.
  //
  // least(..., n) folds a score of exactly 100 -- which width_bucket
  // gives an eleventh column of its own -- back into the tenth, so the
  // top of the scale does not look like a category.
  const BUCKET_OF = 'least(width_bucket(skill_score, 0, 100, $2), $2)'

  const { rows: counts } = await query(
    `SELECT count(*)::int AS rated,
            count(*) FILTER (WHERE skill_score < $3)::int AS below,
            count(*) FILTER (WHERE skill_group IS NOT DISTINCT FROM $4)::int AS band,
            count(DISTINCT skill_group)::int AS groups,
            max(${BUCKET_OF}) FILTER (WHERE player_id = $5)::int AS yours
       FROM player_ratings
      WHERE run_id = $1`,
    [runId, BUCKETS, score, group, playerId],
  )
  const { rated, below, band, groups, yours } = counts[0]

  const { rows: histogram } = await query(
    `SELECT ${BUCKET_OF}::int AS bucket, count(*)::int AS n
       FROM player_ratings
      WHERE run_id = $1
      GROUP BY 1`,
    [runId, BUCKETS],
  )

  // Every group in the run, with its size, the range it
  // covers and where its middle sits. The page shows this as a ladder
  // with the player's own rung marked, because "your group" means
  // nothing without the others beside it. Counts and ratings only -- no
  // names, no ids, the same rule as the rest of this endpoint.
  //
  // The middle is what the page NAMES a group by, as a PERCENTILE of
  // that middle rather than as the rating itself.
  //
  // Two earlier namings failed. A range -- "Ratings 28-49" beside
  // "Ratings 37-91" -- put the same numbers in two names, because
  // groups are not slices of the rating scale: the clustering sorts on
  // ten measurements and the rating is a sum of four of them, so two
  // players can share a rating and land either side. A bare middle --
  // "Around 43" -- cannot overlap, but a rating is a poor description
  // of position, because skill_score is min-max scaled and the players
  // are not spread evenly along it. On the pool this was written
  // against, 26 of 46 players sat between 40 and 59: a rating of 42 is
  // the 17th percentile, not the "slightly below middle" the number
  // suggests, and ten rating points crosses 33 places down there
  // against 7 places up at the top.
  //
  // A percentile says the thing a rating only implies. It is taken from
  // the group's MEDIAN rather than its mean so one outlier cannot drag
  // a group's name away from where its players actually are, and the
  // ladder is ordered by that same middle so the rungs can never
  // contradict their own names.
  const { rows: byMiddle } = await query(
    `WITH rated AS (
        SELECT skill_score, skill_group
          FROM player_ratings
         WHERE run_id = $1 AND skill_group IS NOT NULL
     ), grouped AS (
        SELECT skill_group AS name, count(*)::int AS size,
               min(skill_score) AS lowest, max(skill_score) AS highest,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY skill_score) AS middle
          FROM rated
         GROUP BY skill_group
     )
     SELECT g.*,
            (SELECT count(*) FROM rated r WHERE r.skill_score < g.middle)::float
              / nullif((SELECT count(*) FROM rated), 0) AS share
       FROM grouped g
      ORDER BY g.middle`,
    [runId],
  )
  // Runs whose groups were named by rally points record that order, and
  // the ladder follows it -- see group-ladder.js.
  const ladder = orderLadder(byMiddle, mine[0].notes?.structure?.groupOrder)

  // Proof for the playstyle name: this player's own numbers, their
  // group's average, and the average of the other style in their group.
  // Read from what the run already stored rather than recomputed -- see
  // playstyle.js, including why a style of one or two is never averaged.
  let playstyle = null
  if (group && Array.isArray(mine[0].playstyle_traits)) {
    const { rows: peers } = await query(
      `SELECT playstyle_cluster, playstyle_archetype, evidence
         FROM player_ratings
        WHERE run_id = $1 AND skill_group = $2`,
      [runId, group],
    )
    playstyle = buildPlaystyleProof({
      traits: mine[0].playstyle_traits,
      mine: {
        playstyle_cluster: mine[0].playstyle_cluster,
        evidence: mine[0].evidence,
      },
      peers,
    })
  }

  // What the rating is made of: this player's four parts, their group's
  // average of the same four, and the average of the group one rung up
  // the ladder. Two questions the score alone cannot answer -- what is
  // moving my number, and what separates me from the group above --
  // both answered from the score's own arithmetic. See rating-parts.js,
  // including why a group of fewer than three is never averaged.
  //
  // The group above is found by position on the ladder queried above,
  // so no group name has to be hardcoded and it keeps working whatever
  // K the clustering picks. The player in the top group has none, which
  // the page says rather than hides.
  let parts = null
  if (group && mine[0].score_parts) {
    const rung = ladder.findIndex((g) => g.name === group)
    const aboveName = rung === -1 ? null : (ladder[rung + 1]?.name ?? null)
    const { rows: peers } = await query(
      `SELECT skill_group, score_parts
         FROM player_ratings
        WHERE run_id = $1 AND skill_group = ANY($2::text[])`,
      [runId, aboveName ? [group, aboveName] : [group]],
    )
    parts = buildRatingParts({
      mine: mine[0].score_parts,
      peers: peers.filter((row) => row.skill_group === group),
      above: peers.filter((row) => row.skill_group === aboveName),
    })
  }

  // Every game this player played, on the same scale as their rating.
  // Their own numbers only -- see game-scores.js, including why the
  // rating really is the average of these rather than a summary.
  const games = summariseGames(mine[0].game_scores, score)

  const counted = new Map(histogram.map((row) => [row.bucket, row.n]))

  return {
    state: 'rated',
    computedAt: mine[0].computed_at,
    // One number for both the placement sentence and the "as of" line.
    // rating_runs.player_count records what the pipeline reported; this
    // counts the rows actually stored, so the sentence can never say
    // "4 of 46" about a run holding 45 rows.
    poolSize: rated,
    // Rounded at the source, as getRatingState does, so two screens
    // cannot disagree about the same score.
    yourScore: Math.round(score),
    below,
    // Every group in the run, so the page can show the ladder the
    // player sits on rather than a label on its own.
    groups: ladder.map((g) => ({
      name: g.name,
      size: g.size,
      lowest: Math.round(g.lowest),
      highest: Math.round(g.highest),
      // What the page calls the group: the share of everyone rated who
      // sits below its middle. The middle and the range stay beside it
      // because two groups in a small pool can round to the same
      // percentile, and the page falls back rather than showing one
      // name on two rungs.
      middle: Math.round(g.middle),
      percentile: g.share === null ? null : Math.round(g.share * 100),
    })),
    // The four measurements the rating is a weighted sum of -- yours,
    // your group's average, and the group above's. Null for a run from
    // a pipeline that did not send them.
    parts,
    // The games the rating is the average of. Null for an older run,
    // or for a player with too few games for a spread to mean much.
    games,
    // The name the pipeline gave this player's style, and the numbers
    // that earned each word of it.
    playstyleArchetype: mine[0].playstyle_archetype ?? null,
    playstyle,
    // The clustering's own level-1 grouping, and how many share it.
    // Never who they are, and never ordered within the band -- the
    // group is the point, a position inside it is not.
    // groupCount is there because the pipeline names groups by how many
    // it found ("Higher-Performance" of two is not "of three"), and past
    // three it falls back to "Performance Group N", which means nothing
    // without knowing N of what.
    band: group ? { name: group, size: band, groupCount: groups } : null,
    // Null below the floor: the sentence above is honest at any pool
    // size, a drawn shape is not.
    distribution:
      rated < MIN_POOL_FOR_DISTRIBUTION
        ? null
        : Array.from({ length: BUCKETS }, (_, i) => {
            const bucket = i + 1
            return {
              from: i * (100 / BUCKETS),
              to: bucket * (100 / BUCKETS),
              count: counted.get(bucket) ?? 0,
              yours: bucket === yours,
            }
          }),
  }
}
