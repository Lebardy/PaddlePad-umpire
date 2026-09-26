// ============================================================
// Where an old admin address lives now.
//
// "People" was split into Players and Umpires, and "Invite codes" moved
// under Umpires as a tab. Old links and bookmarks are sent on rather
// than landing on "There's no page here."
// ============================================================

const MOVED = [
  [/^\/people$/, () => '/players'],
  [/^\/people\/umpires$/, () => '/umpires'],
  [/^\/people\/players\/([^/]+)$/, (id) => `/players/${id}`],
  [/^\/people\/umpires\/([^/]+)$/, (id) => `/umpires/${id}`],
  [/^\/invites$/, () => '/umpires/invites'],
]

/** The new address for an old one, or null when `path` has not moved. */
export function movedPath(path) {
  for (const [pattern, to] of MOVED) {
    const match = path.match(pattern)
    if (match) return to(...match.slice(1))
  }
  return null
}
