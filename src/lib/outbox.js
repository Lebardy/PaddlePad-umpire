import { read, write } from './localstore'

// ============================================================
// Outbox -- what this device still owes the server.
//
// THE CENTRAL DESIGN CHOICE: entries hold a POINTER, never a payload.
//
// An entry says "match M1's log is dirty", not "here are these twelve
// taps". The payload is read fresh from local storage at the moment of
// pushing. Three things follow, and all of them matter courtside:
//
//   1. Coalescing is automatic. Twelve taps produce ONE entry, not
//      twelve, so a long rally-heavy game is still a single push.
//   2. Taps made during a failed push ride along on the retry. The
//      retry sends the CURRENT log, never a stale snapshot, so there is
//      no queue-behind-a-failure problem.
//   3. There is exactly one copy of the truth, so localStorage stays
//      small no matter how long the device is offline.
//
// Ordering is a single global FIFO because the foreign keys demand it:
// players before rosters and matches, sessions before matches, matches
// before their events. The UI cannot create a match before its session,
// so one queue in insertion order satisfies the graph for free. Per
// entity queues would mean reimplementing that dependency graph by
// hand.
// ============================================================

const OUTBOX_KEY = 'paddlepad.outbox'
const DEVICE_KEY = 'paddlepad.deviceId'

const EMPTY = Object.freeze({ order: [], entries: {}, deadLetter: [] })

function load() {
  const value = read(OUTBOX_KEY, EMPTY)
  // Defend against a half-written or hand-edited value; an outbox that
  // throws would block every sync forever.
  if (!value || !Array.isArray(value.order) || typeof value.entries !== 'object') {
    return { order: [], entries: {}, deadLetter: [] }
  }
  return {
    order: value.order,
    entries: value.entries,
    deadLetter: Array.isArray(value.deadLetter) ? value.deadLetter : [],
  }
}

function save(state) {
  write(OUTBOX_KEY, state)
}

/** A stable per-device id, used for the match scoring lease. */
export function getDeviceId() {
  const existing = read(DEVICE_KEY, null)
  if (typeof existing === 'string' && existing) return existing
  const id = crypto.randomUUID()
  write(DEVICE_KEY, id)
  return id
}

export function outboxKey(kind, entityId) {
  return `${kind}:${entityId}`
}

/**
 * Marks something as needing a push. Idempotent: marking an already
 * queued entity just refreshes its timestamp and leaves its position,
 * which is what makes rapid taps collapse into one push.
 */
export function markDirty(kind, entityId) {
  const state = load()
  const key = outboxKey(kind, entityId)
  const existing = state.entries[key]

  const entries = {
    ...state.entries,
    [key]: {
      kind,
      entityId,
      dirtyAt: Date.now(),
      // A fresh local change means an earlier permanent failure may no
      // longer apply, so give it another run of attempts.
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      state: 'pending',
      ...(existing ? { firstDirtyAt: existing.firstDirtyAt ?? existing.dirtyAt } : {}),
    },
  }

  const order = existing ? state.order : [...state.order, key]
  save({ ...state, order, entries })
}

/**
 * Empties the queue completely, dead letters included.
 *
 * Only for signing out and for abandoning local state wholesale (see
 * clearLocalData in storage.js). Anything queued here is work this
 * device owes the server, so discarding it silently loses match data --
 * which is why the caller warns first rather than this function
 * refusing, since the recovery path needs it to be unconditional.
 */
export function clearOutbox() {
  save({ order: [], entries: {}, deadLetter: [] })
}

/** Entries in push order. */
export function pending() {
  const state = load()
  return state.order.map((key) => ({ key, ...state.entries[key] })).filter((e) => e.kind)
}

export function pendingCount() {
  return load().order.length
}

export function deadLetter() {
  return load().deadLetter
}

/** Removes an entry after a successful push. */
export function resolve(key) {
  const state = load()
  if (!state.entries[key]) return
  const entries = { ...state.entries }
  delete entries[key]
  save({
    ...state,
    order: state.order.filter((k) => k !== key),
    entries,
  })
}

/**
 * Records a failure that is worth retrying, with backoff.
 *
 * Jittered so that a whole venue's devices coming back onto the same wifi
 * don't retry in lockstep.
 */
export function defer(key, error, delayMs) {
  const state = load()
  const entry = state.entries[key]
  if (!entry) return

  const jitter = 0.8 + Math.random() * 0.4
  save({
    ...state,
    entries: {
      ...state.entries,
      [key]: {
        ...entry,
        attempts: entry.attempts + 1,
        nextAttemptAt: Date.now() + Math.round(delayMs * jitter),
        lastError: error,
        state: 'pending',
      },
    },
  })
}

/**
 * Marks an entry as blocked on a decision (another device holds the
 * match). Not a failure and not dead -- the local log is intact and the
 * umpire is being asked whether to take over.
 */
export function block(key, info) {
  const state = load()
  const entry = state.entries[key]
  if (!entry) return
  save({
    ...state,
    entries: {
      ...state.entries,
      [key]: { ...entry, state: 'blocked', lastError: info },
    },
  })
}

/**
 * Retires an entry that can never succeed.
 *
 * Dead-lettered work is kept, never silently dropped: the umpire's taps
 * are still in local storage, and the entry is listed (screens/
 * CouldntSync.jsx) so they can retry or knowingly discard it. Listed
 * once: a change refused a second time replaces its earlier line.
 * Continuing to drain past it is deliberate --
 * head-of-line blocking is correct for a transient error but would
 * freeze the app forever on a permanent one.
 */
export function killEntry(key, error) {
  const state = load()
  const entry = state.entries[key]
  if (!entry) return
  const entries = { ...state.entries }
  delete entries[key]
  save({
    order: state.order.filter((k) => k !== key),
    entries,
    deadLetter: [
      ...state.deadLetter.filter((d) => d.key !== key),
      { ...entry, key, error, diedAt: Date.now() },
    ],
  })
}

/** Puts a dead-lettered entry back in the queue for another try. */
export function reviveDead(key) {
  const state = load()
  const dead = state.deadLetter.find((d) => d.key === key)
  if (!dead) return
  save({
    // Already queued again if the umpire changed it after it was refused.
    order: state.order.includes(key) ? state.order : [...state.order, key],
    entries: {
      ...state.entries,
      [key]: {
        kind: dead.kind,
        entityId: dead.entityId,
        dirtyAt: Date.now(),
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null,
        state: 'pending',
        // Kept so that a second refusal goes back to the same place in
        // the list instead of jumping to the end.
        refusedFirst: dead.refusedFirst ?? dead.diedAt,
      },
    },
    deadLetter: state.deadLetter.filter((d) => d.key !== key),
  })
}

/** Permanently forgets a dead-lettered entry, at the umpire's request. */
export function discardDead(key) {
  const state = load()
  save({ ...state, deadLetter: state.deadLetter.filter((d) => d.key !== key) })
}
