// ============================================================
// The point picked in the boxes below a chart, lit up on its line.
//
// A dot on the line, and a see-through column one point wide running
// the full height of the chart, so the point stands out wherever it
// sits. Ordinary HTML laid over the chart rather than SVG inside it,
// because the charts are stretched to fit and a circle drawn inside a
// stretched SVG comes out as an oval.
//
// The chart is split into equal slots with each point in the middle of
// its own, so every column is the same width and centred on its point.
// Positions are percentages of the chart's box.
// ============================================================

/**
 * @param {object} props
 * @param {number} props.slot - which slot the point sits in, from 0
 * @param {number} props.slots - how many slots the chart is split into
 * @param {number} props.top - down the chart to the line, 0–100
 */
function PointMark({ slot, slots, top }) {
  const width = 100 / slots
  return (
    <>
      <span
        className="pmark-column"
        style={{ left: `${slot * width}%`, width: `${width}%` }}
        aria-hidden="true"
      />
      <span className="pmark-dot" style={{ left: `${(slot + 0.5) * width}%`, top: `${top}%` }} aria-hidden="true" />
    </>
  )
}

/**
 * The dotted middle line, where the score is level, running from the
 * first point to the last like the line itself rather than past it into
 * the half slot at either end. Dotted, and drawn in HTML: a dotted line
 * inside the stretched SVG would have its dots stretched into dashes.
 */
export function ChartLevel({ slots }) {
  const inset = `${50 / slots}%`
  return <span className="chart-level" style={{ left: inset, right: inset }} aria-hidden="true" />
}

export default PointMark
