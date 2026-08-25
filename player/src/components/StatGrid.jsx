function percent(value) {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`
}

/**
 * A row of headline numbers.
 *
 * These are a handful of single values, so they are stat tiles rather
 * than a grouped bar chart -- reading four numbers should not require
 * decoding an axis.
 *
 * Values wear text tokens, never a series colour: a number is text, and
 * colouring it would imply a series identity that isn't there.
 */
function StatGrid({ summary }) {
  const tiles = [
    { label: 'Win rate', value: percent(summary.winRate), note: `${summary.wins} of ${summary.wins + summary.losses}` },
    { label: 'Winners', value: summary.totalWinners, note: 'points you finished' },
    { label: 'Errors', value: summary.totalErrors, note: 'points you gave away' },
    {
      label: 'Winners per error',
      // The single most telling ratio in the set: are you creating more
      // than you're giving away? Guarded so zero errors reads as a dash
      // rather than Infinity.
      value: summary.totalErrors > 0
        ? (summary.totalWinners / summary.totalErrors).toFixed(2)
        : summary.totalWinners > 0 ? '—' : '0',
      note: summary.totalErrors === 0 && summary.totalWinners > 0 ? 'no errors yet' : 'above 1.00 is good',
    },
  ]

  return (
    <section className="stat-grid" aria-label="Headline statistics">
      {tiles.map((tile) => (
        <div className="stat-tile" key={tile.label}>
          <span className="stat-value">{tile.value}</span>
          <span className="stat-label">{tile.label}</span>
          <span className="stat-note">{tile.note}</span>
        </div>
      ))}
    </section>
  )
}

export default StatGrid
