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

// A player's sign-in handle, kept in a separate namespace from their
// display name.
//
// The display name is who the roster and the People screen call someone,
// typed by an umpire, with spaces and capitals. The username is only ever
// typed by the player themselves, to sign in. Keeping them apart is what
// lets a username be picked freely without touching the identity the
// match data depends on.
//
// Lowercase-only and no spaces is doing real work beyond tidiness: it
// makes a username structurally unable to be mistaken for a display name
// in a log, a bug report, or someone's head.
const USERNAME_RE = /^[a-z0-9_]{3,20}$/

// Stated in full wherever a username is refused. A bare "invalid" on a
// field someone is in the middle of inventing is the most frustrating
// form there is -- the rule has to come with the rejection.
export const USERNAME_RULE =
  'Usernames can use letters, numbers and underscores, 3 to 20 characters'

/** Lowercases and trims, so `Maria` and `maria` cannot become two accounts. */
export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function isValidUsername(value) {
  return USERNAME_RE.test(value)
}

