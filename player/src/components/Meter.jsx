// ============================================================
// One ratio against its limit, on a same-hue track.
//
// Extracted from ShotProfile so a single match can show its drop success
// the same way the career view does.
//
// A meter rather than a two-slice pie: it is faster to read and, more
// importantly, comparable between visits -- two meters stacked can be
// scanned against each other, two pies cannot.
//
// A null value means "no data", not zero, and renders as a dash. The
// server is careful to send null rather than 0 for exactly this reason
// (see summarisePlayer), and throwing that distinction away here would
// tell a player they landed 0% of their drops when they have not
// attempted one.
// ============================================================

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

export default Meter
