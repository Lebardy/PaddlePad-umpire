// ============================================================
// Every match, with two filters.
//
// The overview shows five; this is the whole history.
//
// Two dimensions rather than one list of five buttons, because format
// and result are different questions and the useful ones are the
// combinations: "my doubles losses" is a thing a player actually wants
// to see, and a single row could never answer it.
//
// Still no filter panel. All / Wins / Losses and All / Singles /
// Doubles answer nearly everything anyone asks of their own record, and
// a panel of dropdowns would be a bigger feature pretending to be a
// smaller one.
// ============================================================

import { useState } from 'react'
import { usePlayerData } from '../lib/PlayerData'
import MatchList from '../components/MatchList'

const FORMATS = [
  { key: 'all', label: 'All' },
  { key: 'singles', label: 'Singles' },
  { key: 'doubles', label: 'Doubles' },
]

const RESULTS = [
  { key: 'all', label: 'All' },
  { key: 'won', label: 'Wins' },
  { key: 'lost', label: 'Losses' },
]

/** One row of filter buttons. Both rows are the same control. */
function FilterRow({ options, value, onChange, label }) {
  return (
    <div className="filter-row" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`filter ${value === option.key ? 'filter-active' : ''}`}
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * What to say when a filter matches nothing.
 *
 * Built from whichever filters are actually on, because the old fixed
 * pair of sentences assumed result was the only dimension -- with a
 * format filter added it would answer "no singles matches" with "No
 * losses yet."
 */
function emptyMessage(format, result) {
  const kind = format === 'all' ? '' : `${format} `
  if (result === 'won') return `No ${kind}wins yet.`
  if (result === 'lost') return `No ${kind}losses yet.`
  return `No ${kind}matches yet.`
}

function Matches() {
  const { matches } = usePlayerData()
  const [format, setFormat] = useState('all')
  const [result, setResult] = useState('all')

  // A filter whose only possible answer is an empty list is worse than
  // no filter, so the format row appears only for someone who actually
  // plays both. Same reasoning as the singles/doubles split in
  // personalBests: respect what this player actually plays.
  const playsBoth =
    matches.some((m) => m.isDoubles) && matches.some((m) => !m.isDoubles)

  const shown = matches.filter((m) => {
    if (format === 'singles' && m.isDoubles) return false
    if (format === 'doubles' && !m.isDoubles) return false
    if (result === 'won') return m.won === true
    if (result === 'lost') return m.won === false
    return true
  })

  const filtering = (playsBoth && format !== 'all') || result !== 'all'

  return (
    <div className="matches-screen">
      <div className="section-head">
        <h1>Matches</h1>
        {/* While a filter is on, say what is on screen rather than a
            total that contradicts the list under it. */}
        <span className="muted-inline">
          {filtering
            ? `${shown.length} of ${matches.length}`
            : `${matches.length} played`}
        </span>
      </div>

      {playsBoth && (
        <FilterRow
          options={FORMATS}
          value={format}
          onChange={setFormat}
          label="Filter by format"
        />
      )}

      <FilterRow
        options={RESULTS}
        value={result}
        onChange={setResult}
        label="Filter by result"
      />

      {shown.length === 0 ? (
        <p className="muted">{emptyMessage(playsBoth ? format : 'all', result)}</p>
      ) : (
        <MatchList matches={shown} />
      )}
    </div>
  )
}

export default Matches
