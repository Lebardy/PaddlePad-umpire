// ============================================================
// Every place's open play this week, by day, soonest first. Reached
// from the Overview's "Looking for open play?".
// ============================================================

import { Fragment, useEffect, useState } from 'react'
import Icon from '../components/Icon'
import OpenPlayRow, { OpenPlayNote } from '../components/OpenPlayRow'
import { fetchOpenPlays } from '../lib/api'
import { useLevelRank } from '../lib/useLevelRank'
import { dayHeading } from '../lib/openPlay'
import { navigate } from '../lib/router'

function OpenPlay() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const rank = useLevelRank(Boolean(rows?.some((row) => row.atYourLevel > 0)))

  useEffect(() => {
    const controller = new AbortController()
    fetchOpenPlays({ signal: controller.signal })
      .then(setRows)
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err.message)
      })
    return () => controller.abort()
  }, [])

  const change = (next) => setRows((current) => current.map((row) => (row.id === next.id ? next : row)))
  const days = []
  for (const row of rows ?? []) {
    const label = dayHeading(row.startsAt)
    if (days.at(-1)?.label !== label) days.push({ label, rows: [] })
    days.at(-1).rows.push(row)
  }

  return (
    <div className="open-play-screen">
      <button
        type="button"
        className="back-link"
        onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))}
      >
        <Icon name="chevron" size={18} className="icon-back" />Back
      </button>
      <h1>Open play</h1>
      {rows === null ? (
        <p className="muted">{error ?? 'Loading…'}</p>
      ) : rows.length === 0 ? (
        <p className="muted">No open play this week.</p>
      ) : (
        <section className="open-play" aria-label="Open play">
          {days.map((day) => (
            <Fragment key={day.label}>
              <h2 className="op-day-head">{day.label}</h2>
              <ul className="op-rows">
                {day.rows.map((row) => <OpenPlayRow key={row.id} row={row} tile="place" rank={rank} onChange={change} />)}
              </ul>
            </Fragment>
          ))}
          <OpenPlayNote />
        </section>
      )}
    </div>
  )
}

export default OpenPlay
