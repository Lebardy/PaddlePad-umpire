// ============================================================
// The six-corner fingerprint of a playstyle.
//
// Each corner is a word. Half way out is everyone's average; further out
// is more of that word. A corner whose word is in the player's style name
// is boxed, so the name can be read off the chart. The amber shape is the
// average of everyone with the same style, the blue line is the player.
// ============================================================

import { outline, reach } from '../lib/fingerprint'

const BOX = { cx: 195, cy: 190, r: 92 }
const RINGS = [0.25, 0.75, 1]
const flat = (k) => outline(Array(6).fill(k), BOX)
// Label spots: the viewBox is 390 wide and 296 tall starting at y 50.
const place = (i) => {
  const a = ((-90 + i * 60) * Math.PI) / 180
  const side = i === 0 || i === 3 ? 'mid' : i < 3 ? 'right' : 'left'
  const gap = side === 'mid' ? 20 : 6
  const x = BOX.cx + BOX.r * Math.cos(a) + (side === 'right' ? gap : side === 'left' ? -gap : 0)
  const y = BOX.cy + BOX.r * Math.sin(a) + (side === 'mid' ? (i === 0 ? -gap : gap) : 0)
  return { side, style: { left: `${(x / 390) * 100}%`, top: `${((y - 50) / 296) * 100}%` } }
}

function Fingerprint({ corners }) {
  const youShape = outline(corners.map((c) => reach(c.you, c)), BOX)
  const hasStyle = corners.every((c) => typeof c.style === 'number')
  const styleShape = hasStyle ? outline(corners.map((c) => reach(c.style, c)), BOX) : null
  const named = corners.filter((c) => c.inName).map((c) => c.word)
  const list = named.length > 1 ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}` : named[0]
  const label = `Six corners. ${list ? `Your style reaches furthest on ${list}.` : 'Further out means more of the word.'}`

  return (
    <figure className="print">
      <div className="print-chart">
        <svg viewBox="0 50 390 296" role="img" aria-label={label}>
          {RINGS.map((k) => <polygon key={k} points={flat(k)} className="print-ring" />)}
          {corners.map((_, i) => {
            const [x, y] = outline([1, 1, 1, 1, 1, 1], BOX).split(' ')[i].split(',')
            return <line key={i} x1={BOX.cx} y1={BOX.cy} x2={x} y2={y} className="print-ring" />
          })}
          {styleShape && <polygon points={styleShape} className="print-style" />}
          <polygon points={youShape} className="print-you" />
          {youShape.split(' ').map((p, i) => {
            const [x, y] = p.split(',')
            return corners[i].you === null ? null : <circle key={i} cx={x} cy={y} r="3.5" className="print-dot" />
          })}
        </svg>
        {corners.map((c, i) => {
          const spot = place(i)
          return (
            <span
              key={c.word}
              className={`print-word is-${spot.side}${c.inName ? ' is-named' : ''}`}
              style={spot.style}
              title={c.you === null ? 'Nothing recorded yet' : undefined}
            >
              {c.word}
            </span>
          )
        })}
      </div>
      <figcaption className="print-legend">
        <span><i className="print-key key-you" />You</span>
        {styleShape && <span><i className="print-key key-style" />Your style average</span>}
        <span><i className="print-key key-name" />In your name</span>
        <small>Further out = more of the word shown.</small>
      </figcaption>
    </figure>
  )
}

export default Fingerprint
