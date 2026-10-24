import { ENDINGS } from '../../lib/endings.js'
import { SAMPLE } from '../../lib/loop.js'
import Court from './Court.jsx'

// The umpire app's two screens in this story, drawn from its own code:
// the live scoring screen (src/screens/LiveMatch.jsx: the score, the
// last thing logged, the 18 keys, then "who") and a finished match's
// Video list (src/components/MatchVideo.jsx) with the star on each rally.
// Sizes are in em so the whole screen scales with the tablet.

// Paths copied from src/components/Icon.jsx.
const PATHS = {
  star: 'M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17l-5.5 3 1-6.1L3 9.5l6.3-.9z',
  camera: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  play: 'M7 4l13 8-13 8z',
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  drive: 'M3 12h16M14 7l5 5-5 5',
}

function Glyph({ d, className = '' }) {
  return (
    <svg className={`glyph ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const WINNING = ENDINGS.filter((e) => e.outcome === 'winner')
const FAULTS = ENDINGS.filter((e) => e.outcome === 'error')

function Header() {
  return (
    <div className="u-head">
      <i className="u-mark" />
      <span>PaddlePad <b>Umpire</b></span>
      <span className="sample-tag">{SAMPLE.label}</span>
    </div>
  )
}

const FINAL = [11, 6]

// A score rolls like an odometer: both digits are there, the strip slides.
function Roll({ from, to, rolled }) {
  return (
    <span className="roll">
      <span className="roll-strip" style={{ transform: `translateY(${rolled ? -1.05 : 0}em)` }}>
        <i>{from}</i>
        <i>{to}</i>
      </span>
    </span>
  )
}

// `final` is the finished match: 11-6, no serving side any more.
function Scoreboard({ rolled, final }) {
  return (
    <div className="u-board">
      <div className={`u-side${final ? '' : ' serving'}`}>
        <span className={`u-name${final ? '' : ' is-server'}`}>{SAMPLE.player}</span>
        <span className="u-value">{final ? FINAL[0] : <Roll from={SAMPLE.before[0]} to={SAMPLE.after[0]} rolled={rolled} />}</span>
        {!final && <span className="u-tag">Serving</span>}
      </div>
      <div className="u-side">
        <span className="u-name">{SAMPLE.opponent}</span>
        <span className="u-value">{final ? FINAL[1] : <Roll from={SAMPLE.before[1]} to={SAMPLE.after[1]} rolled={rolled} />}</span>
      </div>
    </div>
  )
}

function Key({ ending, pressed }) {
  return (
    <span className={`u-key ${ending.outcome === 'winner' ? 'winner' : 'error'}${pressed ? ' is-pressed' : ''}`}>
      <Glyph d={ending.path} />
      <span>
        {ending.label}
        {ending.by && <small>server</small>}
      </span>
    </span>
  )
}

export function ScoringScreen({ id, beat }) {
  const scored = id !== 'tap' || beat >= 4
  const pressed = id === 'tap' && beat >= 1 && beat < 4
  const asking = id === 'tap' && beat >= 2 && beat < 4
  const last = asking || pressed ? `${SAMPLE.ending} — who?` : scored ? `Last: ${SAMPLE.ending} — ${SAMPLE.player}` : 'Last: Put-away — Dani'

  return (
    <div className="u-screen">
      <Header />
      <Scoreboard rolled={scored} />
      <div className="u-last">
        <span>{last}</span>
        <span className="u-undo"><Glyph d={PATHS.undo} />{pressed || asking ? 'Back' : 'Undo'}</span>
      </div>
      <div className="u-rally">
        <div className={`u-keys${asking ? ' is-away' : ''}`}>
          <div className="u-third">
            <h3>3rd shot <small>serving side</small></h3>
            <span className="u-third-name">{SAMPLE.player}</span>
            <span className="u-key winner"><span>Drop <Glyph d={PATHS.check} /></span></span>
            <span className="u-key error"><span>Drop <Glyph d={PATHS.x} /></span></span>
            <span className="u-key neutral"><span><Glyph d={PATHS.drive} />Drive</span></span>
          </div>
          {[['Won with a shot', WINNING, 'winner'], ['Lost by a fault', FAULTS, 'error']].map(([title, list, tone]) => (
            <div className={`u-group ${tone}`} key={tone}>
              <h3>{title}</h3>
              <div className="u-grid">
                {list.map((e) => <Key key={e.key} ending={e} pressed={pressed && e.label === SAMPLE.ending} />)}
              </div>
            </div>
          ))}
        </div>
        <div className={`u-who${asking ? ' is-open' : ''}`}>
          <p>Who hit it?</p>
          <div className="u-who-teams">
            <span className={`u-who-btn${beat >= 3 && id === 'tap' ? ' is-pressed' : ''}`}>{SAMPLE.player}<small>serving</small></span>
            <span className="u-who-btn">{SAMPLE.opponent}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Newest first, as the real list is. The match ran on to 11-6 after the sample rally.
const ROWS = [
  { n: 17, words: 'Put-away — Rio', at: '08:15' },
  { n: 13, words: 'Dink winner — Rio', at: '06:48' },
  { n: 10, words: 'Drop winner — Rio', at: '05:30', starred: true },
  { n: 4, words: 'Passing shot — Rio', at: '01:52', starred: true },
]

export function DoneScreen({ id, beat }) {
  const stars = id === 'star' && beat < 1 ? SAMPLE.stars[0] : SAMPLE.stars[1]
  return (
    <div className="u-screen">
      <Header />
      <Scoreboard final />
      <p className="u-complete">{SAMPLE.player} won</p>
      <section className="u-video">
        <h3>
          <Glyph d={PATHS.camera} />Video
          <span className="u-count"><Glyph d={PATHS.star} />{stars}/5</span>
        </h3>
        {/* The real screen plays the match video here; this one is a drawn court. */}
        <div className="u-player"><Court clip={3} playing={false} /></div>
        <ul>
          {ROWS.map((row) => {
            const on = row.starred || (row.n === 13 && stars === SAMPLE.stars[1])
            return (
              <li key={row.n} className={row.n === 13 ? 'is-sample' : undefined}>
                <span className="u-words">{row.words}</span>
                <span className="u-at">{row.at}</span>
                <Glyph d={PATHS.play} className="u-play" />
                <span className={`u-star${on ? ' is-on' : ''}${row.n === 13 && id === 'star' && on ? ' pop' : ''}`}>
                  <Glyph d={PATHS.star} />
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
