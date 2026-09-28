// ============================================================
// The Leaderboard tab: who is ranked, where the reader stands, and this
// month's lists.
//
// The owner chose, knowing it changes the old rule that players only
// see their own numbers, to rank everyone by PaddlePad Rating and show
// each rating. Two things keep the ranking honest: a rating is only
// ranked once it is past the early estimate (10 matches), and only
// while its owner is still playing (a match in the last 60 days), so a
// number frozen months ago never sits above people playing now.
//
// Pure, like buildBoard: plain data in, answers out, so
// scripts/check-leaderboard.mjs proves every rule with no database.
// ============================================================

import { RECOMMENDED_PLAYERS } from './rating-gate.js'
import { EARLY_ESTIMATE_MATCHES, START_POINTS } from './rally-rating.js'
import { STEP_UP_MIN_GAIN, STEP_UP_MIN_MATCHES, buildBoard, monthCounts } from './board.js'

export const RANKING_MIN_MATCHES = EARLY_ESTIMATE_MATCHES
export const RANKING_ACTIVE_DAYS = 60
// The tab waits for the same pool the playstyle groups wait for: a
// ranking of a handful of people is everyone knowing everyone's place.
export const LEADERBOARD_MIN_PLAYERS = RECOMMENDED_PLAYERS
export const MONTH_LIST_ROWS = 5
export const STEP_UP_KEYS = ['ppr', 'shots', 'mistakes', 'winRate', 'rallies']

// Step up minimums: a real change, not a wobble. Judgement calls, like
// the floors in board.js. The PPR one is 40 on the chess scale, the +10
// it was on the old 100 scale (see rally-rating.js).
export const STEP_UP_MIN_PPR = 40
export const STEP_UP_MIN_MISTAKE_DROP = 0.05
export const STEP_UP_MIN_WIN_RISE = 0.1
export const STEP_UP_MIN_RALLY_RISE = 0.05

const DAY_MS = 86_400_000
const EPSILON = 1e-9
const MAX_NAMES = 3

function lastPlayedAt(rating) {
  return rating?.timeline?.at(-1)?.at ?? null
}

function placesBy(rows, value) {
  let place = 0
  rows.forEach((row, i) => {
    if (i === 0 || value(row) !== value(rows[i - 1])) place = i + 1
    row.place = place
  })
  return rows
}

/** Everyone on the ranking, highest PPR first; equal PPR shares a place. */
export function rankingOf(ratings, players, now = Date.now()) {
  const since = now - RANKING_ACTIVE_DAYS * DAY_MS
  const rows = []
  for (const [id, rating] of ratings) {
    const who = players.get(id)
    if (!who || who.closed) continue
    if (rating.matches < RANKING_MIN_MATCHES) continue
    const last = lastPlayedAt(rating)
    if (!last || Date.parse(last) < since) continue
    rows.push({ id, name: who.name, points: rating.points, matches: rating.matches })
  }
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
  return placesBy(rows, (row) => row.points)
}

export function isLeaderboardOpen(ranking, minPlayers = LEADERBOARD_MIN_PLAYERS) {
  return ranking.length >= minPlayers
}

/** Where the reader stands: on the list, or why not. */
export function yourStanding(ranking, ratings, playerId) {
  const row = ranking.find((r) => r.id === playerId)
  if (row) {
    const above = ranking.filter((r) => r.points > row.points)
    const next = above.at(-1)
    if (!next) return { state: 'on', place: row.place, of: ranking.length, points: row.points, behind: null }
    const tied = above.filter((r) => r.points === next.points).map((r) => r.name).sort((a, b) => a.localeCompare(b))
    return {
      state: 'on',
      place: row.place,
      of: ranking.length,
      points: row.points,
      behind: { points: next.points - row.points, name: tied[0], others: tied.length - 1, place: next.place },
    }
  }
  const rating = ratings.get(playerId)
  const have = rating?.matches ?? 0
  if (have < RANKING_MIN_MATCHES) return { state: 'needs_matches', have, need: RANKING_MIN_MATCHES }
  return { state: 'away', lastPlayedAt: lastPlayedAt(rating) }
}

/** A count's top five, ties sharing a place; a tie running past 5th is summed up. */
export function topFive(counts, visible, nameOf) {
  const rows = [...counts]
    .filter(([id, n]) => visible.has(id) && n > 0)
    .map(([id, n]) => ({ name: nameOf.get(id) ?? 'Unknown', count: n }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  placesBy(rows, (row) => row.count)
  const shown = rows.slice(0, MONTH_LIST_ROWS)
  const cut = shown.at(-1)
  const moreTied = cut ? rows.slice(MONTH_LIST_ROWS).filter((r) => r.count === cut.count).length : 0
  return { rows: shown, moreTied, moreCount: moreTied ? cut.count : null }
}

/** Their PPR when the month began: after their last match before it, or the 1,500 start. */
export function pprAtStart(rating, startAt) {
  const start = new Date(startAt).getTime()
  const before = rating.timeline.filter((t) => Date.parse(t.at) < start)
  return before.length ? before.at(-1).points : START_POINTS
}

const share = (part, whole) => (whole > 0 ? part / whole : null)
const pct = (x) => Math.round(x * 100)
const oneDecimal = (x) => Math.round(x * 10) / 10
// Today's smoothed measure: one quiet match can't top the list.
const smoothedRate = ({ winners, errors }) => (winners + 1) / (errors + 1)
const plainRate = ({ winners, errors }) => (errors > 0 ? oneDecimal(winners / errors) : null)

// Each category: how big the step is (bigger is better, null = can't
// tell), whether it clears the minimum, the figures shown, and the
// shared change when tied leaders' figures differ.
const CATEGORIES = {
  ppr: {
    step: (p) => (Number.isFinite(p.pprStart) && Number.isFinite(p.pprNow) ? p.pprNow - p.pprStart : null),
    enough: (step) => step + EPSILON >= STEP_UP_MIN_PPR,
    figures: (p) => ({ change: p.pprNow - p.pprStart }),
    change: (step) => Math.round(step),
  },
  shots: {
    step: (p) => smoothedRate(p.thisMonth) / smoothedRate(p.before) - 1,
    enough: (step) => step + EPSILON >= STEP_UP_MIN_GAIN,
    figures: (p) => ({ before: plainRate(p.before), now: plainRate(p.thisMonth) }),
    change: (step) => pct(step),
  },
  mistakes: {
    step: (p) => {
      const before = share(p.before.ownMistakes, p.before.rallies)
      const now = share(p.thisMonth.ownMistakes, p.thisMonth.rallies)
      return before === null || now === null ? null : before - now
    },
    enough: (step) => step + EPSILON >= STEP_UP_MIN_MISTAKE_DROP,
    figures: (p) => ({ before: pct(p.before.ownMistakes / p.before.rallies), now: pct(p.thisMonth.ownMistakes / p.thisMonth.rallies) }),
    change: (step) => pct(step),
  },
  winRate: {
    step: (p) => {
      const before = share(p.before.won, p.before.decided)
      const now = share(p.thisMonth.won, p.thisMonth.decided)
      return before === null || now === null ? null : now - before
    },
    enough: (step) => step + EPSILON >= STEP_UP_MIN_WIN_RISE,
    figures: (p) => ({ before: pct(p.before.won / p.before.decided), now: pct(p.thisMonth.won / p.thisMonth.decided) }),
    change: (step) => pct(step),
  },
  rallies: {
    step: (p) => {
      const before = share(p.before.sideWon, p.before.rallies)
      const now = share(p.thisMonth.sideWon, p.thisMonth.rallies)
      return before === null || now === null ? null : now - before
    },
    enough: (step) => step + EPSILON >= STEP_UP_MIN_RALLY_RISE,
    figures: (p) => ({ before: pct(p.before.sideWon / p.before.rallies), now: pct(p.thisMonth.sideWon / p.thisMonth.rallies) }),
    change: (step) => pct(step),
  },
}

/** The leader of each Step up category, against their own earlier matches. */
export function stepUpLeaders(progress, visible, nameOf) {
  const eligible = progress.filter(
    (p) => visible.has(p.id) && p.thisMonth.matches >= STEP_UP_MIN_MATCHES && p.before.matches >= STEP_UP_MIN_MATCHES,
  )
  return STEP_UP_KEYS.map((key) => {
    const category = CATEGORIES[key]
    const scored = eligible
      .map((p) => ({ p, step: category.step(p) }))
      .filter(({ step }) => step !== null && Number.isFinite(step) && category.enough(step))
    if (scored.length === 0) return { key, names: null }
    const top = Math.max(...scored.map((s) => s.step))
    const leaders = scored
      .filter((s) => Math.abs(s.step - top) <= EPSILON)
      .map((s) => ({ name: nameOf.get(s.p.id) ?? 'Unknown', figures: category.figures(s.p) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const same = leaders.every((l) => JSON.stringify(l.figures) === JSON.stringify(leaders[0].figures))
    return {
      key,
      names: leaders.slice(0, MAX_NAMES).map((l) => l.name),
      more: Math.max(leaders.length - MAX_NAMES, 0),
      figures: same ? leaders[0].figures : { change: category.change(top) },
    }
  })
}

/** This month's lists for the Leaderboard tab. */
export function buildMonthLists({ matches, visible, nameOf, progress = [], history = [] }) {
  const { played, met } = monthCounts(matches)
  return {
    playedMost: topFive(played, visible, nameOf),
    metMost: topFive(met, visible, nameOf),
    stepUp: stepUpLeaders(progress, visible, nameOf),
    matchOfTheMonth: buildBoard({ matches, visible, nameOf, progress: [], history }).matchOfTheMonth,
  }
}
