// ============================================================
// The landing screen: who you are, how you're doing, what's notable.
//
// Everything here is a raw count or a simple ratio taken straight from
// what the umpire tapped. There is still deliberately no skill rating:
// that comes from the ML pipeline, which needs many matches across many
// players before it says anything true.
//
// The dashed "Skill rating — not enough matches across the club yet"
// box that used to sit here is gone. A panel apologising for a missing
// feature is the single loudest way an app says it is unfinished, and
// this one also pointed at a club concept the app does not have.
// ============================================================

import { Link } from '../lib/router'
import { usePlayerData } from '../lib/PlayerData'
import { personalBests, rollingWinRate } from '../lib/derive'
import Hero from '../components/Hero'
import StatGrid from '../components/StatGrid'
import ShotProfile from '../components/ShotProfile'
import Highlights from '../components/Highlights'
import MatchList from '../components/MatchList'
import PersonalBests from '../components/PersonalBests'
import TrendChart from '../components/TrendChart'
import LiveNote from '../components/LiveNote'

const TREND_WINDOW = 5
const RECENT_COUNT = 5

function Overview({ player }) {
  const { summary, matches, inProgress } = usePlayerData()
  const trend = rollingWinRate(matches, TREND_WINDOW)
  const bests = personalBests(matches)
  const recent = matches.slice(0, RECENT_COUNT)

  return (
    <div className="overview">
      <Hero player={player} summary={summary} matches={matches} />

      {inProgress > 0 && <LiveNote count={inProgress} />}

      <StatGrid summary={summary} />

      {trend.length >= 2 ? (
        <TrendChart points={trend} window={TREND_WINDOW} />
      ) : (
        // Said plainly rather than drawn from too little data. A line
        // through three matches is three coin flips, and inviting
        // someone to read improvement into that is worse than waiting.
        <section className="trend trend-early" aria-label="Recent form">
          <h2>Form</h2>
          <p className="muted-inline">
            Your form line appears once you&rsquo;ve played{' '}
            {TREND_WINDOW + 1} matches — before that it&rsquo;s too few games to
            show a trend honestly.
          </p>
        </section>
      )}

      <ShotProfile summary={summary} />
      <Highlights matches={matches} />
      {bests.length > 0 && <PersonalBests bests={bests} />}

      <section className="recent">
        <div className="section-head">
          <h2>Recent matches</h2>
          {matches.length > RECENT_COUNT && (
            <Link className="link" to="/matches">
              See all {matches.length}
            </Link>
          )}
        </div>
        {/* Truncated here on purpose: the full list has its own screen,
            and an overview that ends in forty rows is not an overview. */}
        <MatchList matches={recent} />
      </section>
    </div>
  )
}

export default Overview
