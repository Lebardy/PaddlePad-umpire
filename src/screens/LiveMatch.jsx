import { useState } from 'react'
import {
  getMatch,
  getKnownPlayers,
  addRallyEvent,
  addThirdShotEvent,
  undoLastEvent,
  endMatchManually,
} from '../lib/storage'
import { deriveMatchState, currentServerPlayerId } from '../lib/pickleball'

// The four rally-ending outcomes an umpire can tap, and the exact
// (outcome, zone) pair addRallyEvent needs to file each into the right
// ML stat bucket -- see deriveMatchState in pickleball.js.
const OUTCOMES = [
  { outcome: 'winner', zone: 'open', label: 'Clean Winner' },
  { outcome: 'winner', zone: 'dink', label: 'Dink Winner' },
  { outcome: 'error', zone: 'open', label: 'Unforced Error' },
  { outcome: 'error', zone: 'dink', label: 'Dink Error' },
]

// Turns one logged event into the plain-English line shown in the
// history panel, so an umpire can glance back and confirm what was
// actually recorded without needing to remember button labels.
function describeEvent(event, name) {
  if (event.type === 'rally') {
    const outcome = OUTCOMES.find(
      (o) => o.outcome === event.outcome && o.zone === event.zone,
    )
    return `${name(event.actingPlayerId)} — ${outcome?.label ?? event.outcome}`
  }
  const shotLabel =
    event.shotType === 'drop' ? (event.success ? 'Drop ✓' : 'Drop ✗') : 'Drive'
  return `${name(event.playerId)} — ${shotLabel} (3rd shot)`
}

// The live courtside scoring screen for one match. Score, server
// rotation, and per-player stats are never held in local state
// directly -- every tap just appends an event via storage.js and then
// re-derives everything fresh with deriveMatchState, so this component
// can't drift out of sync with what's actually stored.
//
// Every player's 4 outcome buttons are always on screen at once (one
// tap logs a rally, not two) -- the full-width layout gives enough
// room for that without the buttons getting tiny. Undo sits right
// under the scoreboard rather than at the bottom, since correcting a
// mis-tap needs to be just as fast as making the original tap.
// Rally and 3rd-shot logging are both always on screen since both are
// tapped during play; only the history log is collapsed by default, as
// it's for reviewing after the fact rather than logging mid-rally.
function LiveMatch({ matchId, onBack }) {
  const [match, setMatch] = useState(() => getMatch(matchId))
  const [showHistory, setShowHistory] = useState(false)
  const knownPlayers = getKnownPlayers()

  function name(id) {
    return knownPlayers.find((p) => p.id === id)?.name ?? '?'
  }

  function refresh() {
    setMatch(getMatch(matchId))
  }

  function logRally(actingPlayerId, outcome, zone) {
    addRallyEvent(matchId, { actingPlayerId, outcome, zone })
    refresh()
  }

  function logThirdShot(playerId, shotType, success) {
    addThirdShotEvent(matchId, { playerId, shotType, success })
    refresh()
  }

  function handleUndo() {
    undoLastEvent(matchId)
    refresh()
  }

  function handleEndEarly() {
    if (!confirm('End this match now? Final score will be locked in as-is.')) return
    endMatchManually(matchId)
    refresh()
  }

  const derived = deriveMatchState(match)
  const players = [...match.teamA, ...match.teamB]
  const serverId =
    match.status === 'in_progress' ? currentServerPlayerId(derived, match) : null
  const servingTeamPlayers = derived.servingTeam === 'A' ? match.teamA : match.teamB
  const history = [...match.events].reverse()

  return (
    <div className="live-match">
      <button className="back-link" onClick={onBack}>
        &larr; Back
      </button>

      <div className="scoreboard">
        <div className={`score-side ${derived.servingTeam === 'A' ? 'serving' : ''}`}>
          <span className="score-names">{match.teamA.map(name).join(' / ')}</span>
          <span className="score-value">{derived.score.A}</span>
        </div>
        <div className="score-sep">&ndash;</div>
        <div className={`score-side ${derived.servingTeam === 'B' ? 'serving' : ''}`}>
          <span className="score-value">{derived.score.B}</span>
          <span className="score-names">{match.teamB.map(name).join(' / ')}</span>
        </div>
      </div>

      {match.status === 'in_progress' && (
        <p className="serve-note">
          Serving: {name(serverId)}
          {derived.isDoubles ? ` (server ${derived.serverNumber})` : ''}
        </p>
      )}

      {match.status === 'completed' && (
        <p className="match-complete">
          {match.winner
            ? `${match.winner === 'A' ? match.teamA.map(name).join(' / ') : match.teamB.map(name).join(' / ')} won`
            : 'Match ended'}
        </p>
      )}

      {match.status === 'in_progress' && (
        <>
          <div className="quick-controls">
            <button
              className="undo"
              onClick={handleUndo}
              disabled={match.events.length === 0}
            >
              Undo last
            </button>
            <button className="end-early" onClick={handleEndEarly}>
              End match early
            </button>
          </div>

          <section className="rally-log">
            <div className="rally-grid">
              {players.map((id) => (
                <div className="player-panel" key={id}>
                  <div className="player-panel-name">{name(id)}</div>
                  <div className="player-panel-outcomes">
                    {OUTCOMES.map(({ outcome, zone, label }) => (
                      <button
                        key={label}
                        className={`outcome-btn ${outcome}`}
                        onClick={() => logRally(id, outcome, zone)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Only the serving team ever hits the 3rd shot of a rally. */}
          <section className="third-shot-log">
            <h3>3rd shot (optional)</h3>
            <div className="rally-grid">
              {servingTeamPlayers.map((id) => (
                <div className="player-panel" key={id}>
                  <div className="player-panel-name">{name(id)}</div>
                  <div className="player-panel-outcomes third-shot-outcomes">
                    <button
                      className="outcome-btn winner"
                      onClick={() => logThirdShot(id, 'drop', true)}
                    >
                      Drop &#10003;
                    </button>
                    <button
                      className="outcome-btn error"
                      onClick={() => logThirdShot(id, 'drop', false)}
                    >
                      Drop &#10007;
                    </button>
                    <button
                      className="outcome-btn neutral"
                      onClick={() => logThirdShot(id, 'drive', null)}
                    >
                      Drive
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {match.status === 'completed' && (
        <section className="match-summary">
          <h3>Final stats</h3>
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>Winners</th>
                <th>Dink W</th>
                <th>Errors</th>
                <th>Dink E</th>
                <th>Drops</th>
                <th>Drives</th>
              </tr>
            </thead>
            <tbody>
              {players.map((id) => {
                const s = derived.stats[id]
                return (
                  <tr key={id}>
                    <td>{name(id)}</td>
                    <td>{s.clean_winners}</td>
                    <td>{s.dink_winners}</td>
                    <td>{s.unforced_errors}</td>
                    <td>{s.dink_errors}</td>
                    <td>
                      {s.drop_successes}/{s.drop_attempts}
                    </td>
                    <td>{s.drive_attempts}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      <section className="history">
        <button className="collapsible-toggle" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? '▾' : '▸'} History ({history.length})
        </button>
        {showHistory && (
          <ul className="history-list">
            {history.map((event) => (
              <li key={event.id}>{describeEvent(event, name)}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default LiveMatch
