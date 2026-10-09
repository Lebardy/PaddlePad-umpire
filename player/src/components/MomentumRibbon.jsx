// ============================================================
// Every point of a game, as rows of numbered boxes.
//
// Replaces a wrapping grid of twenty-six "6-4" scores, which read as a
// wall of numbers. One box per point, in order: the side that won the
// point fills it (--series-1) or outlines it (--series-2) -- the
// validated pair StackedBar uses, and filled-against-outlined so it
// still reads without colour. Each box carries one number: the score
// that side reached with that point, so the last box of each kind is
// the score.
//
// Tap (or arrow to) any box and the readout above says the full score,
// who did it and how with whether it was a winning shot or a mistake
// ("Nia Cruz hit a hard put-away", then a green Winning shot), and
// whether it was a moment that mattered: game point, a lead change,
// the lowest point, the finish. One tab stop for the whole set, not
// twenty-six: arrow keys move along it, the way a slider does.
//
// The screen holds which box is picked, not the ribbon, so the chart
// above can light up the same point.
//
// The boxes rise in one after another when scrolled to -- once, and
// not at all for reduced motion.
// ============================================================

import { useRef } from 'react'
import { useInView } from '../lib/motion'
import { pointKind, pointSentence } from '../lib/pointWords'

/** The moments that mattered about point i, in words, most important first. */
function momentsOf(moment, i, { last, lowIndex }) {
  const tags = []
  if (i === last) tags.push('final point')
  if (i === lowIndex) tags.push('lowest point')
  if (moment.gamePoint) tags.push('game point')
  if (moment.leadChange) tags.push('lead changes hands')
  if (moment.level) tags.push('level')
  return tags
}

/**
 * @param {object} props
 * @param {Array<{scorer, leadChange, level, gamePoint}>} props.moments
 * @param {Array<{winners, losers}>} props.path - score after each point
 * @param {Array<{how, ending, by, byYou?}>} [props.points] - how each
 *   point was won and by whom; the readout leaves that out without it
 * @param {(point) => string} props.asShown - a score, the page's way round
 * @param {string} props.winners - names, for the legend and labels
 * @param {string} props.losers
 * @param {number | null} props.lowIndex - the winners' lowest point
 * @param {number | null} props.selected - the picked box, if any
 * @param {(i: number) => void} props.onSelect
 */
function MomentumRibbon({ moments, path, points, asShown, winners, losers, lowIndex, selected, onSelect }) {
  const ref = useRef(null)
  const inView = useInView(ref)
  const buttons = useRef([])

  const last = moments.length - 1
  const context = { last, lowIndex }
  const nameOf = (scorer) => (scorer === 'winners' ? winners : losers)
  // The score the scoring side reached with this point.
  const reached = (i) => path[i][moments[i].scorer]

  function choose(i) {
    const next = Math.max(0, Math.min(last, i))
    onSelect(next)
    buttons.current[next]?.focus()
  }

  function onKeyDown(event) {
    const from = selected ?? 0
    if (event.key === 'ArrowRight') choose(from + 1)
    else if (event.key === 'ArrowLeft') choose(from - 1)
    else if (event.key === 'Home') choose(0)
    else if (event.key === 'End') choose(last)
    else return
    event.preventDefault()
  }

  let readout = <span className="ribbon-hint">Tap a point to see how it was won</span>
  if (selected !== null) {
    const moment = moments[selected]
    const point = points?.[selected]
    // A rally with no player recorded against it can still say which
    // side took the point.
    const sentence = (point && pointSentence(point)) ?? `${nameOf(moment.scorer)} scored`
    const tags = momentsOf(moment, selected, context)
    readout = (
      <>
        <span className="ribbon-at">{asShown(path[selected])}</span>
        <span className="ribbon-who">
          {sentence}
          {point && <span className={`ribbon-kind is-${point.how}`}>{pointKind(point.how)}</span>}
        </span>
        {tags.length > 0 && <span className="ribbon-tags">{tags.join(' · ')}</span>}
      </>
    )
  }

  return (
    <div ref={ref} className={`ribbon${inView ? ' is-in' : ''}`}>
      <div className="ribbon-legend">
        <span><i className="ribbon-swatch is-winners" aria-hidden="true" />{winners}</span>
        <span><i className="ribbon-swatch is-losers" aria-hidden="true" />{losers}</span>
      </div>

      <p className="ribbon-readout" aria-live="polite">{readout}</p>

      <div className="ribbon-blocks" role="group" aria-label="Every point in order" onKeyDown={onKeyDown}>
        {moments.map((moment, i) => (
          <button
            key={i}
            ref={(el) => { buttons.current[i] = el }}
            type="button"
            className={`ribbon-block is-${moment.scorer}${selected === i ? ' is-selected' : ''}`}
            style={{ '--i': i }}
            // One tab stop for the whole set: the chosen box, or the
            // first before anything is chosen.
            tabIndex={i === (selected ?? 0) ? 0 : -1}
            aria-label={`Point ${i + 1}, ${asShown(path[i])}, ${nameOf(moment.scorer)} scored`}
            aria-pressed={selected === i}
            onClick={() => choose(i)}
          >
            {reached(i)}
          </button>
        ))}
      </div>
    </div>
  )
}

export default MomentumRibbon
