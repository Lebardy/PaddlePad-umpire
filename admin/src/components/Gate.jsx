import LampMark from './LampMark'

/** Sign-in and setup: the scoreboard on the left, the form on paper beside it. */
export default function Gate({ children }) {
  return (
    <div className="gate">
      <div className="gate-board board-texture">
        <p className="gate-sign">
          <LampMark />
          <span>Paddle&shy;Pad</span>
          <span>Admin</span>
        </p>
        <p className="gate-foot">Invite codes for new umpires, the admins who make them, and a record of everything they do.</p>
      </div>
      <div className="gate-strip" aria-hidden="true" />
      <div className="gate-side">{children}</div>
    </div>
  )
}
