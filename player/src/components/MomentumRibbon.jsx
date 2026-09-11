// ============================================================
// Every point of a game, as a ribbon of blocks.
//
// Replaces a wrapping grid of twenty-six scores, which read as a wall
// of numbers. One block per point, in order: the winners' points filled
// in --series-1, the losers' outlined in --series-2 -- the validated
// pair StackedBar uses, and filled-against-outlined so the ribbon still
// reads without colour. Beneath it, icons only on the points that
// mattered: the lowest moment, each time the lead changed hands, each
// game point, and the finish. Everything else is left quiet.
//
// Tap (or arrow to) any block for its score in the readout above. One
// tab stop for the whole ribbon, not twenty-six: arrow keys move along
// it, the way a slider does.
//
// The blocks rise in one after another when the ribbon is scrolled to,
// then the icons appear -- once, and not at all for reduced motion.
// ============================================================

import { useRef, useState } from 'react'
import Icon from './Icon'
import { useInView } from '../lib/motion'

/** The one icon a point gets, if any -- most important first. */
function markOf(moment, i, { last, lowIndex }) {
  if (i === last) return { icon: 'star', label: 'final point' }
  if (i === lowIndex) return { icon: 'arrowDown', label: 'lowest point' }
  if (moment.gamePoint) return { icon: 'flag', label: 'game point' }
  if (moment.leadChange) return { icon: 'swap', label: 'lead changes hands' }
  return null
}

function describe(moment, i, context) {
  const tags = []
  const mark = markOf(moment, i, context)
  if (mark) tags.push(mark.label)
  if (moment.level && mark?.icon !== 'swap') tags.push('level')
  if (moment.leadChange && mark?.icon !== 'swap') tags.push('lead changes hands')
  if (moment.gamePoint && mark?.icon !== 'flag') tags.push('game point')
  return tags
}

/**
 * @param {object} props
 * @param {Array<{scorer, leadChange, level, gamePoint}>} props.moments
 * @param {Array<{winners, losers}>} props.path - score after each point
 * @param {(point) => string} props.asShown - a score, the page's way round
 * @param {string} props.winners - names, for the legend and labels
 * @param {string} props.losers
 * @param {number | null} props.lowIndex - the winners' lowest point
 */
function MomentumRibbon({ moments, path, asShown, winners, losers, lowIndex }) {
  const ref = useRef(null)
  const inView = useInView(ref)
  const [selected, setSelected] = useState(null)
  const buttons = useRef([])

  const last = moments.length - 1
  const context = { last, lowIndex }
  const nameOf = (scorer) => (scorer === 'winners' ? winners : losers)

  function choose(i) {
    const next = Math.max(0, Math.min(last, i))
    setSelected(next)
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

  const readout =
    selected === null
      ? 'Tap a point to see the score'
      : [
          asShown(path[selected]),
          `${nameOf(moments[selected].scorer)} point`,
          ...describe(moments[selected], selected, context),
        ].join(' · ')

  return (
    <div ref={ref} className={`ribbon${inView ? ' is-in' : ''}`}>
      <div className="ribbon-legend">
        <span><i className="ribbon-swatch is-winners" aria-hidden="true" />{winners}</span>
        <span><i className="ribbon-swatch is-losers" aria-hidden="true" />{losers}</span>
      </div>

      <p className="ribbon-readout" aria-live="polite">{readout}</p>

      <div
        className="ribbon-blocks"
        role="group"
        aria-label="Every point in order"
        style={{ '--points': moments.length }}
        onKeyDown={onKeyDown}
      >
        {moments.map((moment, i) => (
          <button
            key={i}
            ref={(el) => { buttons.current[i] = el }}
            type="button"
            className={`ribbon-block is-${moment.scorer}${selected === i ? ' is-selected' : ''}`}
            style={{ '--i': i }}
            // One tab stop for the whole ribbon: the chosen block, or the
            // first before anything is chosen.
            tabIndex={i === (selected ?? 0) ? 0 : -1}
            aria-label={`Point ${i + 1}, ${asShown(path[i])}, ${nameOf(moment.scorer)}`}
            aria-pressed={selected === i}
            onClick={() => choose(i)}
          />
        ))}
      </div>

      <div className="ribbon-marks" style={{ '--points': moments.length }} aria-hidden="true">
        {moments.map((moment, i) => {
          const mark = markOf(moment, i, context)
          const scored = i === last || i === lowIndex
          return (
            <span key={i} className="ribbon-mark" style={{ '--i': i }}>
              {mark && <Icon name={mark.icon} size={14} className={`ribbon-icon is-${mark.icon}`} />}
              {scored && <span className="ribbon-score">{asShown(path[i])}</span>}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export default MomentumRibbon
