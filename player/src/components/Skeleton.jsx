// ============================================================
// Loading placeholders.
//
// The ghost shapes were already drawn for the empty state, which shows
// a player what their page will hold before they have any matches. The
// real loading path meanwhile showed the words "Loading your matches…".
// Two vocabularies for the same idea, and the better one was on the
// screen fewer people see.
//
// So the ghosts live here now and both callers use them. Structure
// rather than fake numbers, for the same reason the empty state gives:
// the first thing a player learns about this app should not be that its
// figures can't be trusted.
// ============================================================

export function Ghost({ variant = 'line', style }) {
  return <span className={`ghost ghost-${variant}`} style={style} aria-hidden="true" />
}

/** The shape of a match row, for the list and the overview. */
export function MatchListSkeleton({ rows = 4 }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <Ghost variant="score" />
          <div className="skeleton-row-body">
            <Ghost variant="line" style={{ width: '60%' }} />
            <Ghost variant="line" style={{ width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** The shape of the overview: hero figure, stat tiles, then matches. */
export function OverviewSkeleton() {
  return (
    // One status announcement for the whole screen. Marking each shape
    // would have a screen reader read out a dozen meaningless nodes.
    <div className="skeleton" role="status" aria-label="Loading your matches">
      <Ghost variant="hero" />
      <Ghost variant="line" style={{ width: '45%' }} />
      <div className="skeleton-grid">
        <Ghost variant="tile" />
        <Ghost variant="tile" />
        <Ghost variant="tile" />
        <Ghost variant="tile" />
      </div>
      <MatchListSkeleton rows={3} />
    </div>
  )
}
