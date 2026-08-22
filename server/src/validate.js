// Shared request validation.
//
// The client validates too, but the server is the durable record and
// the client is not a trusted validator -- a stale app version, a bug,
// or a hand-crafted request all reach the same endpoints.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Whether a value is a well-formed UUID.
 *
 * Also the guard that keeps a future offline-created player id (which
 * would be prefixed `local:`) from ever being mistaken for a real
 * server id and silently inserted as a stranger.
 */
export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

/**
 * Maps the app's `stacking: { A, B }` onto the database's two columns.
 *
 * This exists as a named pair rather than inline object access because
 * an A/B swap here would be completely silent: the match would still
 * save, still score correctly, and simply attribute stacking to the
 * wrong team in the ML export, where nothing would ever flag it.
 */
export function stackingToColumns(stacking) {
  return {
    stacking_a: Boolean(stacking?.A),
    stacking_b: Boolean(stacking?.B),
  }
}

export function stackingFromColumns(row) {
  return { A: Boolean(row.stacking_a), B: Boolean(row.stacking_b) }
}
