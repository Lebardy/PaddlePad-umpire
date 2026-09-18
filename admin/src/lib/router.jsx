// ============================================================
// A tiny path router, the same approach as the player app's: a handful
// of pages needs no routing library. The host serves index.html for
// unknown paths, so /setup/<secret> opens straight from a link.
// ============================================================

import { useCallback } from 'react'
import { navigate } from './navigation'

/** A real anchor, so keyboard focus and open-in-new-tab keep working. */
export function Link({ to, children, className, ...rest }) {
  const onClick = useCallback((event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }, [to])
  return <a href={to} className={className} onClick={onClick} {...rest}>{children}</a>
}
