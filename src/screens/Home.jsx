import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { sessionName } from '../lib/sessionName'
import { createSession, dismissCourtNotice } from '../lib/storage'
import { answerScorekeeping } from '../lib/api'
import { getDeviceId } from '../lib/outbox'
import * as sync from '../lib/sync'
import { useScorekeeping } from '../lib/scorekeeping'
import { hoursWords, startableCourts, useTodayCourts } from '../lib/courts'
import { useCourtNotices, useSessions } from '../lib/useLocalStore'

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
              <Icon name="people" size={16} />
              {s.playerCount ?? s.playerIds.length} players
              {showOwner && s.createdByName ? ` \u00b7 by ${s.createdByName}` : ''}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function Home({ onOpenSession, onOpenMatch, onOpenGuide, onOpenPlayers, onOpenCamera, umpire }) {
  // Subscribed rather than read during render: previously this never
  // updated after a write, and only looked correct because navigating
  // away unmounted the screen.
  const sessions = useSessions()
  const notices = useCourtNotices()
  const openPlays = useTodayCourts()
  const [asked, refreshAsked] = useScorekeeping()
  const [busy, setBusy] = useState(null)
  const [failed, setFailed] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // The name preview follows the clock; half a minute is fine-grained enough.
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  const courts = startableCourts(openPlays, sessions, now)

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

  // The ask was withdrawn or given to someone else (409/403): say so and drop the card.
  function fail(m, error) {
    const withdrawn = error.status === 409 || error.status === 403
    setFailed({ id: m.id, text: withdrawn ? 'Request withdrawn' : 'Needs a connection' })
    if (withdrawn) refreshAsked()
  }

  async function startScoring(m) {
    setBusy(m.id)
    setFailed(null)
    try {
      if (m.state === 'asked') await answerScorekeeping(m.id, { deviceId: getDeviceId(), start: true })
      // The match and its players are the other umpire's: fetch both before opening it.
      await Promise.all([sync.pullMatch(m.id), sync.pullSession(m.sessionId)])
      onOpenMatch(m.id, m.sessionId)
    } catch (error) {
      fail(m, error)
    } finally {
      setBusy(null)
    }
  }

  async function notNow(m) {
    setBusy(m.id)
    setFailed(null)
    try {
      await answerScorekeeping(m.id, { deviceId: getDeviceId(), start: false })
      await refreshAsked() // the card goes now, not at the next poll
    } catch (error) {
      fail(m, error)
    }
    setBusy(null)
  }

  function startCourt(card) {
    const session = createSession({ startsAt: Date.parse(card.startsAt), openPlayId: card.openPlayId, court: card.court })
    onOpenSession(session.id)
  }

  function startPlain() {
    const session = createSession({ startsAt: Date.now() })
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
            <strong>New here?</strong>
            <p>A two-minute guide to the buttons.</p>
          </div>
          <div className="guide-nudge-actions">
            <button className="guide-nudge-open" onClick={onOpenGuide}>
              <Icon name="book" size={18} />
              How this works
            </button>
            <button
              className="guide-nudge-close"
              onClick={dismissGuideNudge}
              aria-label="Dismiss"
            >
              <Icon name="x" size={18} className="icon-solo" />
            </button>
          </div>
        </div>
      )}

      {Object.entries(notices).map(([sessionId, text]) => (
        <div className="court-notice" role="status" key={sessionId}>
          <Icon name="alert" size={18} />
          <span>{text}</span>
          <button onClick={() => dismissCourtNotice(sessionId)} aria-label="Dismiss">
            <Icon name="x" size={18} className="icon-solo" />
          </button>
        </div>
      ))}

      {asked.map((m) => (
        <section key={m.id} className="scorekeeper-card" aria-label="Score a match">
          <strong><Icon name="people" size={18} />{m.state === 'scoring' ? 'Scoring for' : 'Score for'} {m.umpireName?.split(' ')[0]}</strong>
          <span className="court-card-hours">{m.court ? `Court ${m.court}` : m.sessionName}</span>
          <div className="overview-actions">
            <button onClick={() => startScoring(m)} disabled={busy === m.id}><Icon name="play" size={18} />{m.state === 'scoring' ? 'Continue' : 'Start'}</button>
            {m.state === 'asked' && <button className="btn-quiet" onClick={() => notNow(m)} disabled={busy === m.id}><Icon name="x" size={18} />Not now</button>}
          </div>
          {failed?.id === m.id && <p className="form-error" role="alert">{failed.text}</p>}
        </section>
      ))}

      {/* Courts first: on an open play night the umpire's own court is the one thing to tap. */}
      {courts.length > 0 && (
        <section className="today-courts" aria-labelledby="today-courts-title">
          <h2 id="today-courts-title">Today’s courts</h2>
          <ul className="court-cards">
            {courts.map((card) => (
              <li key={`${card.openPlayId}:${card.court}`} className={`court-card${card.mine ? ' is-mine' : ''}`}>
                <div className="court-card-top">
                  <strong><Icon name="court" size={18} />Court {card.court}</strong>
                  <span className={`court-chip ${card.mine ? 'is-mine' : 'is-open'}`}>{card.mine ? 'yours' : 'open'}</span>
                </div>
                <span className="court-card-hours">Open play · {hoursWords(card.startsAt, card.endsAt)}</span>
                <button onClick={() => startCourt(card)} aria-label={`Start Court ${card.court}`}><Icon name="play" />Start</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="new-session" aria-labelledby="new-session-title">
        <h2 id="new-session-title">New session</h2>
        <p className="new-session-name">{sessionName({ startsAt: now })}</p>
        <button onClick={startPlain} aria-label="Start a new session"><Icon name="plus" />Start</button>
      </section>

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
                <span><Icon name="qr" />Players &amp; codes</span>
                <span className="tool-note">Show a player their sign-in code</span>
              </button>
            </li>
            {/* Only where the facility films its matches; sign-in says so. */}
            {umpire?.camera && onOpenCamera && (
              <li>
                <button className="export-btn" onClick={onOpenCamera}>
                  <span><Icon name="camera" />Camera</span>
                  <span className="tool-note">Film matches with this phone</span>
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}

export default Home
