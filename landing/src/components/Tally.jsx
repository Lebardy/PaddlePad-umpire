import { useEffect, useRef, useState } from 'react'
import { TALLY } from '../lib/content.js'
import { useOnScreen, useReducedMotion } from '../lib/hooks.js'
import Icon from './Icon.jsx'
import './Sections.css'

const COUNT_MS = 900

// The number strip. Numbers count up from 0 the first time the strip is
// on screen; '3 AM' flickers on like a lamp instead. Reduced motion shows
// the final values at once.
export default function Tally() {
  const ref = useRef(null)
  const reduced = useReducedMotion()
  const on = useOnScreen(ref, 0.5)
  const [started, setStarted] = useState(false)
  const [k, setK] = useState(0) // 0..1 of the count

  if (on && !started) setStarted(true)

  useEffect(() => {
    if (!started || reduced) return
    let frame
    const t0 = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - t0) / COUNT_MS)
      setK(1 - Math.pow(1 - t, 3))
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [started, reduced])

  // Before the strip is seen the figures read 0; the real value is always
  // in each cell's aria-label.
  const shown = (value) => (typeof value !== 'number' ? value : reduced ? value : Math.round(value * k))

  return (
    <section className="tally" ref={ref} aria-label="PaddlePad in numbers">
      <div className="wrap tally-row">
        {TALLY.map((cell) => (
          <div className="tally-cell" key={cell.label} role="group" aria-label={`${cell.value} ${cell.label}`}>
            <span className="tally-icon"><Icon name={cell.icon} size={22} /></span>
            <b aria-hidden="true" className={typeof cell.value === 'number' || !started || reduced ? undefined : 'flicker'}>{shown(cell.value)}</b>
            <span aria-hidden="true" className="tally-label">{cell.label}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
