// Where a corner's point sits on the fingerprint: half way out is
// everyone's average, and each spread past it moves a quarter of the way,
// towards the corner's word. Clipped so nobody falls off the chart or
// vanishes into the middle.
export function reach(value, corner) {
  if (value === null || value === undefined || !corner.spread) return null
  const z = ((value - corner.mean) / corner.spread) * (corner.out === 'lower' ? -1 : 1)
  return Math.min(1, Math.max(0.06, 0.5 + 0.25 * z))
}

/** The style shape shows when any corner has a style value; a corner without one sits at the average. */
export const hasStyle = (corners) => corners.some((c) => typeof c.style === 'number')

/** SVG points for six corners clockwise from the top; a missing reach sits at the average. */
export function outline(reaches, { cx, cy, r }) {
  return reaches
    .map((k, i) => {
      const a = ((-90 + i * 60) * Math.PI) / 180
      const d = r * (k ?? 0.5)
      return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`
    })
    .join(' ')
}

/**
 * Where a corner's word sits, in the chart's own units. Top and bottom
 * words go above and below their corner; the four slanted corners' words
 * also go above (top pair) or below (bottom pair), pushed outward so a
 * long word clears the hexagon's edge instead of crowding the side.
 */
export function labelSpot(i, { cx, cy, r }) {
  const a = ((-90 + i * 60) * Math.PI) / 180
  const x = cx + r * Math.cos(a)
  const y = cy + r * Math.sin(a)
  if (i === 0) return { x, y: y - 20 }
  if (i === 3) return { x, y: y + 20 }
  const out = Math.sign(Math.cos(a)) * 36
  return { x: x + out, y: y + (Math.sin(a) < 0 ? -32 : 32) }
}
