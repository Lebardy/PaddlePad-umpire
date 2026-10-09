import { useState } from 'react'
import { createSession } from '../lib/storage'
import { useSessions } from '../lib/useLocalStore'

// Landing screen: create and open sessions.
const GUIDE_NUDGE_KEY = 'paddlepad.umpire.guideDismissed'

/** One group of sessions. `showOwner` names whose they are. */
function SessionList({ sessions, onOpenSession, showOwner = false }) {
  if (sessions.length === 0) return null
  return (
    <ul className="session-list">
      {sessions.map((s) => (
        <li key={s.id}>
          <button className="session-item" onClick={() => onOpenSession(s.id)}>
            <span className="session-name">
              {s.name}
              {s.voidedAt && <span className="voided-tag">voided</span>}
              {s.endedAt && !s.voidedAt && (
                <span className="ended-tag">ended</span>
              )}
            </span>
            <span className="session-meta">
              {/* The server's count where this device has no roster yet. */}
              {s.playerCount ?? s.playerIds.length} players
              {showOwner && s.createdByName ? ` \u00b7 by ${s.createdByName}` : ''}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Home({ onOpenSession, onOpenGuide, onOpenPlayers, umpire }) {
  // Subscribed rather than read during render: previously this never
  // updated after a write, and only looked correct because navigating
  // away unmounted the screen.
  const sessions = useSessions()
  const [name, setName] = useState('')

  // Persisted, so it does not reappear on every launch. Read through a
  // try/catch because private mode throws on localStorage, and a nudge
  // is never worth failing a screen over.
  const [guideDismissed, setGuideDismissed] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_NUDGE_KEY) === '1'
    } catch {
      return false
    }
  })

  function dismissGuideNudge() {
    setGuideDismissed(true)
    try {
      localStorage.setItem(GUIDE_NUDGE_KEY, '1')
    } catch {
      // It will ask once more next launch. Harmless.
    }
  }

  function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    const session = createSession(name)
    setName('')
    onOpenSession(session.id)
  }

  // A session with no createdBy has been made on this device and not yet
  // reached the server, so it is definitionally this umpire's. Grouped
  // by id rather than name, because two umpires can share a name.
  const isMine = (s) => !s.createdBy || s.createdBy === umpire?.id
  const mine = sessions.filter(isMine)
  const theirs = sessions.filter(
    (s) => !isMine(s) && !s.endedAt && !s.voidedAt,
  )

  return (
    <div className="home">
      {/* Shown until it is waved away, and only then. The guide itself
          never goes anywhere -- the ? in the header opens it whenever
          they want it -- so dismissing this costs nothing. */}
      {onOpenGuide && !guideDismissed && (
        <div className="guide-nudge">
          <div>
            <strong>New to this?</strong>
            <p>Two minutes on what the buttons record and how a night runs.</p>
          </div>
          <div className="guide-nudge-actions">
            <button className="guide-nudge-open" onClick={onOpenGuide}>
              How this works
            </button>
            <button
              className="guide-nudge-close"
              onClick={dismissGuideNudge}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <form className="new-session-form" onSubmit={handleCreate}>
        <label htmlFor="new-session-name">Start a session</label>
        <div className="new-session-row">
          <input
            id="new-session-name"
            type="text"
            placeholder="e.g. Saturday League — Court 3"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit">New Session</button>
        </div>
      </form>

      <h2>Your sessions</h2>
      {mine.length === 0 && <p className="empty">No sessions yet.</p>}
      <SessionList sessions={mine} onOpenSession={onOpenSession} />

      {/* Every umpire account sees all the records -- that is
          deliberate, because courts and phones change hands mid-session
          and players must resolve to one identity whoever scored them.
          What was missing was any way to tell whose was whose, so a
          session someone else started looked like it had appeared from
          nowhere. Only the ones still running are listed: a finished
          night is theirs to look back on, not yours to wade through. */}
      {theirs.length > 0 && (
        <>
          <h2>Still running, other umpires</h2>
          <SessionList sessions={theirs} onOpenSession={onOpenSession} showOwner />
        </>
      )}

      {/* A player asking for their code is a Tuesday, and it should not
          require building a session around them first, which is what it
          used to. */}
      {onOpenPlayers && (
        <>
          <h2>Tools</h2>
          <ul className="tool-list">
            <li>
              <button className="export-btn" onClick={onOpenPlayers}>
                <span>Players &amp; codes</span>
                <span className="tool-note">Show a player their sign-in code</span>
              </button>
            </li>
          </ul>
        </>
      )}
    </div>
  )
}

export default Home
