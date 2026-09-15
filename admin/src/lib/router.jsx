// ============================================================
// A tiny path router, the same approach as the player app's: a handful
// of pages needs no routing library. The host serves index.html for
// unknown paths, so /setup/<secret> opens straight from a link.
// ============================================================

import { useCallback, useSyncExternalStore } from 'react'

const listeners = new Set()

function subscribe(listener) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

export function useRoute() {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/')
}

export function navigate(to, { replace = false } = {}) {
  if (to === window.location.pathname) return
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to)
  for (const listener of listeners) listener()
}

/** Matches '/setup/:secret' style patterns; returns the params or null. */
export function matchPath(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = path.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null
  const params = {}
  for (let i = 0; i < patternParts.length; i += 1) {
    if (patternParts[i].startsWith(':')) params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i])
    else if (patternParts[i] !== pathParts[i]) return null
  }
  return params
}

/** A real anchor, so keyboard focus and open-in-new-tab keep working. */
export function Link({ to, children, className, ...rest }) {
  const onClick = useCallback((event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }, [to])
  return <a href={to} className={className} onClick={onClick} {...rest}>{children}</a>
}
