import { useState } from 'react'
import { deadLetter, pending } from '../lib/outbox'
import { describeRefused } from '../lib/refused'
import { getKnownPlayers, getMatch, getSession } from '../lib/storage'
import { discardDead, retryDead } from '../lib/sync'
import { useSyncStatus } from '../lib/useSyncStatus'

// ============================================================
// What the server refused, and what to do about each one.
//
// Opened from the red "couldn't sync" pill in the header. An upload
// lands here only when the server answers that it will never accept it
// (see runDrain in lib/sync.js); a lost connection never does, because
// that is retried without anyone being asked.
//
// The umpire has two choices per line and the app makes neither for
// them: send it again, or dismiss it knowing it stays off the server.
// ============================================================

const find = {
  session: getSession,
  match: getMatch,
  playerName: (id) => getKnownPlayers().find((p) => p.id === id)?.name ?? null,
}

function refusedAt(time) {
  return new Date(time).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function CouldntSync({ onBack }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  // Re-renders this list whenever the queue changes.
  useSyncStatus()
  // Oldest first, because a later change often depends on an earlier
  // one: a match cannot go up before its session has.
  const firstRefused = (entry) => entry.refusedFirst ?? entry.diedAt
  const refused = [...deadLetter()].sort((a, b) => firstRefused(a) - firstRefused(b))

  async function tryAgain(key) {
    setBusy(true)
    setNote(null)
    try {
      await retryDead(key)
    } finally {
      setBusy(false)
    }
    if (deadLetter().some((entry) => entry.key === key)) {
      setNote('The server refused it again.')
    } else if (pending().some((entry) => entry.key === key)) {
      setNote('Not sent yet. It will go up when the server can be reached.')
    } else {
      setNote('Sent.')
    }
  }

  function dismiss(key) {
    if (
      !window.confirm(
        'Dismiss this change? It will not be sent to the server, and the ' +
          "server's copy is the one everyone else sees.",
      )
    ) {
      return
    }
    discardDead(key)
    setNote(null)
  }

  return (
    <div className="couldnt-sync">
      <button className="back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h2>Couldn&rsquo;t sync</h2>
      {refused.length > 0 && (
        <p className="login-note">
          The server refused these changes, so they are on this device only.
          Try one again once its cause is fixed, starting from the top, or
          dismiss it to let it go.
        </p>
      )}

      <p className="couldnt-sync-note" role="status">{note}</p>

      {refused.length === 0 && (
        <p className="empty">Nothing here. Every change the server refused has been dealt with.</p>
      )}

      {refused.map((entry) => (
        <div className="takeover" key={entry.key}>
          <p className="takeover-text">
            <strong>{describeRefused(entry, find)}</strong>
            <br />
            The server said: {entry.error}
            <br />
            Refused {refusedAt(entry.diedAt)}
          </p>
          <div className="dupe-actions">
            <button className="dupe-yes" onClick={() => tryAgain(entry.key)} disabled={busy}>
              Try again
            </button>
            <button className="dupe-no" onClick={() => dismiss(entry.key)} disabled={busy}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default CouldntSync
