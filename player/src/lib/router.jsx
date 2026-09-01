// ============================================================
// A tiny path router.
//
// Hand-rolled rather than react-router, which would be the app's first
// runtime dependency and larger than the routing it replaced. There are
// six route patterns here, no nested layouts, no data loaders, no server
// rendering -- nothing react-router exists to solve.
//
// Paths, not hashes. The claim flow already depends on the deploy
// serving index.html for unknown paths (a QR code opens /claim/CODE and
// Claim.jsx reads it off location.pathname), so history routing is
// already proven in production here.
// ============================================================

import { useCallback, useSyncExternalStore } from 'react'

const listeners = new Set()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

function getSnapshot() {
  return window.location.pathname
}

/**
 * The current path, as a subscription rather than component state.
 *
 * useSyncExternalStore matters here: pushState does NOT fire popstate,
 * so navigate() has to tell React itself. A useState/useEffect pair
 * would work most of the time and tear under StrictMode's double
 * invoke, which is exactly the kind of bug that only shows up in a
 * demo.
 */
export function useRoute() {
  return useSyncExternalStore(subscribe, getSnapshot, () => '/')
}

/**
 * Moves to a new path.
 *
 * The outgoing entry's scroll position is written into its history
 * state first, so going back to a long match list returns you to where
 * you were rather than to the top. Browsers do this for real navigations
 * and not for pushState, so it has to be done by hand.
 */
export function navigate(to, { replace = false } = {}) {
  if (to === window.location.pathname) return

  try {
    window.history.replaceState(
      { ...window.history.state, scrollY: window.scrollY },
      '',
      window.location.pathname,
    )
  } catch {
    // Some privacy modes throttle history writes. Losing the scroll
    // position is not worth failing the navigation over.
  }

  const method = replace ? 'replaceState' : 'pushState'
  window.history[method]({ scrollY: 0 }, '', to)
  notify()
}

/** The scroll position stored for the entry now being displayed. */
export function restoreScroll() {
  const y = window.history.state?.scrollY ?? 0
  window.scrollTo(0, y)
}

/**
 * Matches a pattern like '/matches/:id' against a path.
 *
 * @returns {object|null} the captured params, or null if it doesn't match
 */
/**
 * The claim code a QR landed on, or '' for any other URL.
 *
 * A QR encodes the claim URL rather than the raw code, so a phone's
 * camera opens it directly and no scanner is needed inside the app.
 * Lives here with the other reads of location, and is used in two
 * places: the code panel prefills from it, and the gate opens on that
 * panel because of it.
 */
export function claimCodeFromUrl() {
  const match = window.location.pathname.match(/^\/claim\/(.+)$/)
  return match ? decodeURIComponent(match[1]) : ''
}

export function matchPath(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null

  const params = {}
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i]
    const actual = pathParts[i]
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual)
    } else if (expected !== actual) {
      return null
    }
  }
  return params
}

/**
 * An in-app link.
 *
 * Deliberately a real anchor with a real href rather than a button: it
 * gets keyboard focus, long-press-to-copy and the right screen-reader
 * role for free, and it still works if JavaScript hasn't hydrated.
 * Modifier-clicks and middle-clicks fall through to the browser so
 * "open in new tab" keeps working.
 */
export function Link({ to, children, className, ...rest }) {
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
      navigate(to)
    },
    [to],
  )

  return (
    <a href={to} className={className} onClick={onClick} {...rest}>
      {children}
    </a>
  )
}
