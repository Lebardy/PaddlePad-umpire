import { useState } from 'react'
import {
  createSession,
  exportRawMatchLogs,
  matchLogsToCSV,
} from '../lib/storage'
import { useSessions } from '../lib/useLocalStore'

// Landing screen: create/open sessions, and export the whole app's
// match history as the CSV the separate PaddlePad ML pipeline
// consumes (export is global, not per-session, since the ML pipeline
// aggregates a player's stats across every match they've ever played).
function Home({ onOpenSession, onOpenInvites }) {
  // Subscribed rather than read during render: previously this never
  // updated after a write, and only looked correct because navigating
  // away unmounted the screen.
  const sessions = useSessions()
  const [name, setName] = useState('')

  function handleCreate(e) {
    e.preventDefault()
    if (!name.trim()) return
    const session = createSession(name)
    setName('')
    onOpenSession(session.id)
  }

  // Downloads every completed match across every session as one CSV,
  // in the exact row shape the PaddlePad ML pipeline's
  // aggregate_player_profiles() expects as input.
  function handleExport() {
    const rows = exportRawMatchLogs()
    const csv = matchLogsToCSV(rows)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'paddlepad_match_logs.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="home">
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
              <span className="session-name">{s.name}</span>
              <span className="session-meta">{s.playerIds.length} players</span>
            </button>
          </li>
        ))}
      </ul>

      <button className="export-btn" onClick={handleExport}>
        Export match data (CSV)
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
