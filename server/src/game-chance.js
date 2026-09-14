// ============================================================
// The chance of winning a game, from the chance of winning a rally.
//
// Only the serving side scores, so a small edge per rally grows over a
// game in a way that depends on the serving rules in pickleball.js:
// singles passes the serve on a lost rally; doubles gives each side a
// server 1 and a server 2, except the very first service of the game,
// which has one; first to the target with a two-point lead.
//
// Pure and exact (to floating point): no simulation. Used by the rally
// rating's match reward. See
// docs/superpowers/specs/2026-09-14-match-reward-design.md.
// ============================================================

/**
 * Team A's chance of winning a game when A wins any one rally with
 * `rallyChance`. `firstServer` is 'A' or 'B'. NaN in, NaN out.
 */
export function gameWinChance(rallyChance, { doubles, target = 11, firstServer = 'A' }) {
  if (!Number.isFinite(rallyChance)) return NaN
  const p = Math.min(1, Math.max(0, rallyChance))
  const deuce = target - 1

  // Once both sides reach target - 1 only the lead matters, so those
  // scores fold onto three: level, A one ahead, B one ahead.
  const fold = (a, b) => (a < deuce || b < deuce ? [a, b] : [deuce + Math.max(a - b, 0), deuce + Math.max(b - a, 0)])
  const winner = (a, b) => (Math.max(a, b) >= target && Math.abs(a - b) >= 2 ? (a > b ? 1 : 0) : null)

  // Serve states: [servingA, server number, first service of the game].
  const serves = [[true, 1, false], [false, 1, false]]
  if (doubles) serves.push([true, 2, false], [false, 2, false])
  serves.push([firstServer === 'A', doubles ? 2 : 1, true])
  const S = serves.length
  const size = target + 1
  const chance = new Float64Array(size * size * S).fill(0.5)
  const slot = (a, b, s) => (a * size + b) * S + s
  const serveIndex = (servingA, server, first) =>
    serves.findIndex(([x, y, z]) => x === servingA && y === server && z === first)

  const valueAt = (a, b, s) => {
    const done = winner(a, b)
    if (done !== null) return done
    const [fa, fb] = fold(a, b)
    return chance[slot(fa, fb, s)]
  }
  const update = (a, b, s) => {
    const [servingA, server, first] = serves[s]
    const scored = servingA ? valueAt(a + 1, b, s) : valueAt(a, b + 1, s)
    let sidedOut
    if (!doubles || first) sidedOut = valueAt(a, b, serveIndex(!servingA, 1, false))
    else if (server === 1) sidedOut = valueAt(a, b, serveIndex(servingA, 2, false))
    else sidedOut = valueAt(a, b, serveIndex(!servingA, 1, false))
    const next = servingA ? p * scored + (1 - p) * sidedOut : (1 - p) * scored + p * sidedOut
    const moved = Math.abs(next - chance[slot(a, b, s)])
    chance[slot(a, b, s)] = next
    return moved
  }
  // A block is every serve state at one score; the three folded deuce
  // scores form one block, because play cycles between them. Blocks are
  // settled from the end of the game backwards, so everything a block
  // leads to is already final and only its own loop needs iterating.
  const settle = (scores) => {
    for (let i = 0; i < 100000; i += 1) {
      let moved = 0
      for (const [a, b] of scores) for (let s = 0; s < S; s += 1) moved = Math.max(moved, update(a, b, s))
      if (moved < 1e-15) return
    }
  }
  settle([[deuce, deuce], [deuce + 1, deuce], [deuce, deuce + 1]])
  for (let sum = 2 * deuce - 1; sum >= 0; sum -= 1) {
    for (let a = Math.min(sum, target); a >= Math.max(0, sum - target); a -= 1) {
      const b = sum - a
      if (winner(a, b) !== null || (a >= deuce && b >= deuce)) continue
      settle([[a, b]])
    }
  }
  return chance[slot(0, 0, S - 1)]
}
