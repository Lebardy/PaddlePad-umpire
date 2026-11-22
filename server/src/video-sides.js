// ============================================================
// Two filmers: one phone per side of a match.
//
// A match holds at most one player video per side (A, B), or one
// facility video, which has no side and keeps players from filming.
// These are the two questions every route asks of a match's video rows:
// which row a claim must look at, and which video a viewer sees first.
// ============================================================

/** The side `playerId` plays on in `match` ({ team_a, team_b }), or null. */
export function sideOf(match, playerId) {
  if (match.team_a?.includes(playerId)) return 'A'
  if (match.team_b?.includes(playerId)) return 'B'
  return null
}

/** The row a claim for `side` must reckon with: the facility's, else that side's own. */
export function heldFor(rows, side) {
  return rows.find((r) => r.source === 'facility') ?? rows.find((r) => r.side === side) ?? null
}

/**
 * [first, other] among the READY rows: a facility video first; then the
 * `prefer` side's (a player's own side, or the winners on the board);
 * with no preference, side A before side B.
 */
export function orderVideos(rows, prefer) {
  const ready = rows.filter((r) => r.state === 'ready')
  const rank = (r) => (r.source === 'facility' ? 0 : r.side === (prefer ?? 'A') ? 1 : 2)
  const [first = null, other = null] = [...ready].sort((a, b) => rank(a) - rank(b))
  return [first, other]
}
