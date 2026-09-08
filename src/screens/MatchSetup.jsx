import { useState } from 'react'
import { DEFAULT_POINT_TARGET, POINT_TARGETS } from '../lib/pickleball'
import { createMatch } from '../lib/storage'
import { useSession, usePlayers } from '../lib/useLocalStore'
import NotFound from './NotFound'

// Configures a new match before handing off to LiveMatch: singles vs
// doubles, both teams' rosters (drawn from the session's players),
// each doubles team's stacking flag, who serves first, and how many
// points the game is played to. All of this becomes createMatch()'s
// input, so a match can't be started until it's unambiguous who's on
// court and who serves -- see `readyToStart`.
//
// The point target must be settled BEFORE the first rally, not after:
// the winner is re-derived from the event log every time it syncs, so
// changing the target mid-match would retroactively rewrite when the
// game ended.
function MatchSetup({ sessionId, onBack, onStart }) {
  const session = useSession(sessionId)
  const knownPlayers = usePlayers()

  const [isDoubles, setIsDoubles] = useState(false)
  const [teamA, setTeamA] = useState([])
  const [teamB, setTeamB] = useState([])
  const [stackingA, setStackingA] = useState(false)
  const [stackingB, setStackingB] = useState(false)
  const [firstServerId, setFirstServerId] = useState('')
  // Who starts on the RIGHT for the pair that does NOT serve first.
  // The serving pair needs no question: by rule the first server is on
  // the right at 0-0. Without this the app cannot know who serves when
  // the ball first goes over, because team order is only the order
  // names were tapped in.
  const [receiverRightId, setReceiverRightId] = useState('')
  // 11 is the common case, so it stays the default and an umpire who
  // never touches this control gets the same behaviour as before.
  const [pointTarget, setPointTarget] = useState(DEFAULT_POINT_TARGET)

  // Every hook above must run before this bails out -- returning early
  // ahead of a useState would make the hook order conditional, which
  // React forbids. That is also why `roster` moved below the guard
  // rather than staying where it dereferenced session.playerIds
  // unguarded.
  if (!session) return <NotFound what="session" onBack={onBack} />

  const roster = session.playerIds
    .map((id) => knownPlayers.find((p) => p.id === id))
    .filter(Boolean)

  const maxPerTeam = isDoubles ? 2 : 1
  const assigned = new Set([...teamA, ...teamB])
  const available = roster.filter((p) => !assigned.has(p.id))

  function toggleFormat(doubles) {
    setIsDoubles(doubles)
    setTeamA([])
    setTeamB([])
    setFirstServerId('')
    setReceiverRightId('')
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
    if (receiverRightId === playerId) setReceiverRightId('')
  }

  const firstServerTeam = teamA.includes(firstServerId) ? 'A' : 'B'
  const receivingTeam = firstServerTeam === 'A' ? teamB : teamA

  const readyToStart =
    teamA.length === maxPerTeam &&
    teamB.length === maxPerTeam &&
    firstServerId !== '' &&
    (!isDoubles || receiverRightId !== '')

  function handleStart() {
    if (!readyToStart) return
    const match = createMatch({
      sessionId,
      teamA,
      teamB,
      stacking: { A: isDoubles && stackingA, B: isDoubles && stackingB },
      firstServer: { team: firstServerTeam, playerId: firstServerId },
      // The server's side is not asked for: whoever serves first is on
      // the right at 0-0, by rule.
      rightStart: isDoubles
        ? firstServerTeam === 'A'
          ? { A: firstServerId, B: receiverRightId }
          : { A: receiverRightId, B: firstServerId }
        : null,
      pointTarget,
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
        <h3>Play to</h3>
        <div className="format-toggle">
          {POINT_TARGETS.map((target) => (
            <button
              key={target}
              className={pointTarget === target ? 'active' : ''}
              onClick={() => setPointTarget(target)}
            >
              {target}
            </button>
          ))}
        </div>
        <p className="setup-note">
          Win by 2 whichever you pick, and it can&rsquo;t be changed once
          the match starts.
        </p>
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
                onClick={() => {
                  setFirstServerId(id)
                  // A different team now receives, so a right-side
                  // choice made for the old receiving pair is about the
                  // wrong pair. Re-tapping the same name changes
                  // nothing and must not throw the answer away.
                  if (id !== firstServerId) setReceiverRightId('')
                }}
              >
                {playerName(id)}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* The one thing the app cannot work out for itself. When the
          serve goes over, the player on the RIGHT serves -- and since a
          pair only swaps sides when it scores, everything after that
          follows from where these two started. */}
      {isDoubles && firstServerId !== '' && (
        <section>
          <h3>Who starts on the right?</h3>
          <p className="setup-note">
            {playerName(firstServerId)} does, on the serving side. Say which
            of the other pair is on the right as the ball is served to them.
          </p>
          <div className="server-choice">
            {receivingTeam.map((id) => (
              <button
                key={id}
                className={receiverRightId === id ? 'active' : ''}
                onClick={() => setReceiverRightId(id)}
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
