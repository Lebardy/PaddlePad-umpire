import { useRef, useState } from 'react'
import { RATING_STEPS } from '../lib/content.js'
import { useOnScreen } from '../lib/hooks.js'
import Icon from './Icon.jsx'
import './Sections.css'

// The four steps from a tapped rally to a rating. They light one after
// another the first time the row is on screen, and stay lit.
export default function RatingSteps() {
  const ref = useRef(null)
  const on = useOnScreen(ref, 0.3)
  const [lit, setLit] = useState(false)
  if (on && !lit) setLit(true)

  return (
    <section className="rating" aria-labelledby="rating-title">
      <div className="wrap">
        <h2 id="rating-title" className="rating-title">How the rating works</h2>
        <ol className={`rating-steps${lit ? ' lit' : ''}`} ref={ref}>
          {RATING_STEPS.map((s, i) => (
            <li className="rating-step" style={{ '--i': i }} key={s.title}>
              <span className="rating-icon"><Icon name={s.icon} size={28} /></span>
              <b>{s.title}</b>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
