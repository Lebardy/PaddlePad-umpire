import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Court from './Court.jsx'
import { ENDED, LATER, POINTS, RATED, SAMPLE, STARRED } from '../../lib/loop.js'

// The player app's screens in this story, from its own code: the note a
// player sees while their match is being scored (components/LiveNote.jsx),
// a finished match's Point by point page (screens/MatchDetail.jsx, with
// MomentumRibbon, Highlights and RallyEndings) and the Rating page. It is
// Rio's phone, so the app says "You". Sizes are in em so the phone scales.
// The body of each screen clips instead of growing, so the phone keeps one
// height whatever it shows.

// Each box shows the score its side reached with that point (the real
// ribbon does, not the point's number).
const GAME = (() => {
  let rio = 0
  let dani = 0
  return [...POINTS, ...LATER].map((rioWon) => {
    if (rioWon) rio += 1
    else dani += 1
    return { rioWon, reached: rioWon ? rio : dani, score: `${rio}–${dani}` }
  })
})()

// How each starred point was won, in the words the real readout uses.
const STARRED_HOW = {
  4: 'hit it past them',
  10: 'hit a soft drop they couldn’t reach',
  13: 'won it with a soft shot at the net',
}

function Band({ children }) {
  return <h2 className="p-band">{children}<span className="sample-tag">{SAMPLE.label}</span></h2>
}

function Bar({ label, count, most, tone }) {
  return (
    <li className="p-row">
      <span>{label}</span>
      <span className="p-track"><span className={`p-fill ${tone}`} style={{ width: `${Math.round((count / most) * 100)}%` }} /></span>
      <b key={count} className="p-count">{count}</b>
    </li>
  )
}

// While the match is on, the player app shows no score or rallies, only this.
export function LiveScreen() {
  return (
    <div className="p-screen">
      <div className="p-scroll">
        <Band>Overview</Band>
        <div className="p-body">
          <div className="p-live" role="status">
            <span className="p-live-dot" aria-hidden="true" />
            <span>1 match being scored now — results appear when it finishes</span>
          </div>
        </div>
      </div>
      <TabBar on="Overview" />
    </div>
  )
}

// The finished match, with every rally at once.
export function MatchScreen({ id, beat, still }) {
  const filmed = id === 'star' || id === 'reel'
  const clip = id === 'reel' && !still ? Math.min(3, beat + 1) : 1
  const picked = id === 'reel' ? STARRED[clip - 1] - 1 : id === 'lands' ? 12 : null
  // Stars come with the video, and the third once the umpire has starred the rally.
  const third = id === 'reel' || (id === 'star' && beat >= 1)
  const stars = filmed ? STARRED.filter((n) => n !== 13 || third) : []
  // Every ending Rio's rallies had, most first as the real list is.
  const won = [['Soft shots at the net', 3], ['Soft drops they couldn’t reach', 2], ['Shots past your opponent', 1], ['Hard put-away shots', 1]]
  const lost = [['Hitting into the net', 2], ['Missed soft shots at the net', 1]]
  const signed = (n) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`)

  return (
    <div className="p-screen">
      <div className="p-scroll">
        <Band>Point by point</Band>
        <div className="p-body">
          {filmed && (
            <>
              <div className="p-video" data-fly="video"><Court clip={clip} playing={id === 'reel' && !still} /></div>
              <div className="p-highlights">
                <span className="p-play" aria-hidden="true"><Icon name="play" size={14} /><Icon name="star" size={13} />{stars.length}</span>
                {id === 'reel' && <span className="p-at">{clip} of {SAMPLE.reel.of}</span>}
              </div>
            </>
          )}
          <div className="p-legend"><span><i className="sw is-you" />You</span><span><i className="sw is-them" />{SAMPLE.opponent}</span></div>
          <p className="p-readout">
            {picked === null ? (
              <span className="p-hint">{filmed ? 'Tap a point to watch it' : 'Tap a point to see how it was won'}</span>
            ) : (
              <>
                <b key={picked} className="p-at-score">{GAME[picked].score}</b>
                <span className="p-who">You {STARRED_HOW[picked + 1]}<span className="p-kind">Winning shot</span></span>
              </>
            )}
          </p>
          <div className="p-boxes" role="presentation">
            {GAME.map(({ rioWon, reached }, i) => (
              <span key={i} className={`p-box ${rioWon ? 'is-you' : 'is-them'}${picked === i ? ' is-picked' : ''}`}>
                {reached}
                {stars.includes(i + 1) && <Icon name="star" size={9} />}
              </span>
            ))}
          </div>
        </div>
        <h2 className="p-band">How your rallies ended</h2>
        <div className="p-body p-endings">
          <h3 className="is-won"><Icon name="trophy" size={12} />Won with a shot</h3>
          <ul>{won.map(([label, n]) => <Bar key={label} label={label} count={n} most={3} tone="is-won" />)}</ul>
          <h3 className="is-lost"><Icon name="offline" size={12} />Lost with a mistake</h3>
          <ul>{lost.map(([label, n]) => <Bar key={label} label={label} count={n} most={2} tone="is-lost" />)}</ul>
          <p className="p-lead is-lost"><Icon name="offline" size={12} /><span><strong>Hitting into the net</strong> cost you most: <span className="p-nums">{ENDED.cost.rallies} rallies, {signed(ENDED.cost.ppr)} PPR</span></span></p>
          <p className="p-lead is-won"><Icon name="trend" size={12} /><span><strong>Soft shots at the net</strong> won you most: <span className="p-nums">{ENDED.won.rallies} rallies, {signed(ENDED.won.ppr)} PPR</span></span></p>
        </div>
      </div>
      <TabBar on="Matches" />
    </div>
  )
}

function TabBar({ on }) {
  return (
    <nav className="p-tabs" aria-hidden="true">
      {[['court', 'Overview'], ['film', 'Matches'], ['people', 'People'], ['player', 'You']].map(([icon, label]) => (
        <span key={label} className={label === on ? 'on' : undefined}><Icon name={icon} size={16} />{label}</span>
      ))}
    </nav>
  )
}

// Counts up to the rating the way the real page does, unless motion is off.
function useCount(to, from, run) {
  const [k, setK] = useState(0)
  useEffect(() => {
    if (!run) return
    const t0 = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - t0) / 1100)
      setK(progress)
      if (progress < 1) raf = requestAnimationFrame(tick)
    })
    return () => {
      cancelAnimationFrame(raf)
      setK(0)
    }
  }, [run])
  return run ? Math.round(from + (to - from) * (1 - (1 - k) ** 3)) : to
}

export function RatingScreen({ active, still }) {
  const points = useCount(SAMPLE.rating, RATED.rio, active && !still)
  return (
    <div className="p-screen">
      <div className="p-scroll">
        <Band>Your rating</Band>
        <div className="p-body p-rating">
          <div className="p-step"><span className="p-n">1</span>PaddlePad Rating</div>
          <p className="p-figure">{points.toLocaleString('en-US')} <span>PPR</span></p>
          <p className="p-anchor">Everyone starts at 1,500.</p>
          <p className="p-fold">What’s moving it<Icon name="next" size={14} /></p>
          <p className="p-note"><Icon name="trend" size={14} />Built from many matches, moved when each one ends</p>
          <div className="p-step"><span className="p-n">2</span>What to work on</div>
          <p className="p-card"><small>Your most common mistake</small>Hitting into the net</p>
        </div>
      </div>
      <TabBar on="You" />
    </div>
  )
}
