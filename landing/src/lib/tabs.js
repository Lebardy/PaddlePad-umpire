// The top board's tabs. Each has a hash so a link (or the footer) can
// open it, and the arrow keys move between them as the ARIA tabs
// pattern expects.
export const TABS = [
  { id: 'see-it', label: 'See it', icon: 'play' },
  { id: 'players', label: 'Players', icon: 'player' },
  { id: 'umpires', label: 'Umpires', icon: 'whistle' },
  { id: 'courts', label: 'Courts', icon: 'court' },
]

export function tabFromHash(hash) {
  const id = hash.replace(/^#/, '')
  return TABS.some((t) => t.id === id) ? id : TABS[0].id
}

export function tabAfterKey(current, key) {
  const i = TABS.findIndex((t) => t.id === current)
  const n = TABS.length
  if (key === 'ArrowRight') return TABS[(i + 1) % n].id
  if (key === 'ArrowLeft') return TABS[(i - 1 + n) % n].id
  if (key === 'Home') return TABS[0].id
  if (key === 'End') return TABS[n - 1].id
  return current
}
