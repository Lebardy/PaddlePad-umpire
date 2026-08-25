import { useSyncExternalStore } from 'react'
import { getSyncStatus, subscribeStatus } from './sync'

// Cached so useSyncExternalStore gets a reference-stable snapshot.
// Building a fresh object per call would re-render forever -- the same
// trap documented at the top of localstore.js.
let cached = getSyncStatus()

function snapshot() {
  const next = getSyncStatus()
  if (
    next.pending !== cached.pending ||
    next.dead !== cached.dead ||
    next.reachable !== cached.reachable ||
    next.authPaused !== cached.authPaused
  ) {
    cached = next
  }
  return cached
}

export function useSyncStatus() {
  return useSyncExternalStore(subscribeStatus, snapshot)
}
