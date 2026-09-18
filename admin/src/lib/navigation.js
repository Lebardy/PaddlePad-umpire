// ============================================================
// The path-router's non-component pieces, kept apart from router.jsx
// so that file exports only components -- Fast Refresh needs that.
// ============================================================

import { useSyncExternalStore } from 'react'

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
    if (patternParts[i].startsWith(':')) {
      // Real secrets are base64url and never contain a '%', so this
      // only ever fires on a hand-mangled link -- treat it as no match
      // rather than letting decodeURIComponent's throw blank the page.
      try {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i])
      } catch {
        return null
      }
    } else if (patternParts[i] !== pathParts[i]) return null
  }
  return params
}
