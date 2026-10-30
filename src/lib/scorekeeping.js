// ============================================================
// The scorekeeper's side of a split: what is waiting on Home, and the
// rulings that arrive while scoring (applied to this phone's log, the
// only writer -- see server/src/scorekeeper-rules.js).
// ============================================================
import { useEffect, useState } from 'react'
import { fetchScorekeeping, fetchWaitingRulings, refuseRuling } from './api'
import { getMatch, setMatchEvents } from './storage'
import { applyRuling } from '../../server/src/scorekeeper-rules.js'

const HOME_POLL_MS = 10_000
const RULINGS_POLL_MS = 2_000

/** Matches this umpire was asked to score, checked every 10 s while Home is open. */
export function useScorekeeping() {
  const [matches, setMatches] = useState([])
  useEffect(() => {
    let live = true
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      fetchScorekeeping().then((next) => live && Array.isArray(next) && setMatches(next), () => {})
    }
    refresh()
    const timer = setInterval(refresh, HOME_POLL_MS)
    return () => { live = false; clearInterval(timer) }
  }, [])
  return matches
}

const BANNER = {
  stands: () => 'Call stands',
  replay: () => 'Replay: last rally removed',
  overturned: (team) => `Overturned: point to ${team}. How did it end?`,
  wrongWinner: (team) => `Winner corrected: point to ${team}. How did it end?`,
}

/** Applies the match umpire's rulings as they arrive, every 2 s; returns the latest banner. */
export function useRulingsPoller(matchId, active, teamWords) {
  const [banner, setBanner] = useState(null)
  useEffect(() => {
    if (!active) return undefined
    let live = true
    const tick = async () => {
      try {
        for (const ruling of await fetchWaitingRulings(matchId)) {
          const match = getMatch(matchId)
          if (!live || !match) return
          const result = applyRuling(match.events, ruling, match.teamA)
          // This phone already scored past that rally: too late, say so to the server.
          if (result.refused) { await refuseRuling(matchId, ruling.id); continue }
          setMatchEvents(matchId, result.events)
          setBanner({ id: ruling.id, who: ruling.ruledByName, text: BANNER[ruling.kind](result.reenterFor && teamWords(result.reenterFor)) })
        }
      } catch {
        // Offline or a blip: the rulings wait on the server for the next tick.
      }
    }
    tick()
    const timer = setInterval(tick, RULINGS_POLL_MS)
    return () => { live = false; clearInterval(timer) }
  }, [matchId, active, teamWords])
  return [banner, () => setBanner(null)]
}
