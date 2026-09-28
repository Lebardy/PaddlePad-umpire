// ============================================================
// The Leaderboard tab: your place and the PPR ranking, then this month.
// Only reachable once the leaderboard is open (see App.jsx).
// ============================================================

import { useEffect, useState } from 'react'
import { fetchLeaderboard } from '../lib/api'
import { navigate } from '../lib/router'
import { usePlayerData } from '../lib/PlayerData'
import RankPanel from '../components/RankPanel'
import MonthLists from '../components/MonthLists'
import ErrorState from '../components/ErrorState'

function Leaderboard() {
  const { refresh } = usePlayerData()
  const [board, setBoard] = useState(null)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchLeaderboard({ signal: controller.signal })
      .then((next) => {
        // Closed since the app loaded (a player left the ranking): home,
        // replacing this entry so Back can't land on this page and
        // re-fetch into the same bounce, and refreshing the shared
        // player data so the tab bar drops the Leaderboard tab too.
        if (!next.open) {
          navigate('/', { replace: true })
          refresh()
        } else {
          setBoard(next)
        }
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err.message)
      })
    return () => controller.abort()
  }, [attempt, refresh])

  return (
    <div className="leaderboard-screen">
      <h1>Leaderboard</h1>
      {error && (
        <ErrorState
          message={error}
          onRetry={() => {
            setError(null)
            setAttempt((a) => a + 1)
          }}
        />
      )}
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
