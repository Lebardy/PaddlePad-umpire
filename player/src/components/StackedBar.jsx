// ============================================================
// A part-to-whole bar with two categorical series.
//
// Extracted from ShotProfile so a single match can be described in
// exactly the same visual language as a whole career. Two different
// looking charts for "your winning shots" and the same for one match
// would make the app feel assembled rather than designed.
//
// Colours come from --series-1/--series-2 in index.css, which are a
// validated pair -- see the note there before substituting anything by
// eye.
// ============================================================

function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : 0
}

function StackedBar({ segments, total }) {
  return (
    <>
      <div
        className="stack"
        role="img"
        aria-label={segments
          .map((s) => `${s.label}: ${s.value} of ${total}`)
          .join(', ')}
      >
        {segments.map((segment) =>
          segment.value > 0 ? (
            <span
              key={segment.label}
              className={`stack-seg ${segment.className}`}
              style={{ width: `${pct(segment.value, total)}%` }}
            />
          ) : null,
        )}
      </div>

      {/* Legend AND direct values: with two series, identity must never
          rest on colour alone. */}
      <ul className="stack-legend">
        {segments.map((segment) => (
          <li key={segment.label}>
            <span className={`swatch ${segment.className}`} aria-hidden="true" />
            <span className="legend-label">{segment.label}</span>
            <span className="legend-value">{segment.value}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

export default StackedBar
