// ============================================================
// "A match of yours is being scored right now."
//
// Lifted out of EmptyState so it can appear on the overview too. A
// player with history who is mid-match saw nothing at all before -- the
// one moment they are most likely to have the app open was the one
// moment it had nothing to say.
//
// role="status" so it is announced when it appears, and the pulsing dot
// stops under prefers-reduced-motion (see App.css).
// ============================================================

function LiveNote({ count }) {
  return (
    <div className="live-note" role="status">
      <span className="live-dot" aria-hidden="true" />
      <span>
        {count} {count === 1 ? 'match' : 'matches'} being scored now — results
        appear when it finishes
      </span>
    </div>
  )
}

export default LiveNote
