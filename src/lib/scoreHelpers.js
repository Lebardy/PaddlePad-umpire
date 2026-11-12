// ============================================================
// What the scoring screen works out from the score and the log, so the
// umpire does not have to: the score call, game point, timeouts left and
// when to switch ends. Rules: 2026 USA Pickleball Rulebook, Section 21.
// ============================================================

export const TIMEOUT_MS = 60_000

/** The call before the serve: serving score – receiving score – server number (singles: two numbers). */
export function scoreCall(derived) {
  const serving = derived.score[derived.servingTeam]
  const receiving = derived.score[derived.servingTeam === 'A' ? 'B' : 'A']
  return derived.isDoubles ? `${serving} – ${receiving} – ${derived.serverNumber}` : `${serving} – ${receiving}`
}

/** The serving side wins the game by winning this rally (only the server scores; win by 2). */
export function isGamePoint(derived) {
  if (derived.completed) return false
  const next = derived.score[derived.servingTeam] + 1
  const other = derived.score[derived.servingTeam === 'A' ? 'B' : 'A']
  return next >= derived.pointTarget && next - other >= 2
}

/** Rule 21.B: switch ends when the first side reaches 6 (to 11), 8 (to 15) or 11 (to 21). */
export const endChangeAt = (target) => Math.ceil(target / 2)

/** Rule 21.A: 2 per side per game to 11 or 15, 3 to 21. */
export function timeoutsLeft(events, team, target) {
  const used = events.filter((e) => e.type === 'timeout' && e.team === team).length
  return Math.max(0, (target === 21 ? 3 : 2) - used)
}

/** The timeout still running: the log's last event, under a minute old. */
export function runningTimeout(events, now = Date.now()) {
  const last = events.at(-1)
  if (last?.type !== 'timeout' || now - last.at >= TIMEOUT_MS) return null
  return { team: last.team, endsAt: last.at + TIMEOUT_MS }
}
