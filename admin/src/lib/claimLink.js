// What the claim QR holds. A link, when the player app's address is
// set, because a phone camera opens links but only shows plain text --
// the umpire app's QR has always been a link for the same reason. The
// bare code otherwise, so a local checkout without the setting still
// shows something a player can type.
export function claimQrText(code, playerUrl) {
  if (!playerUrl) return code
  return `${playerUrl.replace(/\/$/, '')}/claim/${encodeURIComponent(code)}`
}
