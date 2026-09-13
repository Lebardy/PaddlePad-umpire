// ============================================================
// The rally rating: a skill rating built rally by rally.
//
// Every counted rally is a small contest. The side that won it takes
// points from the side that lost it -- more when the winners were the
// weaker side -- weighted by how the rally ended. The player who ended
// the rally takes three quarters of their side's share, their partner a
// quarter; the other side splits theirs evenly.
//
// Separate from the ML pipeline's skill_score on purpose. That score is
// part of the thesis's K-Means pipeline (it names the skill clusters and
// residualises the playstyle features) and stays exactly as it is; this
// is the number players see.
//
// Pure: matches in, ratings out. Recomputed from the whole history
// rather than patched, so voiding a match or undoing a rally can never
// leave stale points behind.
// ============================================================

import { deriveMatchState } from './pickleball.js'
import { RALLY_ENDINGS } from './rally-endings.js'

export const START_POINTS = 1500
export const DEFAULT_K = 8
export const DEFAULT_SCALE = 400
export const ACTOR_SHARE = 0.75
export const MIN_MATCHES = 5
export const TREND_MATCHES = 10
export const RECENT_MATCHES = 5

// How much each ending moves. A first guess, agreed before any real
// match carried endings: self-inflicted faults weigh more, faults that
// are often forced or are bookkeeping weigh less. Revisit with real data.
export const ENDING_WEIGHTS = {
  ace: 1,
  putaway: 1,
  passing: 1,
  lob: 1,
  drop_winner: 1,
  dink_winner: 1,
  other_winner: 0.75,
  out: 1,
  net: 1,
  dink_error: 1,
  kitchen: 1.25,
  service: 1.25,
  foot_fault: 1.25,
  two_bounce: 1.25,
  net_touch: 0.5,
  hit_by_ball: 0.5,
  wrong_position: 0.5,
  other_fault: 0.75,
}

for (const ending of RALLY_ENDINGS) {
  if (typeof ENDING_WEIGHTS[ending.key] !== 'number') {
    throw new Error(`rally-rating: no weight for ending ${ending.key}`)
  }
}

/** A rally's weight. No detail (a rally from before endings) weighs 1. */
export function endingWeight(detail) {
  if (detail === undefined || detail === null) return 1
  return ENDING_WEIGHTS[detail] ?? 1
}

/** The chance a side rated `ratingFor` wins a rally against `ratingAgainst`. */
export function expectedWin(ratingFor, ratingAgainst, scale = DEFAULT_SCALE) {
  return 1 / (1 + 10 ** ((ratingAgainst - ratingFor) / scale))
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
 */
export function rateHistory(matches, options = {}) {
  const k = options.k ?? DEFAULT_K
  const scale = options.scale ?? DEFAULT_SCALE
  const actorShare = options.actorShare ?? ACTOR_SHARE

  const players = new Map()
  const player = (id) => {
    if (!players.has(id)) {
      players.set(id, {
        points: START_POINTS,
        matches: 0,
        rallies: 0,
        detailedRallies: 0,
        history: [],
        byEnding: {},
      })
    }
    return players.get(id)
  }
  const average = (ids) => ids.reduce((sum, id) => sum + player(id).points, 0) / ids.length

  for (const match of [...matches].sort(byWhenEnded)) {
    const everyone = [...match.teamA, ...match.teamB]
    everyone.forEach(player)
    const { foldedEvents } = deriveMatchState(match)

    for (const event of match.events.slice(0, foldedEvents)) {
      if (event.type !== 'rally') continue

      const actorOnA = match.teamA.includes(event.actingPlayerId)
      const actorSide = actorOnA ? match.teamA : match.teamB
      const otherSide = actorOnA ? match.teamB : match.teamA
      const actorSideWon = event.outcome === 'winner'
      const winners = actorSideWon ? actorSide : otherSide
      const losers = actorSideWon ? otherSide : actorSide

      const stake =
        k * endingWeight(event.detail) * (1 - expectedWin(average(winners), average(losers), scale))
      const actorSideChange = actorSideWon ? stake : -stake

      // Worked out in full before anything is applied, so every share is
      // based on the points everyone had before this rally.
      const changes = new Map()
      if (actorSide.length === 1) {
        changes.set(event.actingPlayerId, actorSideChange)
      } else {
        const partner = actorSide.find((id) => id !== event.actingPlayerId)
        changes.set(event.actingPlayerId, actorSideChange * actorShare)
        changes.set(partner, actorSideChange * (1 - actorShare))
      }
      for (const id of otherSide) changes.set(id, -actorSideChange / otherSide.length)

      for (const [id, change] of changes) player(id).points += change
      for (const id of everyone) {
        player(id).rallies += 1
        if (event.detail) player(id).detailedRallies += 1
      }
      if (event.detail) {
        const mine = player(event.actingPlayerId).byEnding
        mine[event.detail] = (mine[event.detail] ?? 0) + changes.get(event.actingPlayerId)
      }
    }

    for (const id of everyone) {
      player(id).matches += 1
      player(id).history.push(player(id).points)
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
    })
  }
  return ratings
}
