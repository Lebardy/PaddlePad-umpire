/**
 * How this player finishes points, and how they play the third shot.
 *
 * Two forms, chosen by what each piece of data is doing:
 *
 * - Winners split by where they were hit is PART-TO-WHOLE, so it is a
 *   horizontal stacked bar with two categorical series, each directly
 *   labelled and separated by a surface-coloured gap.
 * - Drop success is a single ratio against a limit, so it is a METER on
 *   a same-hue track -- not a two-slice pie, which would be slower to
 *   read and harder to compare between visits.
 *
 * Neither has a hover tooltip, and that is deliberate rather than an
 * omission. This is a phone-first app where hover does not exist, so a
 * tooltip would hide values from most of its readers. Every number is
 * directly labelled instead, which is what a tooltip would have shown
 * and is reachable by touch, keyboard and screen reader alike.
 */

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

function Meter({ label, value, caption }) {
  const filled = value === null ? 0 : Math.round(value * 100)
  return (
    <div className="meter-block">
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="meter-value">{value === null ? '—' : `${filled}%`}</span>
      </div>
      <div
        className="meter-track"
        role="img"
        aria-label={`${label}: ${value === null ? 'no data' : `${filled} percent`}`}
      >
        <span className="meter-fill" style={{ width: `${filled}%` }} />
      </div>
      <p className="meter-caption">{caption}</p>
    </div>
  )
}

function ShotProfile({ summary }) {
  const winnerTotal = summary.cleanWinners + summary.dinkWinners
  const thirdShots = summary.dropAttempts + summary.driveAttempts

  return (
    <section className="shot-profile" aria-label="Shot profile">
      <h2>How you win points</h2>

      {winnerTotal > 0 ? (
        <StackedBar
          total={winnerTotal}
          segments={[
            { label: 'Away from the net', value: summary.cleanWinners, className: 'seg-1' },
            { label: 'At the net (dinks)', value: summary.dinkWinners, className: 'seg-2' },
          ]}
        />
      ) : (
        <p className="muted-inline">No winners logged yet.</p>
      )}

      <div className="meters">
        <Meter
          label="Drops that landed"
          value={summary.dropSuccessRate}
          caption={
            summary.dropAttempts > 0
              ? `${summary.dropSuccesses} of ${summary.dropAttempts} third-shot drops`
              : 'No third shots logged yet'
          }
        />
        <Meter
          label="Drop over drive"
          value={summary.dropPreference}
          caption={
            thirdShots > 0
              ? `You chose the drop ${summary.dropAttempts} of ${thirdShots} times`
              : 'No third shots logged yet'
          }
        />
      </div>
    </section>
  )
}

export default ShotProfile
