import LampMark from './LampMark'

/** Sign-in and setup: the scoreboard on the left, the form on paper beside it. */
/** `site` is the word after PaddlePad: Admin, or Manager on a manager's setup link. */
export default function Gate({ site = 'Admin', children }) {
  return (
    <div className="gate">
      <div className="gate-board board-texture">
        <p className="gate-sign">
          <LampMark />
          <span>Paddle&shy;Pad</span>
          <span>{site}</span>
        </p>
        <p className="gate-foot">Invite codes for new umpires, the managers who make them, and a record of everything they do.</p>
      </div>
      <div className="gate-strip" aria-hidden="true" />
      <div className="gate-side">{children}</div>
    </div>
  )
}
