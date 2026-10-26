// ============================================================
// Rivals and best partners: the reads. The rules are in rivals.js.
// ============================================================

import { MIN_MATCHES } from './rally-rating.js'
import { getRallyRatings } from './rally-rating-store.js'
import { RATING_GAP, blockFor } from './rivals.js'

// The matches that count: completed, with a winner, nothing voided.
const COUNTED = `m.status = 'completed' AND m.winner IS NOT NULL AND m.voided_at IS NULL AND s.voided_at IS NULL`

/** Everyone who shared a counted match with `id`, either side of the net. */
export async function counterparts(query, id) {
  const { rows } = await query(
    `SELECT DISTINCT unnest(m.team_a || m.team_b) AS id
       FROM matches m JOIN sessions s ON s.id = m.session_id
      WHERE ${COUNTED} AND (m.team_a || m.team_b) @> ARRAY[$1::uuid]`,
    [id],
  )
  return new Set(rows.map((r) => r.id).filter((other) => other !== id))
}

/** Players whose counted rating is within RATING_GAP of `id`'s counted rating. */
export function ratingNeighbours(ratings, id) {
  const mine = ratings.get(id)
  if (!mine || mine.matches < MIN_MATCHES) return []
  return [...ratings]
    .filter(([other, r]) => other !== id && r.matches >= MIN_MATCHES && Math.abs(r.points - mine.points) <= RATING_GAP)
    .map(([other]) => other)
}

/** Each of `playerIds`' blocks, read in three queries however many there are. */
export async function blocksFor(query, playerIds) {
  const ratings = await getRallyRatings(query)
  const { rows: matches } = await query(
    `SELECT m.team_a, m.team_b, m.winner
       FROM matches m JOIN sessions s ON s.id = m.session_id
      WHERE ${COUNTED} AND (m.team_a || m.team_b) && $1::uuid[]`,
    [playerIds],
  )
  // shortcut: reads every active player; filter by id once there are thousands.
  const { rows: active } = await query(
    `SELECT id, name, name_visible, near_rating_name FROM players
      WHERE deactivated_at IS NULL AND paused_at IS NULL`,
  )
  const people = new Map(active.map((p) => [p.id, { name: p.name, nameVisible: p.name_visible, nearRatingName: p.near_rating_name }]))
  const blocks = new Map()
  for (const me of playerIds) {
    const mine = matches
      .filter((m) => m.team_a.includes(me) || m.team_b.includes(me))
      .map((m) => ({ teamA: m.team_a, teamB: m.team_b, winner: m.winner }))
    blocks.set(me, blockFor({ me, matches: mine, ratings, people, minMatches: MIN_MATCHES }))
  }
  return blocks
}
