import { useState } from 'react'
import { getSession, getKnownPlayers, createMatch } from '../lib/storage'

// Configures a new match before handing off to LiveMatch: singles vs
// doubles, both teams' rosters (drawn from the session's players),
// each doubles team's stacking flag, and who serves first. All of
// this becomes createMatch()'s input, so a match can't be started
// until it's unambiguous who's on court and who serves -- see
// `readyToStart`.
function MatchSetup({ sessionId, onBack, onStart }) {
  const session = getSession(sessionId)
  const knownPlayers = getKnownPlayers()
  const roster = session.playerIds
    .map((id) => knownPlayers.find((p) => p.id === id))
    .filter(Boolean)

  const [isDoubles, setIsDoubles] = useState(false)
  const [teamA, setTeamA] = useState([])
  const [teamB, setTeamB] = useState([])
  const [stackingA, setStackingA] = useState(false)
  const [stackingB, setStackingB] = useState(false)
  const [firstServerId, setFirstServerId] = useState('')

  const maxPerTeam = isDoubles ? 2 : 1
  const assigned = new Set([...teamA, ...teamB])
  const available = roster.filter((p) => !assigned.has(p.id))

  function toggleFormat(doubles) {
    setIsDoubles(doubles)
    setTeamA([])
    setTeamB([])
    setFirstServerId('')
  }

  function addToTeam(team, playerId) {
    const [list, setList] = team === 'A' ? [teamA, setTeamA] : [teamB, setTeamB]
    if (list.length >= maxPerTeam) return
    setList([...list, playerId])
  }

  function removeFromTeam(team, playerId) {
    const setList = team === 'A' ? setTeamA : setTeamB
    setList((current) => current.filter((id) => id !== playerId))
    if (firstServerId === playerId) setFirstServerId('')
  }

  const readyToStart =
    teamA.length === maxPerTeam &&
    teamB.length === maxPerTeam &&
    firstServerId !== ''

  function handleStart() {
    if (!readyToStart) return
    const firstServerTeam = teamA.includes(firstServerId) ? 'A' : 'B'
    const match = createMatch({
      sessionId,
      teamA,
      teamB,
      stacking: { A: isDoubles && stackingA, B: isDoubles && stackingB },
      firstServer: { team: firstServerTeam, playerId: firstServerId },
    })
    onStart(match.id)
  }

  function playerName(id) {
    return roster.find((p) => p.id === id)?.name ?? '?'
  }

  return (
    <div className="match-setup">
      <button className="back-link" onClick={onBack}>
        &larr; {session.name}
      </button>
      <h2>New Match</h2>

      <section>
        <h3>Format</h3>
        <div className="format-toggle">
          <button
            className={!isDoubles ? 'active' : ''}
            onClick={() => toggleFormat(false)}
          >
            Singles
          </button>
          <button
            className={isDoubles ? 'active' : ''}
            onClick={() => toggleFormat(true)}
          >
            Doubles
          </button>
        </div>
      </section>

      <section>
        <h3>Team A {isDoubles && stackingA ? '· stacking' : ''}</h3>
        <TeamPicker
          team={teamA}
          maxPerTeam={maxPerTeam}
          playerName={playerName}
          onRemove={(id) => removeFromTeam('A', id)}
          onAdd={(id) => addToTeam('A', id)}
          available={available}
        />
        {isDoubles && (
          <label className="stacking-toggle">
            <input
              type="checkbox"
              checked={stackingA}
              onChange={(e) => setStackingA(e.target.checked)}
            />
            Uses stacking
          </label>
        )}
      </section>

      <section>
        <h3>Team B {isDoubles && stackingB ? '· stacking' : ''}</h3>
        <TeamPicker
          team={teamB}
          maxPerTeam={maxPerTeam}
          playerName={playerName}
          onRemove={(id) => removeFromTeam('B', id)}
          onAdd={(id) => addToTeam('B', id)}
          available={available}
        />
        {isDoubles && (
          <label className="stacking-toggle">
            <input
              type="checkbox"
              checked={stackingB}
              onChange={(e) => setStackingB(e.target.checked)}
            />
            Uses stacking
          </label>
        )}
      </section>

      {teamA.length === maxPerTeam && teamB.length === maxPerTeam && (
        <section>
          <h3>First server</h3>
          <div className="server-choice">
            {[...teamA, ...teamB].map((id) => (
              <button
                key={id}
                className={firstServerId === id ? 'active' : ''}
                onClick={() => setFirstServerId(id)}
              >
                {playerName(id)}
              </button>
            ))}
          </div>
        </section>
      )}

      <button
        className="start-match"
        disabled={!readyToStart}
        onClick={handleStart}
      >
        Start Match
      </button>
    </div>
  )
}

// One team's slot list (1 or 2 players) plus the remaining roster to
// fill open slots from. `available` is shared/filtered by the parent
// so a player picked for Team A can't also be picked for Team B.
function TeamPicker({ team, maxPerTeam, playerName, onRemove, onAdd, available }) {
  return (
    <div className="team-picker">
      <ul className="team-slots">
        {team.map((id) => (
          <li key={id}>
            {playerName(id)}
            <button className="remove" onClick={() => onRemove(id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {team.length < maxPerTeam && available.length > 0 && (
        <div className="known-players">
          <ul>
            {available.map((p) => (
              <li key={p.id}>
                <button onClick={() => onAdd(p.id)}>{p.name}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default MatchSetup
