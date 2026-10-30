// ============================================================
// Today's open play courts on this phone: the lookup, kept for when
// the phone is offline. The rules are in courtRules.js.
// ============================================================
import { useEffect, useState } from 'react'
import { fetchTodayCourts } from './api'

export { startableCourts, hoursWords } from './courtRules'

const CACHE_KEY = 'paddlepad.todayCourts'

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]')
    return Array.isArray(cached) ? cached : []
  } catch {
    return []
  }
}

/** The last lookup, refreshed when Home shows, when the phone comes back online, and every minute while Home is open. */
export function useTodayCourts() {
  const [openPlays, setOpenPlays] = useState(readCache)
  useEffect(() => {
    let live = true
    const refresh = () => fetchTodayCourts()
      .then((next) => {
        // An api older than this app answers without a list: keep what we have.
        if (!live || !Array.isArray(next)) return
        setOpenPlays(next)
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)) } catch { /* cache only */ }
      })
      .catch(() => { /* offline: keep the last lookup */ })
    refresh()
    const timer = setInterval(refresh, 60_000)
    window.addEventListener('online', refresh)
    return () => { live = false; clearInterval(timer); window.removeEventListener('online', refresh) }
  }, [])
  return openPlays
}
