// ============================================================
// The landing screen: how am I doing lately?
//
// The board at the top answers it; below it, only what nothing else
// shows in the same way -- the rating in one line, the last night you
// played, your form and your best. Anything another screen explains in
// full is a line here that links to it, rather than a second copy.
// ============================================================

import { useEffect, useState } from 'react'
import { Link } from '../lib/router'
import { usePlayerData } from '../lib/PlayerData'
import { fetchLeaderboard } from '../lib/api'
import { personalBests, rollingWinRate } from '../lib/derive'
import { groupMatches } from '../lib/nights'
import Hero from '../components/Hero'
import StatGrid from '../components/StatGrid'
import PersonalBests from '../components/PersonalBests'
import TrendChart from '../components/TrendChart'
import RallyRating from '../components/RallyRating'
import LiveNote from '../components/LiveNote'
import { NightBlock } from '../components/MatchList'
import { SetupStrip } from '../components/SetupSignIn'

const TREND_WINDOW = 5

/**
 * The reader's Leaderboard place, only while the Leaderboard is open. One
 * request, made only then; a slow or failed one just leaves the place off.
 */
function useLeaderboardPlace(open) {
  const [place, setPlace] = useState(null)
  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    fetchLeaderboard({ signal: controller.signal })
      .then((board) => {
        setPlace(board.open && board.you?.state === 'on' ? { place: board.you.place, of: board.you.of } : null)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [open])
  return open ? place : null
}

function LastNight({ matches }) {
  const night = groupMatches(matches)[0]?.nights?.[0]
  if (!night) return null
  return (
    <section className="recent" aria-label="Your last night">
      <div className="section-head">
        <h2>Your last night</h2>
        <Link className="link" to="/matches">All {matches.length} matches &rarr;</Link>
      </div>
      <NightBlock night={night} />
    </section>
  )
}

function Overview({ player }) {
  const { summary, matches, inProgress, rallyRating, leaderboardOpen } = usePlayerData()
  const trend = rollingWinRate(matches, TREND_WINDOW)
  const bests = personalBests(matches)
  const place = useLeaderboardPlace(leaderboardOpen)

  return (
    <div className="overview">
      <Hero player={player} summary={summary} matches={matches}>
        <StatGrid summary={summary} />
      </Hero>

      {inProgress > 0 && <LiveNote count={inProgress} />}

      <SetupStrip player={player} />

      <RallyRating rallyRating={rallyRating} place={place} />

      <LastNight matches={matches} />

      {trend.length >= 2 ? (
        <TrendChart points={trend} window={TREND_WINDOW} />
      ) : (
        // Said plainly rather than drawn from too little data. A line
        // through three matches is three coin flips.
        <section className="trend trend-early" aria-label="Recent form">
          <h2>Form</h2>
          <p className="muted-inline">
            Your form line appears once you&rsquo;ve played {TREND_WINDOW + 1} matches.
          </p>
        </section>
      )}

      {bests.length > 0 && <PersonalBests bests={bests} />}
    </div>
  )
}

export default Overview
