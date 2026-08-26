// ============================================================
// Every match, with a filter.
//
// The overview shows five; this is the whole history. Three filters
// rather than a filter panel: All, Wins and Losses answer nearly every
// question a player actually asks of their own record, and a panel of
// dropdowns would be a bigger feature pretending to be a smaller one.
// ============================================================

import { useState } from 'react'
import { usePlayerData } from '../lib/PlayerData'
import MatchList from '../components/MatchList'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'won', label: 'Wins' },
  { key: 'lost', label: 'Losses' },
]

function Matches() {
  const { matches } = usePlayerData()
  const [filter, setFilter] = useState('all')

  const shown = matches.filter((m) => {
    if (filter === 'won') return m.won === true
    if (filter === 'lost') return m.won === false
    return true
  })

  return (
    <div className="matches-screen">
      <div className="section-head">
        <h1>Matches</h1>
        <span className="muted-inline">{matches.length} played</span>
      </div>

      <div className="filter-row" role="group" aria-label="Filter matches">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`filter ${filter === option.key ? 'filter-active' : ''}`}
            aria-pressed={filter === option.key}
            onClick={() => setFilter(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="muted">
          {filter === 'won' ? 'No wins yet.' : 'No losses yet.'}
        </p>
      ) : (
        <MatchList matches={shown} />
      )}
    </div>
  )
}

export default Matches
