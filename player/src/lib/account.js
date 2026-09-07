// ============================================================
// "Can this person let themselves back in?"
//
// For a long time that was one field. A player either had a username
// and password, or had nothing but the claim code an umpire handed
// them — so every prompt, warning and standing offer in the app read
// `player.username` to tell the two apart, and reading the field WAS
// asking the question.
//
// Google is a third answer and a durable one, so those checks have to
// ask the question rather than name the field. Left as they were, a
// player who signs in with one tap would be nagged to pick a password,
// offered a setup card they do not need, and warned on the way out that
// they will need a code they may never have been given.
//
// Deliberately not "is registered" or "has an account": the thing every
// caller actually wants to know is whether signing out, clearing the
// browser or picking up a different phone would strand them.
// ============================================================

export function canReturnUnaided(player) {
  return Boolean(player?.username || player?.googleEmail)
}
