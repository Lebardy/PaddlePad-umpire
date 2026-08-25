/** Formats a 0-1 ratio, or an em dash when there's nothing to divide by. */
function percent(value) {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`
}

/**
 * Headline numbers.
 *
 * Every figure here is either a raw count of taps or a ratio of them.
 * Nothing needs other players to exist to be true, which is what makes
 * it safe to show from the very first match -- unlike a rating.
 */
function StatGrid({ summary }) {
  const tiles = [
    { label: 'Matches', value: summary.matches },
    { label: 'Won', value: `${summary.wins}–${summary.losses}` },
    { label: 'Win rate', value: percent(summary.winRate) },
    { label: 'Winners', value: summary.totalWinners },
    { label: 'Errors', value: summary.totalErrors },
    {
      label: 'Drops landed',
      value: percent(summary.dropSuccessRate),
      // Zero attempts and zero successes look identical in a percentage,
      // so the count is what makes the number readable.
      note:
        summary.dropAttempts > 0
          ? `${summary.dropSuccesses} of ${summary.dropAttempts}`
          : 'none logged',
    },
  ]

  return (
    <section className="stat-grid">
      {tiles.map((tile) => (
        <div className="stat-tile" key={tile.label}>
          <span className="stat-value">{tile.value}</span>
          <span className="stat-label">{tile.label}</span>
          {tile.note && <span className="stat-note">{tile.note}</span>}
        </div>
      ))}
    </section>
  )
}

export default StatGrid
