import { useEffect, useState } from 'react'
import { fetchStanding } from './api'

/**
 * The viewer's level picture for an open play's "N at your level". The
 * rows say how many share it but not which it is, so it is asked for
 * only when a row needs it.
 */
export function useLevelRank(wanted) {
  const [rank, setRank] = useState(null)
  useEffect(() => {
    if (!wanted) return undefined
    const controller = new AbortController()
    fetchStanding({ signal: controller.signal })
      .then((standing) => setRank(standing.level?.rank ?? null))
      .catch(() => {})
    return () => controller.abort()
  }, [wanted])
  return wanted ? rank : null
}
