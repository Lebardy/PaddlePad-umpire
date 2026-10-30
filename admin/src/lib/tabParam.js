import { useState } from 'react'

/** The tab named in the address, if it is one of `allowed`; else `fallback`. */
export function readTab(search, allowed, fallback) {
  const asked = new URLSearchParams(search).get('tab')
  return allowed.includes(asked) ? asked : fallback
}

/**
 * The open tab, kept in the address so a reload or Back keeps the place.
 * Replaces the entry rather than adding one: a tab click is not a page.
 * The first fallback that arrives is kept, so a session starting later
 * never moves the admin to another tab.
 */
export function useTabParam(allowed, fallback) {
  const [picked, setPicked] = useState(() => readTab(window.location.search, allowed, null))
  const [first, setFirst] = useState(fallback)
  if (first === null && fallback !== null) setFirst(fallback)
  function setTab(id) {
    const params = new URLSearchParams(window.location.search)
    params.set('tab', id)
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params}`)
    setPicked(id)
  }
  return [picked ?? first, setTab]
}
