import { useEffect } from 'react'
import {
  rememberPlayer,
  addPlayerToSession,
  removePlayerFromSession,
  deleteSession,
  voidSession,
  unvoidSession,
} from '../lib/storage'
import PlayerPicker from '../components/PlayerPicker'
import * as sync from '../lib/sync'
import {
  useSession,
  usePlayers,
  useMatchesForSession,
} from '../lib/useLocalStore'
import NotFound from './NotFound'

// One session's roster management plus its match list. Matches
// themselves are scored on the LiveMatch screen (onOpenMatch/
// onNewMatch hand off there) -- this screen only sets up who's
// eligible to play.
function SessionDetail({ sessionId, onBack, onNewMatch, onOpenMatch }) {
  const session = useSession(sessionId)
  const knownPlayers = usePlayers()
  const matches = useMatchesForSession(sessionId)

  // Pull this session's roster and matches so an umpire sees what
  // OTHER umpires recorded, not just their own device. Failures are
  // swallowed on purpose: offline is normal courtside, and whatever is
  // cached locally stays usable.
  useEffect(() => {
    const controller = new AbortController()
    sync.pullSession(sessionId, { signal: controller.signal }).catch(() => {})
    return () => controller.abort()
  }, [sessionId])

  // The picker has already resolved this to a real server player --
  // either an existing one the umpire confirmed, or a newly created
  // one. All that's left is putting them on this session's roster,
  // which is a local write and so works offline.
  function handlePick(player) {
    rememberPlayer(player)
    addPlayerToSession(sessionId, player.id)
  }

  // Cancels a session created by mistake. Unfinished matches inside go
  // with it; a finished one blocks the delete, because that is real
  // recorded play and should be voided individually instead.
  function handleDeleteSession() {
    if (!confirm(`Cancel "${session.name}"? Any unfinished matches go with it.`)) return
    if (deleteSession(sessionId)) onBack()
  }

  // For a session where real play happened. Deleting would destroy
  // genuine history, so this keeps every record and simply stops the
  // exported data including any of it.
  function handleVoidSession() {
    const reason = prompt(
      `Void "${session.name}"?\n\nEvery match in it stays recorded but is left out of the exported data. You can restore it later.\n\nOptional reason:`,
      '',
    )
    if (reason === null) return
    voidSession(sessionId, reason)
  }

  function handleRemove(playerId) {
    removePlayerFromSession(sessionId, playerId)
  }

  // session.playerIds was dereferenced unguarded here. Harmless while
  // everything was device-local; now a session can exist on the server
  // but not yet on this device.
  if (!session) return <NotFound what="session" onBack={onBack} />

  const finishedCount = matches.filter((m) => m.status === 'completed').length

  const roster = session.playerIds
    .map((id) => knownPlayers.find((p) => p.id === id))
    .filter(Boolean)


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

      <section className="danger-zone">
        {session.voidedAt ? (
          <>
            <p className="voided-note">
              This session is voided — none of its matches appear in the
              exported data.
              {session.voidReason ? ` Reason: ${session.voidReason}` : ''}
            </p>
            <button
              className="cancel-session"
              onClick={() => unvoidSession(sessionId)}
            >
              Restore this session
            </button>
          </>
        ) : finishedCount > 0 ? (
          <>
            <p className="placeholder-note">
              This session has {finishedCount} finished match
              {finishedCount === 1 ? '' : 'es'}, so it can&rsquo;t be deleted —
              that would destroy real recorded play. Voiding keeps everything
              but leaves it out of the exported data.
            </p>
            <button className="cancel-session" onClick={handleVoidSession}>
              Void this session
            </button>
          </>
        ) : (
          <button className="cancel-session" onClick={handleDeleteSession}>
            Cancel this session
          </button>
        )}
      </section>

      <section className="add-player">
        <h3>Add a player</h3>
        <PlayerPicker excludeIds={session.playerIds} onPick={handlePick} />
      </section>
    </div>
  )
}

export default SessionDetail
