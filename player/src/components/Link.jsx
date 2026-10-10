import { useCallback } from 'react'
import { navigate } from '../lib/router'

/**
 * An in-app link.
 *
 * Deliberately a real anchor with a real href rather than a button: it
 * gets keyboard focus, long-press-to-copy and the right screen-reader
 * role for free, and it still works if JavaScript hasn't hydrated.
 * Modifier-clicks and middle-clicks fall through to the browser so
 * "open in new tab" keeps working.
 *
 * `replace` swaps the current history entry instead of stacking a new
 * one. Use it when a link moves BETWEEN SIBLINGS rather than deeper in:
 * stepping match to match should not bury the list you opened them
 * from. It must be pulled out of the props rather than spread, or React
 * warns about an unknown attribute on the anchor.
 */
export function Link({ to, children, className, replace = false, ...rest }) {
  const onClick = useCallback(
    (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      event.preventDefault()
      navigate(to, { replace })
    },
    [to, replace],
  )

  return (
    <a href={to} className={className} onClick={onClick} {...rest}>
      {children}
    </a>
  )
}
