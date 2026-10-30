// ============================================================
// The scorekeeper's side of a split: what is waiting on Home, and the
// rulings that arrive while scoring (applied to this phone's log, the
// only writer -- see server/src/scorekeeper-rules.js).
// ============================================================
import { useCallback, useEffect, useState } from 'react'
import { fetchScorekeeping, fetchWaitingRulings, refuseRuling } from './api'
import { getMatch, setMatchEvents } from './storage'
import { applyRuling } from '../../server/src/scorekeeper-rules.js'

const HOME_POLL_MS = 10_000
const RULINGS_POLL_MS = 2_000

/** Matches this umpire was asked to score, checked every 10 s while Home is open; refresh() checks now. */
export function useScorekeeping() {
  const [matches, setMatches] = useState([])
  const refresh = useCallback(() => {
    if (document.visibilityState !== 'visible') return Promise.resolve()
    return fetchScorekeeping().then((next) => Array.isArray(next) && setMatches(next), () => {})
  }, [])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, HOME_POLL_MS)
    return () => clearInterval(timer)
  }, [refresh])
  return [matches, refresh]
}

const BANNER = {
  stands: () => 'Call stands',
  replay: () => 'Replay: last rally removed',
  overturned: (team) => `Overturned: rally to ${team}. How did it end?`,
  wrongWinner: (team) => `Winner corrected: rally to ${team}. How did it end?`,
}

/**
 * Applies the match umpire's rulings as they arrive, every 2 s; returns the latest banner.
 * A 403 means scoring was taken from this phone: onRevoked hears it at once.
 */
export function useRulingsPoller(matchId, active, teamWords, onRevoked) {
  const [banner, setBanner] = useState(null)
  useEffect(() => {
    if (!active) return undefined
    let live = true
    let running = false
    const tick = async () => {
      if (running) return
      running = true
      try {
        for (const ruling of await fetchWaitingRulings(matchId)) {
          const match = getMatch(matchId)
          if (!live || !match) return
          // Ended meanwhile: setMatchEvents would refuse, and no banner is true.
          if (match.status === 'completed') return
          // Applied here already; the server keeps listing it until the log push lands.
          if (match.events.some((e) => e.type === 'ruling' && e.id === ruling.id)) continue
          const result = applyRuling(match.events, ruling, match.teamA)
          // This phone already scored past that rally: too late, say so to the server.
          if (result.refused) { await refuseRuling(matchId, ruling.id); continue }
          setMatchEvents(matchId, result.events)
          setBanner({ id: ruling.id, who: ruling.ruledByName, text: BANNER[ruling.kind](result.reenterFor && teamWords(result.reenterFor)) })
        }
      } catch (error) {
        // Offline or a blip: the rulings wait on the server for the next tick.
        if (error.status === 403) onRevoked()
      } finally {
        running = false
      }
    }
    tick()
    const timer = setInterval(tick, RULINGS_POLL_MS)
    return () => { live = false; clearInterval(timer) }
  }, [matchId, active, teamWords, onRevoked])
  return [banner, () => setBanner(null)]
}
