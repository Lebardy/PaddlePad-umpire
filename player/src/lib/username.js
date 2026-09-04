/**
 * Turns a display name into a username worth offering.
 *
 * Picking a handle is the one step an account adds over a claim code, so
 * every form that asks for one arrives already filled rather than empty.
 * Two of them do now -- the create panel on the gate and the setup
 * prompt after claiming -- which is why this lives here instead of
 * beside either.
 *
 * Mirrors the server's rule in validate.js. If the two ever drift the
 * server is right, and the worst case is a suggestion the player edits.
 */
export function suggestUsername(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 20)
}
