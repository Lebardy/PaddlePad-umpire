import { useEffect, useState } from 'react'
import { ApiError, createPlayer, searchPlayers } from '../lib/api'
import { getKnownPlayers } from '../lib/storage'
import { useSyncStatus } from '../lib/useSyncStatus'

// ============================================================
// Adding a player to a session's roster.
//
// This replaces a form that silently reused any existing player whose
// name matched. That was the app's quietest data bug: an umpire typing
// "John Cruz" for a DIFFERENT John Cruz attached a stranger's match to
// the wrong record, nothing errored, and the ML pipeline went on to
// treat two people as one.
//
// So the confirmation is the whole point. When a typed name already
// exists, the umpire is shown that player's match count and when they
// last played, and has to say it's the same person -- at the only
// moment anyone is in a position to know.
// ============================================================

const DEBOUNCE_MS = 250

function describePlayer(player) {
  const matches = player.match_count ?? 0
  const played = matches === 1 ? '1 match' : `${matches} matches`
  if (!player.last_played_at) return matches ? played : 'no matches yet'
  const date = new Date(player.last_played_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
  return `${played} · last played ${date}`
}

function PlayerPicker({ excludeIds = [], onPick }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [duplicate, setDuplicate] = useState(null)

  const { reachable } = useSyncStatus()

  useEffect(() => {
    // Nothing typed, nothing asked -- of the server, or of the offline
    // fallback below, which would otherwise hand back this device's
    // whole roster for an empty query.
    if (!query.trim()) return

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const found = await searchPlayers(query, { signal: controller.signal })
        if (controller.signal.aborted) return
        setResults(found)
        setError(null)
      } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        // Offline: fall back to what this device already knows, so an
        // umpire can still build a roster from players they've synced
        // before. Only creating someone brand new needs a connection.
        // Read straight from storage rather than through a hook: this
        // is a one-off lookup inside an effect, and a subscription
        // would re-run the search every time any player changed.
        const q = query.trim().toLowerCase()
        setResults(
          getKnownPlayers()
            .filter((p) => !q || p.name.toLowerCase().includes(q))
            .map((p) => ({ ...p, match_count: null })),
        )
        setError(err instanceof ApiError && err.status === 0 ? null : err.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const trimmed = query.trim()
  // Derived, not stored: an empty box lists nobody whatever the last
  // search left in state, and it empties on the keystroke rather than
  // after a re-render.
  const visible = trimmed
    ? results.filter((p) => !excludeIds.includes(p.id))
    : []
  const exactExists = results.some(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
  )

  async function handleCreate() {
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const player = await createPlayer(trimmed)
      setQuery('')
      onPick(player)
    } catch (err) {
      // The server returns the existing player alongside the 409, so the
      // "same person?" question can be asked with real evidence rather
      // than just a name.
      if (err instanceof ApiError && err.status === 409 && err.data?.player) {
        setDuplicate(err.data.player)
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  function useExisting() {
    const player = duplicate
    setDuplicate(null)
    setQuery('')
    onPick(player)
  }

  if (duplicate) {
    return (
      <div className="dupe-check">
        <h4>Is this the same person?</h4>
        <p className="dupe-name">{duplicate.name}</p>
        <p className="dupe-meta">{describePlayer(duplicate)}</p>
        <p className="dupe-note">
          Adding their match to the wrong player mixes two people&rsquo;s stats
          together, and nothing will flag it later.
        </p>
        <div className="dupe-actions">
          <button className="dupe-yes" onClick={useExisting}>
            Yes, same person
          </button>
          <button
            className="dupe-no"
            onClick={() => {
              setDuplicate(null)
              setError(
                'Give the new player a name that tells them apart, e.g. add a surname or initial.',
              )
            }}
          >
            No, someone else
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="player-picker">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search or add a player"
        autoCorrect="off"
        spellCheck={false}
      />

      {trimmed && error && <p className="form-error">{error}</p>}

      {trimmed && loading && visible.length === 0 && (
        <p className="empty">Searching…</p>
      )}

      {visible.length > 0 && (
        <ul className="picker-results">
          {visible.map((player) => (
            <li key={player.id}>
              <button onClick={() => { setQuery(''); onPick(player) }}>
                <span className="picker-name">{player.name}</span>
                {player.match_count !== null && (
                  <span className="picker-meta">{describePlayer(player)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {trimmed && !exactExists && (
        reachable ? (
          <button className="picker-create" onClick={handleCreate} disabled={busy}>
            {busy ? 'Adding…' : `Add “${trimmed}” as a new player`}
          </button>
        ) : (
          <p className="picker-offline">
            Adding a new player needs a connection. Everyone already on this
            device still works offline.
          </p>
        )
      )}
    </div>
  )
}

export default PlayerPicker
