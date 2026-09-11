import { useEffect, useState } from 'react'
import { searchPlayers } from '../lib/api'
import PlayerCodeCard from '../components/PlayerCodeCard'

// ============================================================
// The club roster, and the only other place a claim code is shown.
//
// Until now a code could be reached from exactly one screen: the roster
// inside a session, next to a player already added to it. That was fine
// while claiming was something you did courtside with the person in
// front of you, and useless for everything else -- a player who asks
// for their code a week later, someone who has never been added to a
// session, or an umpire trying to help a player who lost theirs. The
// answer was "add them to a session first", which writes a row to make
// a lookup possible.
//
// So this is a search over the same club-wide registry the player
// picker searches, with the code card the session roster already uses.
// No new endpoint and no new way to see a code: GET /players has never
// returned claim_code and still does not, and the code itself still
// comes one player at a time from GET /players/:id/claim-code.
//
// Deliberately search-first rather than a listed roster. The registry
// is club-wide and grows without limit, the server caps a response at
// 50 rows, and a screen that quietly showed the first 50 of 200 players
// would be worse than one that asks who you are looking for.
//
// So an empty box lists nothing and asks the server nothing -- only
// what was typed comes back. What keeps that from reading as a dead end
// is the line where the list would be, saying to type a name.
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

function Players({ onBack }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showing, setShowing] = useState(null)

  const trimmed = query.trim()

  // What is actually on screen, derived rather than stored: an empty
  // box shows nothing at all, whatever the last search left behind.
  // Emptying state from inside the effect would work too, but only
  // after another render -- this way the list goes on the keystroke.
  const shown = trimmed ? results : []
  const searching = Boolean(trimmed) && loading
  const shownError = trimmed ? error : null

  useEffect(() => {
    // Nothing typed, nothing asked of the server.
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
        // No offline fallback here, unlike the player picker. That one
        // falls back to this device's synced players so a roster can
        // still be built courtside with no signal; a code cannot be
        // shown offline at all, because fetching it is a server call.
        // Pretending to have a roster we could not act on would be
        // worse than saying so.
        setError(
          err.status === 0
            ? 'Codes need a connection — they come from the server.'
            : err.message,
        )
        setResults([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  return (
    <div className="players-screen">
      <button className="back-link" onClick={onBack}>
        &larr; Back
      </button>
      <h2>Players</h2>
      <p className="login-note">
        Search everyone PaddlePad has ever recorded. Open one to show the
        code that lets them see their own matches.
      </p>

      <input
        className="player-search"
        type="search"
        placeholder="Search by name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoCapitalize="words"
        autoCorrect="off"
      />

      {shownError && <p className="form-error">{shownError}</p>}

      {showing && (
        <PlayerCodeCard player={showing} onClose={() => setShowing(null)} />
      )}

      {/* Only while there is nothing to show. Replacing a list that is
          already on screen with "Searching…" on every keystroke makes
          the screen flicker and reads as slower than it is. */}
      {searching && shown.length === 0 && !shownError && (
        <p className="empty">Searching…</p>
      )}

      {!searching && !shownError && shown.length === 0 && (
        <p className="empty">
          {trimmed
            ? `Nobody matching “${trimmed}”.`
            : 'Type a name to find someone.'}
        </p>
      )}

      <ul className="session-list">
        {shown.map((p) => (
          <li key={p.id}>
            <button className="session-item" onClick={() => setShowing(p)}>
              <span className="session-name">
                {p.name}
                {/* Worth showing, because it answers the question an
                    umpire is usually about to ask: have they got in
                    yet? Someone unclaimed is who this screen is for. */}
                {p.claimed && <span className="ended-tag">claimed</span>}
              </span>
              <span className="session-meta">{describePlayer(p)}</span>
            </button>
          </li>
        ))}
      </ul>

    </div>
  )
}

export default Players
