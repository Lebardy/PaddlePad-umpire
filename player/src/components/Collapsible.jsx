// ============================================================
// A section that opens and closes in place, smoothly.
//
// For longer proof -- a table of numbers -- that should be one tap away
// rather than always on screen. Unlike <More>, which holds a sentence
// or two of WHY, the title here names the content and a one-line
// summary stays visible while it is closed, so a closed section still
// says something.
//
// The height animates through a one-row grid going from 0fr to 1fr,
// which needs no measuring and follows the content if it changes. The
// rows inside fade and rise in turn (--i). Everything is instant for
// anyone who asked their device for less motion; see App.css.
// ============================================================

import { useId, useState } from 'react'
import Icon from './Icon'

function Collapsible({ title, summary = null, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  return (
    <div className={`collapsible${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="collapsible-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="collapsible-title">{title}</span>
        <span className="collapsible-chevron" aria-hidden="true">
          <Icon name="chevron" size={18} />
        </span>
      </button>
      {summary && <div className="collapsible-summary">{summary}</div>}
      <div id={bodyId} className="collapsible-body" inert={open ? undefined : ''}>
        <div className="collapsible-inner">{children}</div>
      </div>
    </div>
  )
}

export default Collapsible
