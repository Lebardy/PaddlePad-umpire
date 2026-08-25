import { useSyncExternalStore } from 'react'
import { subscribe } from './localstore'
import {
  getSessions,
  getSession,
  getKnownPlayers,
  getMatch,
  getMatches,
} from './storage'

// ============================================================
// React bindings for the local store.
//
// Every hook here is useSyncExternalStore over localstore's change
// notifications, so a write anywhere in the app re-renders whatever is
// showing that data. Screens previously read during render and never
// updated -- Home and SessionDetail both had that bug, and only looked
// correct because navigating away unmounted them.
//
// THE REFERENCE-STABILITY RULE, PART TWO
//
// useSyncExternalStore compares snapshots with Object.is and re-renders
// when they differ. localstore guarantees a stable reference for a
// whole stored value, but any snapshot that DERIVES a new value --
// .filter(), .map(), a fresh object literal -- produces a new reference
// on every call and would re-render forever.
//
// So derived snapshots are memoised below on (source, argument). If you
// add a hook that filters or maps, it must go through selectFrom() or
// it will hang the app.
// ============================================================

/**
 * Caches a derived value per key, recomputing only when the underlying
 * stored array is replaced (compared by reference) or the key changes.
 */
function selectFrom(cache, key, source, compute) {
  const hit = cache.get(key)
  if (hit && hit.source === source) return hit.result

  const result = compute()
  cache.set(key, { source, result })
  return result
}

const matchesBySession = new Map()

/** Every session, newest first. */
export function useSessions() {
  return useSyncExternalStore(subscribe, getSessions)
}

/** One session, or null while it isn't in the local cache. */
export function useSession(sessionId) {
  return useSyncExternalStore(subscribe, () => getSession(sessionId))
}

/** Every player this device knows about. */
export function usePlayers() {
  return useSyncExternalStore(subscribe, getKnownPlayers)
}

/** One match, or null while it isn't in the local cache. */
export function useMatch(matchId) {
  return useSyncExternalStore(subscribe, () => getMatch(matchId))
}

/**
 * Matches belonging to one session.
 *
 * Memoised because .filter() would otherwise hand React a new array
 * every render and spin forever.
 */
export function useMatchesForSession(sessionId) {
  return useSyncExternalStore(subscribe, () => {
    const all = getMatches()
    return selectFrom(matchesBySession, sessionId, all, () =>
      all.filter((m) => m.sessionId === sessionId),
    )
  })
}
