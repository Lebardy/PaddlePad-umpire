// ============================================================
// Local store -- the browser-side cache under everything else.
//
// Two jobs:
//   1. Hold parsed values so reads are cheap and, crucially, STABLE.
//   2. Notify subscribers when anything changes, so React re-renders.
//
// THE REFERENCE-STABILITY RULE
//
// Values are parsed on WRITE and the parsed object is held here.
// read() returns that same object reference every call until a write
// replaces it.
//
// This is not a micro-optimisation, it is a correctness requirement.
// React's useSyncExternalStore compares snapshots by reference, so a
// store that parsed JSON on every read would hand back a brand-new
// array each time, React would conclude the value had changed, and it
// would re-render forever. Any change here that reintroduces
// parse-on-read will hang the app.
// ============================================================

const cache = new Map()
const listeners = new Set()

// Stable empty values, so a key that has never been written still
// returns the same reference on every read.
const EMPTY_ARRAY = Object.freeze([])

function parse(raw, fallback) {
  if (raw === null) return fallback
  try {
    return JSON.parse(raw)
  } catch {
    // Corrupt entry (a half-written value, or something else using the
    // same key). Fall back rather than taking the whole app down.
    return fallback
  }
}

/**
 * Reads a key, returning a reference-stable value.
 *
 * @param {string} key
 * @param {*} [fallback] value when the key is absent; defaults to a
 *   shared frozen empty array, since every current caller stores lists.
 */
export function read(key, fallback = EMPTY_ARRAY) {
  if (cache.has(key)) return cache.get(key)

  let raw = null
  try {
    raw = localStorage.getItem(key)
  } catch {
    // Private mode / storage disabled. Behave as if empty.
  }

  const value = parse(raw, fallback)
  cache.set(key, value)
  return value
}

/** Writes a key, updates the cache, and notifies subscribers. */
export function write(key, value) {
  cache.set(key, value)
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    // Quota exceeded, or storage disabled. The in-memory cache still
    // has the value so the current session keeps working, but it will
    // not survive a reload -- worth surfacing rather than swallowing.
    console.error(`Could not persist ${key}:`, error)
  }
  emit()
}

/** Drops a key entirely. */
export function remove(key) {
  cache.delete(key)
  try {
    localStorage.removeItem(key)
  } catch {
    // nothing useful to do
  }
  emit()
}

/**
 * Subscribes to any change. Returns an unsubscribe function.
 * Shaped for useSyncExternalStore.
 */
export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emit() {
  for (const listener of listeners) listener()
}

// The `storage` event fires only in OTHER tabs, so this covers the
// case of an umpire with the app open twice; emit() covers this tab.
// Without it, a second tab would render stale data indefinitely.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null) {
      // Storage was cleared wholesale.
      cache.clear()
      emit()
      return
    }
    if (cache.has(event.key)) {
      cache.delete(event.key)
      emit()
    }
  })
}
