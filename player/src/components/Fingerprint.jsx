// ============================================================
// The six-corner fingerprint of a playstyle.
//
// Each corner is a word. Half way out is everyone's average; further out
// is more of that word. A corner whose word is in the player's style name
// is boxed, so the name can be read off the chart. The amber shape is the
// average of everyone with the same style, the blue line is the player.
// ============================================================

import { hasStyle, labelSpot, outline, reach } from '../lib/fingerprint'

const BOX = { cx: 195, cy: 190, r: 112 }
const RINGS = [0.25, 0.75, 1]
const flat = (k) => outline(Array(6).fill(k), BOX)
// The viewBox is 390 wide and 330 tall starting at y 36.
const place = (i) => {
  const { x, y } = labelSpot(i, BOX)
  return { left: `${(x / 390) * 100}%`, top: `${((y - 36) / 330) * 100}%` }
}

function Fingerprint({ corners, standout }) {
  const youReach = corners.map((c) => reach(c.you, c))
  const youShape = outline(youReach, BOX)
  const styleShape = hasStyle(corners) ? outline(corners.map((c) => reach(c.style, c)), BOX) : null
  const named = corners.filter((c) => c.inName).map((c) => c.word)
  const label = `Six corners. ${named.length ? `Words in your name: ${named.join(', ')}.` : 'Further out means more of the word.'}`
  const spokes = flat(1).split(' ')

  return (
    <figure className="print print-chart">
      <div className="print-plot">
        <svg viewBox="0 36 390 330" role="img" aria-label={label}>
          {RINGS.map((k) => <polygon key={k} points={flat(k)} className="print-ring" />)}
          {spokes.map((p, i) => {
            const [x, y] = p.split(',')
            return <line key={i} x1={BOX.cx} y1={BOX.cy} x2={x} y2={y} className="print-ring" />
          })}
          {styleShape && <polygon points={styleShape} className="print-style" />}
          <polygon points={youShape} className="print-you" />
          {youShape.split(' ').map((p, i) => {
            const [x, y] = p.split(',')
            return youReach[i] === null ? null : <circle key={i} cx={x} cy={y} r="3.5" className="print-dot" />
          })}
        </svg>
        {corners.map((c, i) => (
          <span
            key={c.word}
            className={`print-word${c.inName ? ' is-named' : ''}${c.feature === standout ? ' is-standout' : ''}`}
            style={place(i)}
            title={youReach[i] === null ? 'Nothing recorded yet' : undefined}
          >
            {c.word}
          </span>
        ))}
      </div>
      <figcaption className="print-legend">
        <span><i className="print-key key-you" />You</span>
        {styleShape && <span><i className="print-key key-style" />Your style average</span>}
        {named.length > 0 && <span><i className="print-key key-name" />In your name</span>}
        <small>Further out = more of the word shown.</small>
      </figcaption>
    </figure>
  )
}

export default Fingerprint
