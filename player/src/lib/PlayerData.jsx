// ============================================================
// One fetch of this player's whole history, shared by every screen.
//
// This is the decision that makes the app feel like an app rather than
// a set of pages. /player/matches returns EVERY match in one payload,
// so once this provider holds that array, opening a match is
// `matches.find(...)` -- instant, no spinner, no request. If each screen
// fetched for itself, every tap would cost a round trip and the result
// would be a slower website with more screens in it.
//
// It also means the derived figures in derive.js keep working. All of
// them (streaks, records, personal bests) need the full history, so they
// are only correct while nothing is paginated.
// ============================================================

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { fetchMatches, fetchMe } from './api'

const PlayerDataContext = createContext(null)

// How stale the data may be before returning to the app refetches it.
// Short enough that a match finishing while the phone is pocketed shows
// up on the next look, long enough that idly switching apps doesn't
// hammer the API.
const STALE_AFTER_MS = 60_000

export function PlayerDataProvider({ children }) {
  const [state, setState] = useState({
    summary: null,
    matches: [],
    inProgress: 0,
    // Either a skill score with the pool it was measured against, or
    // the reason there isn't one yet. Never a bare null -- see
    // getRatingState on the server for why the difference matters.
    rating: null,
    // The player-facing rally rating: points with anchors, or progress
    // towards five matches.
    rallyRating: null,
    loading: true,
    error: null,
    loadedAt: null,
  })

  // Lets the visibility handler read freshness without being re-created
  // every time the data changes, which would re-subscribe on every load.
  const loadedAtRef = useRef(null)
  const inFlightRef = useRef(null)

  const load = useCallback(async ({ quiet = false } = {}) => {
    // A refresh triggered while one is already running is a no-op rather
    // than a second request: the visibility handler and a tapped refresh
    // button can easily fire together.
    if (inFlightRef.current) return inFlightRef.current

    const controller = new AbortController()
    if (!quiet) setState((s) => ({ ...s, loading: true }))

    const run = (async () => {
      try {
        const [me, history] = await Promise.all([
          fetchMe({ signal: controller.signal }),
          fetchMatches({ signal: controller.signal }),
        ])
        if (controller.signal.aborted) return
        loadedAtRef.current = Date.now()
        setState({
          summary: me.summary,
          matches: history,
          inProgress: me.inProgress ?? 0,
          rating: me.rating ?? null,
          rallyRating: me.rallyRating ?? null,
          loading: false,
          error: null,
          loadedAt: loadedAtRef.current,
        })
      } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        // A 401 here already means the session just ended (paused, most
        // commonly) -- api.js has cleared it and told App.jsx to drop
        // the player (see subscribeSessionEnded there), which unmounts
        // this whole provider. There's nothing useful to show in this
        // provider's own error state -- not the dead-end "couldn't
        // refresh" note, and not a full-screen error with a Try Again
        // that would just 401 again.
        if (err.status === 401) return
        // A failed REFRESH must not wipe data that is already on screen.
        // Being briefly offline courtside is normal, and blanking the
        // page for it would be worse than showing slightly old numbers.
        setState((s) => ({
          ...s,
          loading: false,
          error: err.message,
          matches: quiet ? s.matches : [],
          rating: quiet ? s.rating : null,
          rallyRating: quiet ? s.rallyRating : null,
        }))
      } finally {
        inFlightRef.current = null
      }
    })()

    inFlightRef.current = run
    return run
  }, [])

  useEffect(() => {
    // Fetching on mount IS synchronising with an external system, which
    // is what effects are for. The lint rule cannot tell that apart from
    // a value that should have been derived during render.
    // eslint-disable-next-line react/set-state-in-effect
    load()
  }, [load])

  // Coming back to the app is the moment a player most expects fresh
  // numbers -- they have just finished a match and picked their phone
  // up. This is the honest version of live updates: no polling, no
  // battery cost, and it fixes `inProgress` never changing.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      const age = Date.now() - (loadedAtRef.current ?? 0)
      if (age > STALE_AFTER_MS) load({ quiet: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const refresh = useCallback(() => load({ quiet: true }), [load])

  return (
    <PlayerDataContext.Provider value={{ ...state, refresh }}>
      {children}
    </PlayerDataContext.Provider>
  )
}

export function usePlayerData() {
  const value = useContext(PlayerDataContext)
  if (!value) throw new Error('usePlayerData must be used inside PlayerDataProvider')
  return value
}
