import { useEffect, useState } from 'react'
import { fetchMatches, fetchMe } from '../lib/api'
import MatchList from '../components/MatchList'
import StatGrid from '../components/StatGrid'

/**
 * A player's own page: who they are, how they've done, and every match.
 *
 * Everything shown here is a raw count or a simple ratio taken straight
 * from what the umpire tapped. There is deliberately no skill rating or
 * playstyle label yet: those come from the ML pipeline, which needs many
 * matches across many players before it says anything true, and a number
 * that moved because SOMEONE ELSE played would be worse than no number.
 */
function Profile({ player, onSignOut }) {
  const [summary, setSummary] = useState(null)
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const [me, history] = await Promise.all([
          fetchMe({ signal: controller.signal }),
          fetchMatches({ signal: controller.signal }),
        ])
        if (controller.signal.aborted) return
        setSummary(me.summary)
        setMatches(history)
        setError(null)
      } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setError(err.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    // eslint-disable-next-line react/set-state-in-effect
    load()
    return () => controller.abort()
  }, [])

  return (
    <div className="profile">
      <header className="profile-header">
        <div>
          <p className="eyebrow">Player</p>
          <h1>{player.name}</h1>
        </div>
        <button className="link" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      {loading && <p className="muted">Loading your matches…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && !error && summary?.matches === 0 && (
        <div className="empty-state">
          <h2>No finished matches yet</h2>
          <p>
            Once someone scores a match you played in, it&rsquo;ll show up here
            with your stats.
          </p>
        </div>
      )}

      {!loading && !error && summary?.matches > 0 && (
        <>
          <StatGrid summary={summary} />

          {/* The slot the ML pipeline will fill. Saying so plainly beats
              showing a rating computed from too little data, which would
              swing as other people played and be impossible to trust
              afterwards. */}
          <section className="rating-slot">
            <h2>Skill rating</h2>
            <p>
              Not enough matches across the club yet. A rating needs a lot of
              games from a lot of players before it means anything — until
              then, the numbers above are the real picture.
            </p>
          </section>

          <MatchList matches={matches} />
        </>
      )}
    </div>
  )
}

export default Profile
