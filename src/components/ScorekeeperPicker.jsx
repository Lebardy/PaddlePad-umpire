import { useEffect, useState } from 'react'
import Icon from './Icon'
import { fetchScorekeepers } from '../lib/api'
import { askScorekeeper } from '../lib/storage'

/** Lists the other umpires at this place; picking one asks them to tap this match. Online only. */
function ScorekeeperPicker({ matchId, onClose }) {
  const [umpires, setUmpires] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    fetchScorekeepers().then(setUmpires, () => setError('Needs a connection'))
  }, [])
  return (
    <div className="scorekeeper-picker" role="dialog" aria-label="Pick a scorekeeper">
      <div className="picker-head">
        <strong><Icon name="people" size={18} />Scorekeeper</strong>
        <button className="icon-solo" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!error && !umpires && <p className="muted">Loading…</p>}
      {umpires?.length === 0 && <p className="muted">No other umpires here</p>}
      <ul>
        {umpires?.map((u) => (
          <li key={u.id}>
            <button onClick={() => { askScorekeeper(matchId, u); onClose() }}>
              <Icon name="user" size={18} />{u.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ScorekeeperPicker
