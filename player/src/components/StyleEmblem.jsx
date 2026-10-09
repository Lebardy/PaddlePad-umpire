// ============================================================
// A playstyle's emblem: a court seen from above, the player's side at
// the bottom, with the part of the game that names them lit. Each trait
// word in the name docks under it as a small mark.
//
// Drawn in code rather than shipped as pictures, so it stays sharp at
// any size, follows the theme, and draws itself in the first time it is
// scrolled to.
// ============================================================

import { useRef } from 'react'
import { emblemFor } from '../lib/styleEmblem'
import { useInView } from '../lib/motion'

// What is lit on the court for each identity, and what is drawn over it.
const COURTS = {
  // Wins at the net: the strip beside the net, and a ball in it.
  net: { lit: <rect className="e-zone" x="12" y="48" width="48" height="12" />, play: <circle className="e-ball" cx="36" cy="54" r="3.3" /> },
  // Wins away from the net: the back court, pushing forward.
  power: { lit: <rect className="e-zone" x="12" y="60" width="48" height="26" />, play: <path className="e-cut" d="M27 81l9-8 9 8M27 72l9-8 9 8" /> },
  // No lean either way: the whole side, covered.
  all: {
    lit: <rect className="e-zone" x="12" y="48" width="48" height="38" />,
    play: <>
      <path className="e-cut" d="M12 60h48M36 60v26" />
      <circle className="e-ball" cx="24" cy="54" r="2.8" />
      <circle className="e-ball" cx="48" cy="54" r="2.8" />
      <circle className="e-ball" cx="24" cy="74" r="2.8" />
      <circle className="e-ball" cx="48" cy="74" r="2.8" />
    </>,
  },
  // Third shot driven: one hard line, deep into the far side.
  driver: { play: <g className="e-play"><path className="e-shot" d="M25 82L46 19M36 23l10-4 3 10" /></g> },
  // Third shot dropped: a soft arc that lands just past the net.
  dropper: {
    play: <g className="e-play">
      <path className="e-shot e-soft" d="M25 82Q12 48 41 43" />
      <circle className="e-ring" cx="45" cy="42" r="5" />
    </g>,
  },
}

// One mark per trait word. Opposites share a drawing language (an even
// line and a jagged one, level dots and scattered ones), so neither
// side of a pair reads as a bad grade.
const MARKS = {
  Clean: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l3 3 5-6.5" />,
  Precise: <><path d="M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 2v4M12 18v4M2 12h4M18 12h4" /><circle className="dot" cx="12" cy="12" r="1.6" /></>,
  Steady: <path d="M3 12h18M3 8v8M21 8v8" />,
  Unpredictable: <path d="M3 15l4-8 4 11 4-13 3 7 3-3" />,
  Reliable: <><path d="M3 19h18" /><circle className="dot" cx="6" cy="11" r="2.2" /><circle className="dot" cx="12" cy="11" r="2.2" /><circle className="dot" cx="18" cy="11" r="2.2" /></>,
  Inconsistent: <><path d="M3 19h18" /><circle className="dot" cx="6" cy="14" r="2.2" /><circle className="dot" cx="12" cy="5.5" r="2.2" /><circle className="dot" cx="18" cy="11" r="2.2" /></>,
  Consistent: <path d="M6 19V8M12 19V8M18 19V8" />,
  Streaky: <path d="M4.5 19V6M9.5 19V6M14.5 19v-4M19.5 19v-4" />,
  Composed: <path d="M3 12c3-4.5 6-4.5 9 0s6 4.5 9 0" />,
  'Solid-Net': <><path d="M3 5v14M21 5v14M3 12h18M3 17h18M8 8v9M12 8v9M16 8v9" /><path d="M3 7.5h18" strokeWidth="3.4" /></>,
}

/** The court for one identity; `className` says how large and whether it draws in. */
function Court({ identity, className }) {
  const { lit, play } = COURTS[identity]
  return (
    <svg className={className} viewBox="0 0 72 96" aria-hidden="true">
      <rect className="e-plate" x="1" y="1" width="70" height="94" rx="3" />
      {lit}
      <g className="e-court">
        <rect x="12" y="10" width="48" height="76" pathLength="1" />
        <path d="M12 36h48M12 60h48M36 10v26M36 60v26" pathLength="1" />
      </g>
      <path className="e-net" d="M8 48h56" />
      {play}
    </svg>
  )
}

/** The small picture for one word of a name: a trait's mark, or the identity's court. */
export function WordMark({ word }) {
  if (MARKS[word]) return <svg className="mark" viewBox="0 0 24 24" aria-hidden="true">{MARKS[word]}</svg>
  const identity = emblemFor(word)?.identity
  return identity ? <Court identity={identity} className="emblem mini" /> : null
}

/** Decoration beside the name, which already says it in words. */
function StyleEmblem({ name }) {
  const ref = useRef(null)
  const inView = useInView(ref)
  const emblem = emblemFor(name)
  if (!emblem) return null
  return (
    <span className="crest" ref={ref} aria-hidden="true">
      <Court identity={emblem.identity} className={`emblem${inView ? ' draw' : ''}`} />
      {emblem.traits.length > 0 && (
        <span className="pips">
          {emblem.traits.map((word, i) => (
            <span className="pip" key={word} style={{ '--i': i }}><WordMark word={word} /></span>
          ))}
        </span>
      )}
    </span>
  )
}

export default StyleEmblem
