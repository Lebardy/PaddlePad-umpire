import { useState } from 'react'
import { createSession } from '../lib/storage'
import { fetchExportCsv } from '../lib/api'
import { useSessions } from '../lib/useLocalStore'

// Landing screen: create/open sessions, and export the whole app's
// match history as the CSV the separate PaddlePad ML pipeline
// consumes (export is global, not per-session, since the ML pipeline
// aggregates a player's stats across every match they've ever played).
const GUIDE_NUDGE_KEY = 'paddlepad.umpire.guideDismissed'

function Home({ onOpenSession, onOpenInvites, onOpenGuide }) {
  // Subscribed rather than read during render: previously this never
  // updated after a write, and only looked correct because navigating
  // away unmounted the screen.
  const sessions = useSessions()
  const [name, setName] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)

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

  // Downloads the ML pipeline CSV.
  //
  // This now comes from the server rather than being built here, which
  // is the whole point of moving data off the device: a locally-built
  // export could only ever contain matches THIS phone recorded, so the
  // pipeline would silently receive one umpire's slice of the club's
  // data no matter how many matches everyone else logged.
  //
  // The download is triggered after an await. That is fine for a
  // programmatic anchor -- unlike popups, blob downloads are not gated
  // on an unbroken user gesture -- but it is the reason for the
  // "Preparing..." state rather than an instant response.
  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      const csv = await fetchExportCsv()
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `paddlepad_match_logs_${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(
        err.status === 0
          ? 'The export needs a connection — it gathers every umpire\u2019s matches from the server.'
          : err.message,
      )
    } finally {
      setExporting(false)
    }
  }

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
        <input
          type="text"
          placeholder="e.g. Saturday League — Court 3"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit">New Session</button>
      </form>

      <h2>Sessions</h2>
      {sessions.length === 0 && <p className="empty">No sessions yet.</p>}
      <ul className="session-list">
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              className="session-item"
              onClick={() => onOpenSession(s.id)}
            >
              <span className="session-name">
                {s.name}
                {s.voidedAt && <span className="voided-tag">voided</span>}
              </span>
              <span className="session-meta">{s.playerIds.length} players</span>
            </button>
          </li>
        ))}
      </ul>

      {exportError && <p className="form-error">{exportError}</p>}
      <button className="export-btn" onClick={handleExport} disabled={exporting}>
        {exporting ? 'Preparing…' : 'Export match data (CSV)'}
      </button>
      {onOpenInvites && (
        <button className="export-btn" onClick={onOpenInvites}>
          Invite an umpire
        </button>
      )}
    </div>
  )
}

export default Home
