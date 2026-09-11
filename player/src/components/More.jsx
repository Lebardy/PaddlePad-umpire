// ============================================================
// An explanation that waits to be asked for.
//
// The newest screens explained themselves in full sentences everywhere,
// and read as a wall of text. The rule now is a title, the numbers and
// at most one short line on show; anything that says WHY sits behind a
// small "i" and opens in place. Nothing is deleted -- the reasoning is
// one tap away for anyone who wants it.
//
// Native <details>/<summary>, so it opens with a tap, Enter or Space and
// is announced as expandable with no script at all.
// ============================================================

import Icon from './Icon'

function More({ label, children }) {
  return (
    <details className="more">
      <summary className="more-summary">
        <Icon name="info" size={16} />
        <span>{label}</span>
      </summary>
      <div className="more-body">{children}</div>
    </details>
  )
}

export default More
