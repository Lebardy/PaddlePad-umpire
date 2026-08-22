import { useState } from 'react'
import {
  getSession,
  getKnownPlayers,
  upsertKnownPlayer,
  addPlayerToSession,
  removePlayerFromSession,
  getMatchesForSession,
} from '../lib/storage'

// One session's roster management plus its match list. Matches
// themselves are scored on the LiveMatch screen (onOpenMatch/
// onNewMatch hand off there) -- this screen only sets up who's
// eligible to play.
function SessionDetail({ sessionId, onBack, onNewMatch, onOpenMatch }) {
  const [session, setSession] = useState(() => getSession(sessionId))
  const [knownPlayers, setKnownPlayers] = useState(getKnownPlayers())
  const [newName, setNewName] = useState('')
  const matches = getMatchesForSession(sessionId)

  function refresh() {
    setSession(getSession(sessionId))
    setKnownPlayers(getKnownPlayers())
  }

  function handleAddNew(e) {
    e.preventDefault()
    if (!newName.trim()) return
    const player = upsertKnownPlayer(newName)
    addPlayerToSession(sessionId, player.id)
    setNewName('')
    refresh()
  }

  function handleAddKnown(playerId) {
    addPlayerToSession(sessionId, playerId)
    refresh()
  }

  function handleRemove(playerId) {
    removePlayerFromSession(sessionId, playerId)
    refresh()
  }

  const roster = session.playerIds
    .map((id) => knownPlayers.find((p) => p.id === id))
    .filter(Boolean)

  const availableKnown = knownPlayers.filter(
    (p) => !session.playerIds.includes(p.id),
  )

  return (
    <div className="session-detail">
      <button className="back-link" onClick={onBack}>
        &larr; Sessions
      </button>
      <h2>{session.name}</h2>

      <section className="roster">
        <h3>Roster</h3>
        {roster.length === 0 && <p className="empty">No players yet.</p>}
        <ul>
          {roster.map((p) => (
            <li key={p.id}>
              {p.name}
              <button className="remove" onClick={() => handleRemove(p.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="matches">
        <h3>Matches</h3>
        {matches.length === 0 && <p className="empty">No matches yet.</p>}
        <ul className="match-list">
          {matches.map((m) => (
            <li key={m.id}>
              <button className="match-item" onClick={() => onOpenMatch(m.id)}>
                <span>
                  {m.teamA.map((id) => roster.find((p) => p.id === id)?.name).join(' / ')}
                  {' vs '}
                  {m.teamB.map((id) => roster.find((p) => p.id === id)?.name).join(' / ')}
                </span>
                <span className={`match-status ${m.status}`}>
                  {m.status === 'completed' ? 'Final' : 'Live'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button
          className="new-match-btn"
          disabled={roster.length < 2}
          onClick={() => onNewMatch(sessionId)}
        >
          New Match
        </button>
      </section>

      <section className="add-player">
        <h3>Add a player</h3>
        <p className="placeholder-note">
          Placeholder for now &mdash; real invite-code / QR joining comes
          later once the backend exists.
        </p>

        <form onSubmit={handleAddNew}>
          <input
            type="text"
            placeholder="Player name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit">Add</button>
        </form>

        {availableKnown.length > 0 && (
          <div className="known-players">
            <p>Or add someone you've tracked before:</p>
            <ul>
              {availableKnown.map((p) => (
                <li key={p.id}>
                  <button onClick={() => handleAddKnown(p.id)}>
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}

export default SessionDetail
