// ============================================================
// The Leaderboard tab, gathered from the database. The rules live in
// leaderboard.js; this only fetches what they need.
// ============================================================

import { getRallyRatings } from './rally-rating-store.js'
import { gatherMonth, gatherProgress } from './board.js'
import {
  LEADERBOARD_MIN_PLAYERS, buildMonthLists, isLeaderboardOpen, pprAtStart, rankingOf, yourStanding,
} from './leaderboard.js'

// Staging may lower the 40 to test the open tab with a smaller pool.
// Production never sets LEADERBOARD_MIN_PLAYERS.
const override = Number(process.env.LEADERBOARD_MIN_PLAYERS)
export const MIN_PLAYERS = Number.isInteger(override) && override > 0 ? override : LEADERBOARD_MIN_PLAYERS

async function playersFor(query, ratings) {
  const ids = [...ratings.keys()]
  if (ids.length === 0) return new Map()
  const { rows } = await query('SELECT id, name, deactivated_at FROM players WHERE id = ANY($1::uuid[])', [ids])
  return new Map(rows.map((p) => [p.id, { name: p.name, closed: Boolean(p.deactivated_at) }]))
}

async function currentRanking(query, now) {
  const ratings = await getRallyRatings(query)
  return { ratings, ranking: rankingOf(ratings, await playersFor(query, ratings), now) }
}

/** Whether the tab exists at all -- rides on /player/me. */
export async function getLeaderboardOpen(query, now = Date.now()) {
  const { ranking } = await currentRanking(query, now)
  return isLeaderboardOpen(ranking, MIN_PLAYERS)
}

/** The whole tab for one reader, or only "not open yet" -- no names. */
export async function getLeaderboard(query, playerId, now = Date.now()) {
  const { ratings, ranking } = await currentRanking(query, now)
  if (!isLeaderboardOpen(ranking, MIN_PLAYERS)) return { open: false }

  const month = await gatherMonth(query)
  const progress = (await gatherProgress(query, month)).map((p) => {
    const rating = ratings.get(p.id)
    return rating ? { ...p, pprStart: pprAtStart(rating, month.startAt), pprNow: rating.points } : p
  })
  const { matches, visible, nameOf, history, monthStart, resetsOn } = month
  return {
    open: true,
    // Ids never leave the server; `you` marks the reader's own row.
    ranking: ranking.map(({ id, ...row }) => ({ ...row, you: id === playerId })),
    you: yourStanding(ranking, ratings, playerId),
    month: { monthStart, resetsOn, ...buildMonthLists({ matches, visible, nameOf, progress, history }) },
  }
}
