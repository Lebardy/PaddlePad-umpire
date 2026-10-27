// Where a corner's point sits on the fingerprint: half way out is
// everyone's average, and each spread past it moves a quarter of the way,
// towards the corner's word. Clipped so nobody falls off the chart or
// vanishes into the middle.
export function reach(value, corner) {
  if (value === null || value === undefined || !corner.spread) return null
  const z = ((value - corner.mean) / corner.spread) * (corner.out === 'lower' ? -1 : 1)
  return Math.min(1, Math.max(0.06, 0.5 + 0.25 * z))
}

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
