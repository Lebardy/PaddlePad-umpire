import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Court from './Court.jsx'
import { LATER, POINTS, SAMPLE, STARRED } from '../../lib/loop.js'

// The player app's two screens in this story, from its own code: a
// match's Point by point page (player/src/screens/MatchDetail.jsx, with
// MomentumRibbon, Highlights and RallyEndings) and the Rating page. It is
// Rio's phone, so the app says "You". Sizes are in em so the phone scales.

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

const DINKS_BEFORE = SAMPLE.dinks[0]

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

export function MatchScreen({ id, beat, still }) {
  const filmed = id === 'star' || id === 'reel'
  const landed = id !== 'tap' && !(id === 'lands' && beat < 1)
  const clip = id === 'reel' && !still ? Math.min(3, beat + 1) : 1
  const picked = id === 'reel' ? STARRED[clip - 1] - 1 : id === 'lands' && landed ? 12 : null
  // The star count follows the tablet: 3 once the umpire has starred the rally.
  const third = id === 'reel' || (id === 'star' && beat >= 1)
  const stars = STARRED.filter((n) => n !== 13 || third)
  // After the match the page has every point; while it is live, up to the sample rally.
  const shown = filmed ? GAME.length : POINTS.length
  const dinks = landed ? SAMPLE.dinks[1] : DINKS_BEFORE
  const won = [['Soft shots at the net', dinks], ['Soft drops they couldn’t reach', 2], ['Hard put-away shots', 1]]
  const lost = [['Hitting into the net', 2], ['Missed soft shots at the net', 1]]
  const most = Math.max(...won.map((r) => r[1]))
  // The line under the lists names the ending they had most often; a tie names both.
  const wonMost = dinks > 2 ? 'Soft shots at the net' : 'Soft shots at the net and soft drops they couldn’t reach'

  return (
    <div className="p-screen">
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
          {GAME.map(({ rioWon }, i) => {
            if (i >= shown) return null
            const hidden = i === 12 && !landed
            return (
              <span
                key={i}
                data-fly={i === 12 ? 'box' : undefined}
                className={`p-box ${rioWon ? 'is-you' : 'is-them'}${picked === i ? ' is-picked' : ''}${hidden ? ' is-hidden' : ''}${i === 12 && id === 'lands' ? ' is-new' : ''}`}
              >
                {GAME[i].reached}
                {stars.includes(i + 1) && <Icon name="star" size={9} />}
              </span>
            )
          })}
        </div>
      </div>
      <h2 className="p-band">How your rallies ended</h2>
      <div className="p-body p-endings">
        <h3 className="is-won"><Icon name="trophy" size={12} />Won with a shot</h3>
        <ul>{won.map(([label, n]) => <Bar key={label} label={label} count={n} most={most} tone="is-won" />)}</ul>
        <h3 className="is-lost"><Icon name="offline" size={12} />Lost with a mistake</h3>
        <ul>{lost.map(([label, n]) => <Bar key={label} label={label} count={n} most={2} tone="is-lost" />)}</ul>
        <p className="p-lead is-lost"><Icon name="offline" size={12} /><span><strong>Hitting into the net</strong> cost you most</span></p>
        <p className="p-lead is-won"><Icon name="trend" size={12} /><span><strong>{wonMost}</strong> won you most</span></p>
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
  const points = useCount(SAMPLE.rating, 1500, active && !still)
  return (
    <div className="p-screen">
      <Band>Your rating</Band>
      <div className={`p-body p-rating${active ? ' is-active' : ''}`}>
        <div className="p-step"><span className="p-n">1</span>PaddlePad Rating</div>
        <p className="p-figure">{points.toLocaleString('en-US')} <span>PPR</span></p>
        <p className="p-anchor">Everyone starts at 1,500.</p>
        <p className="p-fold">What’s moving it<Icon name="next" size={14} /></p>
        <p className="p-nightly"><Icon name="moon" size={14} />Built from many matches, updated every night at 3 AM</p>
        <div className="p-step"><span className="p-n">2</span>What to work on</div>
        <p className="p-card"><small>Your most common mistake</small>Hitting into the net</p>
      </div>
      <TabBar on="You" />
    </div>
  )
}
