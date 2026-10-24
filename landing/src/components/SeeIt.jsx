import { useEffect, useRef, useState } from 'react'
import { AUDIENCES } from '../lib/content.js'
import { useOnScreen, useReducedMotion } from '../lib/hooks.js'
import { STEPS, SAMPLE, autoplays, nextStep, prevStep } from '../lib/loop.js'
import Icon from './Icon.jsx'
import { DoneScreen, ScoringScreen } from './seeit/UmpireScreens.jsx'
import { MatchScreen, RatingScreen } from './seeit/PlayerScreens.jsx'
import './SeeIt.css'

// The first tab: one sample rally followed through the apps in five
// steps. Each step plays a few "beats" (the tap, the sheet, the score
// rolling) on timers; with reduced motion every step shows its end state
// and changes only when a control is pressed.

// When each beat of a step lands, in ms after the step starts.
const BEATS = {
  tap: [[700, 1], [1300, 2], [2000, 3], [2400, 4]],
  lands: [[900, 1]],
  star: [[900, 1]],
  reel: [[1200, 1], [2400, 2]],
  rating: [],
}
const END = 9

// What the sample says in a line, and the longer sentence a screen reader gets.
const SAY = [
  'The umpire taps how it ended.',
  'The point lands on Rio’s phone.',
  'The umpire stars the rally.',
  'Rio watches it back.',
  'Many matches build Rio’s rating.',
]
const READ = [
  'The umpire taps Dink winner, then Rio. 7–5 becomes 8–5.',
  'The point lands on Rio’s phone as box 13, and soft shots at the net go from 2 to 3.',
  'After the match the umpire stars the rally: 3 of 5 highlights.',
  'Rio watches the 3 starred rallies back to back.',
  'Rio’s rating is 1,709, built from many matches and updated every night at 3 AM.',
]

// The amber streak: the point travelling from one screen to another.
function fly(scene, streak, from, to) {
  const at = (sel) => {
    const box = scene.querySelector(sel)?.getBoundingClientRect()
    const base = scene.getBoundingClientRect()
    return box && [box.left - base.left + box.width / 2, box.top - base.top + box.height / 2]
  }
  const a = at(from)
  const b = at(to)
  if (!a || !b) return
  const lift = Math.min(120, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.3)
  const at2 = (p, y = 0) => `translate(${p[0]}px, ${p[1] + y}px)`
  streak.animate(
    [
      { transform: `${at2(a)} scale(.5)`, opacity: 0 },
      { transform: `${at2([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], -lift)} scale(1.2)`, opacity: 1, offset: 0.5 },
      { transform: `${at2(b)} scale(.5)`, opacity: 0 },
    ],
    { duration: 800, easing: 'cubic-bezier(.2,.7,.3,1)' },
  )
}

export default function SeeIt() {
  const reduced = useReducedMotion()
  const story = useRef(null)
  const scene = useRef(null)
  const streak = useRef(null)
  const onScreen = useOnScreen(story, 0.2)
  const [step, setStep] = useState(0)
  const [paused, setPaused] = useState(false)
  const [beat, setBeat] = useState(0)
  // Bumped on every go(), so pressing the step already shown replays it.
  const [run, setRun] = useState(0)
  const [wasOnScreen, setWasOnScreen] = useState(false)

  const play = autoplays({ reducedMotion: reduced, onScreen, paused })
  const id = STEPS[step].id
  const b = reduced ? END : beat

  // Coming on screen (or becoming the shown tab) starts the step over, so
  // it is not already finished when the visitor gets there.
  if (onScreen !== wasOnScreen) {
    setWasOnScreen(onScreen)
    if (onScreen) go(step)
  }

  // A step always starts from its first beat.
  function go(i) {
    setStep(i)
    setBeat(0)
    setRun((r) => r + 1)
  }
  function press(i) {
    go(i)
    setPaused(true)
  }


  // Only the loop moves on by itself, and only while it may play.
  useEffect(() => {
    if (!play) return
    const t = setTimeout(() => go(nextStep(step)), STEPS[step].ms)
    return () => clearTimeout(t)
  }, [play, step])

  // The moments inside the step.
  useEffect(() => {
    if (reduced) return
    const timers = BEATS[id].map(([ms, n]) => setTimeout(() => setBeat(n), ms))
    const lights = { lands: ['[data-screen="tablet"]', '[data-fly="box"]'], reel: ['[data-screen="tablet"]', '[data-fly="video"]'] }[id]
    if (lights) timers.push(setTimeout(() => fly(scene.current, streak.current, ...lights), 150))
    return () => timers.forEach(clearTimeout)
  }, [run, reduced, id])

  const umpireFocus = id === 'tap' || id === 'star'
  const players = AUDIENCES.players.actions

  return (
    <>
      <div className="story" ref={story}>
        <div className="story-head">
          <span className="sample-chip">{SAMPLE.label}</span>
          <span className="story-label"><b>{step + 1}/{STEPS.length}</b> {STEPS[step].label}</span>
          <span className="ctrl">
            <button type="button" aria-label="Back" onClick={() => press(prevStep(step))}><Icon name="prev" size={22} /></button>
            {!reduced && (
              <button type="button" aria-label={paused ? 'Play' : 'Pause'} onClick={() => setPaused(!paused)}>
                <Icon name={paused ? 'play' : 'pause'} size={20} />
              </button>
            )}
            <button type="button" aria-label="Next" onClick={() => press(nextStep(step))}><Icon name="next" size={22} /></button>
          </span>
        </div>

        <div className="scene" ref={scene}>
          <p className="caption" key={step}>
            <span>{step + 1} · {STEPS[step].label}</span>
            <b>{SAY[step]}</b>
          </p>

          <div className={`device tablet ${umpireFocus ? 'focus' : 'rest'}`} data-screen="tablet" role="img" aria-label="The umpire app on a tablet">
            <div className="screens">
              <div className={`screen${id === 'tap' || id === 'lands' ? '' : ' off'}`}><ScoringScreen id={id} beat={b} /></div>
              <div className={`screen${id === 'tap' || id === 'lands' ? ' off' : ''}`}><DoneScreen id={id} beat={b} /></div>
            </div>
          </div>

          <div className={`device phone ${umpireFocus ? 'rest' : 'focus'}`} data-screen="phone" role="img" aria-label="The player app on a phone">
            <div className="screens">
              <div className={`screen${id === 'rating' ? ' off' : ''}`}><MatchScreen id={id} beat={b} still={reduced} /></div>
              <div className={`screen${id === 'rating' ? '' : ' off'}`}><RatingScreen active={id === 'rating'} still={reduced} /></div>
            </div>
          </div>

          <span className="streak" ref={streak} aria-hidden="true" />
        </div>

        <div className="steps" role="group" aria-label="Steps of the rally">
          {STEPS.map((s, i) => (
            <button type="button" key={s.id} aria-label={`Step ${i + 1}: ${s.label}`} aria-current={i === step ? 'step' : undefined} onClick={() => press(i)}>
              <b>{i + 1}</b>
              <span>{s.label}</span>
              {i < step && <i className="fill done" />}
              {i === step && <i key={`${step}-${play}`} className={`fill ${play ? 'run' : ''}`} style={{ animationDuration: `${s.ms}ms` }} />}
            </button>
          ))}
        </div>
        {/* Spoken only when someone steps through; empty while the loop plays itself. */}
        <p className="sr-only" aria-live="polite">{play ? '' : READ[step]}</p>
      </div>

      <div className="ctas">
        {players.map((a) => (
          <div className="cta" key={a.label}>
            <a className={`btn ${a.kind}`} href={a.href}>{a.label}</a>
          </div>
        ))}
      </div>
    </>
  )
}
