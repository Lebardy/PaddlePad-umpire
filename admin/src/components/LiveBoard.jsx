/** The live board: what's going on right now, lit in lamp amber across the top of the page. */
export default function LiveBoard({ live }) {
  // On a quiet day three giant zeros filled the first screen and pushed
  // "Worth a look" -- the part an admin can act on -- below it. With no
  // session open the board says so in one line instead.
  if (live.sessions === 0) {
    return (
      <div className="live-board live-quiet">
        <span className="live-label"><i className="on-air is-off" aria-hidden="true" />Nothing live right now</span>
        <span className="live-quiet-note">No session is open. The board lights up when one starts.</span>
      </div>
    )
  }
  return (
    <div className="live-board">
      <div className="live-cell">
        <div className="live-label"><i className={`on-air${live.sessions === 0 ? ' is-off' : ''}`} aria-hidden="true" />Sessions going on</div>
        <div className={`live-figure${live.sessions === 0 ? ' is-zero' : ''}`}>{live.sessions}</div>
      </div>
      <div className="live-cell">
        <div className="live-label"><i className={`on-air${live.matches === 0 ? ' is-off' : ''}`} aria-hidden="true" />Matches being played</div>
        <div className={`live-figure${live.matches === 0 ? ' is-zero' : ''}`}>{live.matches}</div>
      </div>
      <div className="live-cell">
        <div className="live-label"><i className={`on-air${live.players === 0 ? ' is-off' : ''}`} aria-hidden="true" />Players at a session</div>
        <div className="live-split">
          <div className={`live-figure${live.players === 0 ? ' is-zero' : ''}`}>{live.players}</div>
          <div className="live-sub">{live.onCourt}<small>on court now</small></div>
        </div>
      </div>
    </div>
  )
}
