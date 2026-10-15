// ============================================================
// A place's open play this week, on its page. Nothing posted, or
// nothing loaded: the section is left out rather than guessed at.
// ============================================================

import { useEffect, useState } from 'react'
import { fetchOpenPlays } from '../lib/api'
import { useLevelRank } from '../lib/useLevelRank'
import Icon from './Icon'
import OpenPlayRow, { OpenPlayNote } from './OpenPlayRow'

function OpenPlaySection({ facilityId }) {
  const [rows, setRows] = useState(null)
  const rank = useLevelRank(Boolean(rows?.some((row) => row.atYourLevel > 0)))

  useEffect(() => {
    const controller = new AbortController()
    fetchOpenPlays({ facilityId, signal: controller.signal }).then(setRows).catch(() => {})
    return () => controller.abort()
  }, [facilityId])

  if (!rows || rows.length === 0) return null
  const change = (next) => setRows((current) => current.map((row) => (row.id === next.id ? next : row)))
  return (
    <section className="open-play" aria-label="Open play">
      <div className="section-head">
        <h2><Icon name="calendar" size={17} className="head-icon" />Open play</h2>
        <span className="chip">{rows.length} this week</span>
      </div>
      <ul className="op-rows">
        {rows.map((row) => <OpenPlayRow key={row.id} row={row} tile="date" rank={rank} onChange={change} />)}
      </ul>
      <OpenPlayNote />
    </section>
  )
}

export default OpenPlaySection
