// ============================================================
// The rally rating: a skill rating built rally by rally.
//
// Every counted rally is a small contest. The side that won it takes
// points from the side that lost it -- more when the winners were the
// weaker side -- and every rally counts the same, however it ended. The
// player who ended the rally takes three quarters of their side's share,
// their partner a quarter; the other side splits theirs evenly.
//
// Separate from the ML pipeline's skill_score on purpose. That score is
// part of the thesis's K-Means pipeline (it names the skill clusters and
// residualises the playstyle features) and stays exactly as it is; this
// is the number players see.
//
// After each match with a winner, the winning side also gains a match
// reward scaled by how unlikely the win was, and the losing side gives
// up the same.
//
// A match against a newcomer counts for less for everyone else, until
// the newcomer has MIN_MATCHES matches behind them: the app cannot know
// yet whether they are far better or worse than the start, and a
// regular should not pay for that. DUPR treats unrated players the same
// way. A newcomer's own points always move in full. So points are no
// longer only moved between players: a newcomer can gain what a regular
// does not lose.
//
// Pure: matches in, ratings out. Recomputed from the whole history
// rather than patched, so voiding a match or undoing a rally can never
// leave stale points behind.
// ============================================================

import { DEFAULT_POINT_TARGET, deriveMatchState } from './pickleball.js'
import { gameWinChance } from './game-chance.js'
import { rallyEnding } from './rally-endings.js'

export const START_POINTS = 1500
export const DEFAULT_K = 4
export const DEFAULT_SCALE = 100
export const ACTOR_SHARE = 0.75
export const MIN_MATCHES = 5
export const TREND_MATCHES = 10
export const RECENT_MATCHES = 5

// A rating from fewer counted matches than this is shown to the player
// as an early estimate. A judgment call, not a measured threshold: no
// data can pin it down yet (decided 2026-09-26). It counts matches
// played only, not who they were against: early on many small groups
// only play each other, and a label nearly everyone carries means
// nothing.
export const EARLY_ESTIMATE_MATCHES = 10

// The most a side can gain by winning a match, reached only by beating a
// side they had no chance against: the side's reward is MATCH_REWARD
// times (1 - their chance of winning the game), and the losers give up
// the same. Chosen by the owner on 2026-09-14 from
// server/scripts/match-reward-sizes.mjs over staging's 136 matches: at
// this size 32/263 winners still lost points (46/263 with
// no reward), the simulated messy partner averaged +2.7 and the
// carrying partner +15.5, ranking against true ability was 0.802
// (0.839 with none), and the favourite won 19/24 (79%). The worst
// winner's loss moved from −13 with no reward to −15 with it.
export const MATCH_REWARD = 16

/** The chance a side rated `ratingFor` wins a rally against `ratingAgainst`. */
export function expectedWin(ratingFor, ratingAgainst, scale = DEFAULT_SCALE) {
  return 1 / (1 + 10 ** ((ratingAgainst - ratingFor) / scale))
}

// Where a side's chance of winning a rally, before a match, stops being
// "evenly matched" and becomes a slight or a clear favourite. Distances
// from an even 0.5. Set from staging's synthetic pool with
// server/scripts/expectation-bands.mjs on 2026-09-14, rerun after the
// match reward: of 38 matches where everyone on court had five matches,
// clear favourites won 30/35, slight favourites 1/1, and team A won 1/2
// of the even ones. The synthetic pool has few close matchups, so
// "slight" is a thin band resting on one match. Rerun once real matches
// exist.
export const EVEN_WITHIN = 0.01
export const CLEAR_BEYOND = 0.02

/**
 * What was expected of a match, in words, from the per-rally chance the
 * player's side had against the other before it started.
 *
 * Never a number: in doubles a side's points are two people, one of them
 * the reader, so any figure would hand over their partner's points.
 */
export function expectationFromChance(chance, won) {
  if (!Number.isFinite(chance)) return null
  const lean = chance - 0.5
  // No favourite, so no upset is possible.
  if (Math.abs(lean) < EVEN_WITHIN) return { expected: 'even', margin: null, upset: false }
  const expected = lean > 0 ? 'win' : 'loss'
  return {
    expected,
    margin: Math.abs(lean) >= CLEAR_BEYOND ? 'clear' : 'slight',
    // A match with no winner cannot have gone against expectation.
    upset: won === null || won === undefined ? false : (expected === 'win') !== won,
  }
}

function endedTime(match) {
  return new Date(match.endedAt).getTime()
}

function byWhenEnded(a, b) {
  return endedTime(a) - endedTime(b) || String(a.id).localeCompare(String(b.id))
}

/**
 * Every player's rating after replaying `matches` in the order they ended.
 *
 * `matches` must already be the ones that count: completed and not voided.
 *
 * `options.onRally`, if given, is called once per counted rally with
 * `{ expected }` -- the pre-rally chance the side that actually won the
 * rally was expected to (the same value the points update uses). Lets
 * callers (tuning scripts) score per-rally predictions without
 * duplicating the model.
 *
 * `options.matchReward` sets the size of the match reward applied after
 * each match with a winner; defaults to MATCH_REWARD. 0 turns the
 * reward off and gives the ratings from before it existed.
 *
 * `options.newcomerProtection` (default true) scales every change a
 * match makes to an established player -- one with MIN_MATCHES or more
 * earlier matches -- by min(n, MIN_MATCHES) / MIN_MATCHES, where n is
 * the fewest earlier matches among the OTHER players on court. false
 * counts every match in full for everyone, as before the protection.
 */
export function rateHistory(matches, options = {}) {
  const k = options.k ?? DEFAULT_K
  const scale = options.scale ?? DEFAULT_SCALE
  const actorShare = options.actorShare ?? ACTOR_SHARE
  const matchReward = options.matchReward ?? MATCH_REWARD
  const newcomerProtection = options.newcomerProtection ?? true

  const players = new Map()
  const player = (id) => {
    if (!players.has(id)) {
      players.set(id, {
        points: START_POINTS,
        matches: 0,
        rallies: 0,
        detailedRallies: 0,
        history: [],
        // Where every point came from, so the rating screen can show the
        // arithmetic rather than assert it. Keyed by the ending for rallies
        // this player ended themselves; otherwise by what happened (see
        // LEDGER_KINDS). Adds up exactly to points - START_POINTS.
        ledger: {},
        // [matchId, endedAt] per counted match, beside `history`.
        playedIn: [],
        // What each counted match did, keyed by match id: points either
        // side of it, each side's average points before it, whether
        // everyone on court was established, and the rallies this player
        // ended in it. Feeds the match screen through rallyMatchFor.
        matchFacts: {},
        byEnding: {},
      })
    }
    return players.get(id)
  }
  const average = (ids) => ids.reduce((sum, id) => sum + player(id).points, 0) / ids.length

  for (const match of [...matches].sort(byWhenEnded)) {
    const everyone = [...match.teamA, ...match.teamB]
    everyone.forEach(player)
    const onA = new Set(match.teamA)
    const averageA = average(match.teamA)
    const averageB = average(match.teamB)
    // Counted BEFORE this match is added to anyone's total.
    const established = everyone.every((id) => player(id).matches >= MIN_MATCHES)
    for (const id of everyone) {
      player(id).matchFacts[match.id] = {
        before: player(id).points,
        after: null,
        yourSide: onA.has(id) ? averageA : averageB,
        theirSide: onA.has(id) ? averageB : averageA,
        established,
        endings: {},
        untagged: 0,
        // This player's share of the match reward; null when none.
        result: null,
      }
    }
    // How much this match counts for each player, from what the replay
    // knew before it: in full for a newcomer; for everyone else by the
    // least-known other player on court -- nothing on a newcomer's first
    // match, a fifth more for each match they already have.
    const counts = new Map()
    for (const id of everyone) {
      const leastKnown = Math.min(...everyone.filter((other) => other !== id).map((other) => player(other).matches))
      counts.set(id, !newcomerProtection || player(id).matches < MIN_MATCHES
        ? 1
        : Math.min(leastKnown, MIN_MATCHES) / MIN_MATCHES)
    }
    const { foldedEvents, winner } = deriveMatchState(match)

    for (const event of match.events.slice(0, foldedEvents)) {
      if (event.type !== 'rally') continue

      const actorOnA = match.teamA.includes(event.actingPlayerId)
      const actorSide = actorOnA ? match.teamA : match.teamB
      const otherSide = actorOnA ? match.teamB : match.teamA
      const actorSideWon = event.outcome === 'winner'
      const winners = actorSideWon ? actorSide : otherSide
      const losers = actorSideWon ? otherSide : actorSide

      const expected = expectedWin(average(winners), average(losers), scale)
      options.onRally?.({ expected })

      // The same for every rally, however it ended. Hand-picked weights
      // per ending were dropped on 2026-09-26: none of the real games
      // available record the app's endings, so they could never be
      // tested.
      const stake = k * (1 - expected)
      const actorSideChange = actorSideWon ? stake : -stake

      // Worked out in full before anything is applied, so every share is
      // based on the points everyone had before this rally. Each share is
      // scaled by how much the match counts for that player BEFORE it is
      // recorded anywhere, so the ledger, the match screen and the endings
      // all show what was actually applied.
      const changes = new Map()
      const give = (id, change) => changes.set(id, change * counts.get(id))
      if (actorSide.length === 1) {
        give(event.actingPlayerId, actorSideChange)
      } else {
        const partner = actorSide.find((id) => id !== event.actingPlayerId)
        give(event.actingPlayerId, actorSideChange * actorShare)
        give(partner, actorSideChange * (1 - actorShare))
      }
      for (const id of otherSide) give(id, -actorSideChange / otherSide.length)

      for (const [id, change] of changes) {
        const p = player(id)
        p.points += change
        let row
        if (id === event.actingPlayerId) row = event.detail ?? 'untagged'
        else if (actorSide.includes(id)) row = 'partner'
        else row = actorSideWon ? 'opponent_winner' : 'opponent_error'
        const entry = (p.ledger[row] ??= { rallies: 0, points: 0 })
        entry.rallies += 1
        entry.points += change
        if (id === event.actingPlayerId) {
          const facts = p.matchFacts[match.id]
          if (event.detail) {
            const ended = (facts.endings[event.detail] ??= { rallies: 0, points: 0 })
            ended.rallies += 1
            ended.points += change
          } else {
            facts.untagged += 1
          }
        }
      }
      for (const id of everyone) {
        player(id).rallies += 1
        if (event.detail) player(id).detailedRallies += 1
      }
      if (event.detail) {
        const mine = player(event.actingPlayerId).byEnding
        mine[event.detail] = (mine[event.detail] ?? 0) + changes.get(event.actingPlayerId)
      }
    }

    // The match reward, after every rally. Worked out from each side's
    // average points BEFORE the match, like the expectation words, and
    // shared equally within a side: winning is a team result, so the
    // three-quarters share for whoever ended a rally does not apply. Scaled
    // for each player like their rallies.
    if (matchReward > 0 && winner) {
      const chanceA = gameWinChance(expectedWin(averageA, averageB, scale), {
        doubles: match.teamA.length === 2,
        target: match.pointTarget ?? DEFAULT_POINT_TARGET,
        firstServer: match.firstServer.team,
      })
      const sideA = matchReward * (winner === 'A' ? 1 - chanceA : -chanceA)
      for (const id of everyone) {
        const share = (onA.has(id) ? sideA / match.teamA.length : -sideA / match.teamB.length) * counts.get(id)
        const p = player(id)
        p.points += share
        const entry = (p.ledger.match_result ??= { matches: 0, points: 0 })
        entry.matches += 1
        entry.points += share
        p.matchFacts[match.id].result = share
      }
    }

    for (const id of everyone) {
      player(id).matches += 1
      player(id).history.push(player(id).points)
      player(id).playedIn.push([match.id, match.endedAt])
      player(id).matchFacts[match.id].after = player(id).points
    }
  }

  const ratings = new Map()
  for (const [id, p] of players) {
    const before =
      p.history.length > RECENT_MATCHES ? p.history[p.history.length - 1 - RECENT_MATCHES] : START_POINTS
    ratings.set(id, {
      points: Math.round(p.points),
      rawPoints: p.points,
      matches: p.matches,
      rallies: p.rallies,
      detailedRallies: p.detailedRallies,
      trend: p.history.slice(-TREND_MATCHES).map((value) => Math.round(value)),
      recentChange: Math.round(p.points - before),
      byEnding: p.byEnding,
      ledger: p.ledger,
      matchFacts: p.matchFacts,
      // Each recent match's change, as the difference in ROUNDED points
      // either side of it, so the changes shown add up to the trend.
      recentMatches: p.history.slice(-TREND_MATCHES).map((after, i, recent) => {
        const index = p.history.length - recent.length + i
        const beforeMatch = index === 0 ? START_POINTS : p.history[index - 1]
        const [matchId, endedAt] = p.playedIn[index]
        return { matchId, endedAt, change: Math.round(after) - Math.round(beforeMatch) }
      }),
    })
  }
  return ratings
}

export const MOST_OFTEN_MIN_RALLIES = 20

/**
 * The winning shots and the mistakes this player ended the most rallies
 * with -- usually one of each, more when they tie -- and what each did to
 * their points. Ranked by how often, not by points: every rally counts
 * the same, so the two nearly always agree, and where they don't (a
 * rally against a newcomer can move nothing) "the most" should still
 * mean what it says. Ties come back together, larger points first, so
 * the screen never calls one of several equals "the most". The numbers
 * are the rating screen's own table rows, so the sentence and the table
 * match. Null until enough rallies carry an ending to say anything.
 */
export function mostOften(rating) {
  if (!rating || rating.detailedRallies < MOST_OFTEN_MIN_RALLIES) return null
  const rows = wholeBreakdown(rating).filter((row) => row.kind === 'ending')
  const leaders = (outcome, sign) => {
    const mine = rows.filter((row) => rallyEnding(row.ending)?.outcome === outcome)
    const most = Math.max(0, ...mine.map((row) => row.rallies))
    return mine
      .filter((row) => row.rallies === most)
      .sort((a, b) => sign * (b.points - a.points) || a.ending.localeCompare(b.ending))
      .map(({ ending, rallies, points }) => ({ ending, rallies, points }))
  }
  return { won: leaders('winner', 1), lost: leaders('error', -1) }
}

/**
 * The ledger as whole numbers that add up exactly to the rounded points
 * above or below the start. Rounding each row on its own can leave the
 * total a point out, which on a screen whose whole purpose is showing
 * the sum would read as a mistake. Each row is floored, then the points
 * left over go to the rows with the largest remainders.
 */
function wholeBreakdown(rating) {
  const total = rating.points - START_POINTS
  const rows = Object.entries(rating.ledger)
    .filter(([, entry]) => (entry.rallies ?? entry.matches) > 0)
    .map(([key, entry]) => ({
      ...(LEDGER_KINDS.includes(key) ? { kind: key } : { kind: 'ending', ending: key }),
      // Counted in matches for the match reward, in rallies for the rest.
      ...(key === 'match_result' ? { matches: entry.matches } : { rallies: entry.rallies }),
      exact: entry.points,
      points: Math.floor(entry.points),
    }))
  let left = total - rows.reduce((sum, row) => sum + row.points, 0)
  const byRemainder = [...rows].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))
  for (let i = 0; left > 0 && byRemainder.length > 0; i = (i + 1) % byRemainder.length, left -= 1) {
    byRemainder[i].points += 1
  }
  return rows.map(({ exact, ...row }) => row)
}

/** Ledger rows that are not one of the player's own endings. */
export const LEDGER_KINDS = ['untagged', 'partner', 'opponent_winner', 'opponent_error', 'match_result']

/** What one player is sent about their own rally rating. */
export function rallyRatingFor(ratings, playerId, { forRatingScreen = false } = {}) {
  const rating = ratings.get(playerId)
  const have = rating?.matches ?? 0
  if (have < MIN_MATCHES) return { state: 'not_enough_matches', have, need: MIN_MATCHES }

  const response = {
    state: 'rated',
    points: rating.points,
    recentChange: rating.recentChange,
    trend: rating.trend,
    rallies: rating.rallies,
    matches: rating.matches,
    winChanceVsStart: Math.round(expectedWin(rating.rawPoints, START_POINTS) * 100),
    earlyEstimate: rating.matches < EARLY_ESTIMATE_MATCHES,
  }
  if (forRatingScreen) {
    response.mostOften = mostOften(rating)
    // The player's own arithmetic only: their rows and their matches.
    // Partner and opponent rows are totals of what those rallies did to
    // THIS player's points, which says nothing about anyone else's.
    response.breakdown = wholeBreakdown(rating)
  }
  return response
}

/**
 * What the match screen is sent about one of this player's matches.
 *
 * Their own facts only. The side averages choose the expectation's words
 * and never leave here, so nobody's points -- a partner's included -- can
 * be worked out from what is sent. Points (the change, and each ending's
 * share) wait for the player to be rated, as they do on the overview.
 */
export function rallyMatchFor(ratings, playerId, matchId, won) {
  const rating = ratings?.get(playerId)
  const facts = rating?.matchFacts?.[matchId]
  if (!facts) return null
  const rated = rating.matches >= MIN_MATCHES
  return {
    change: rated ? Math.round(facts.after) - Math.round(facts.before) : null,
    expectation: facts.established
      ? expectationFromChance(expectedWin(facts.yourSide, facts.theirSide), won)
      : null,
    endings: Object.entries(facts.endings)
      .map(([ending, entry]) => ({
        ending,
        outcome: rallyEnding(ending)?.outcome ?? null,
        rallies: entry.rallies,
        points: rated ? Math.round(entry.points) : null,
      }))
      .sort((a, b) => b.rallies - a.rallies || a.ending.localeCompare(b.ending)),
    untagged: facts.untagged,
    // This player's share of the match reward; null before they are
    // rated, and when the match had no winner.
    result: rated && facts.result !== null ? Math.round(facts.result) : null,
  }
}
