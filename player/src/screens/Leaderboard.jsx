// ============================================================
// The Leaderboard tab: your place and the PPR ranking, then this month.
// Only reachable once the leaderboard is open (see App.jsx).
// ============================================================

import { useEffect, useState } from 'react'
import { fetchLeaderboard } from '../lib/api'
import { navigate } from '../lib/router'
import RankPanel from '../components/RankPanel'
import MonthLists from '../components/MonthLists'

function Leaderboard() {
  const [board, setBoard] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchLeaderboard({ signal: controller.signal })
      .then((next) => {
        // Closed since the app loaded (a player left the ranking): home.
        if (!next.open) navigate('/')
        else setBoard(next)
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(true)
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="leaderboard-screen">
      <h1>Leaderboard</h1>
      {error && <p className="muted-inline">Couldn&rsquo;t load the leaderboard.</p>}
      {!error && !board && <p className="muted">Loading…</p>}
      {board && (
        <>
          <RankPanel ranking={board.ranking} you={board.you} />
          <MonthLists month={board.month} />
        </>
      )}
    </div>
  )
}

export default Leaderboard
