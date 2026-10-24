// ============================================================
// What a path says about the code panel.
//
// Plain JS, no React, so a check script can run it under node. The
// router reads window.location and hands the path in here.
//
// /claim/CODE is what a printed QR opens: the panel, filled. A bare
// /claim (or /claim/) is the landing page's "Have a code?" button:
// the panel, empty, so the player types the code an umpire gave them.
// ============================================================

export function claimFromPath(pathname) {
  const match = pathname.match(/^\/claim(?:\/(.*))?$/)
  if (!match) return { open: false, code: '' }
  return { open: true, code: match[1] ? decodeURIComponent(match[1]) : '' }
}
