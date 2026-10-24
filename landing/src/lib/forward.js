// ============================================================
// Where this visit belongs.
//
// paddlepad.app used to be the player app, so printed QR codes
// (/claim/CODE), shared match links and home-screen icons all point
// here. Every path but / is the player app's, and goes there with its
// query and hash. / is this page -- unless it is running as an
// installed app, which can only be an old player-app icon.
//
// Inlined into index.html at build time (see vite.config.js) so it runs
// before anything loads. Keep it one function with no imports.
// ============================================================

export function forwardTarget(place, playerUrl) {
  if (!playerUrl) return null
  const home = place.pathname === '/' || place.pathname === '/index.html'
  if (home && !place.standalone) return null
  return playerUrl.replace(/\/$/, '') + (home ? '/' : place.pathname + place.search + place.hash)
}
