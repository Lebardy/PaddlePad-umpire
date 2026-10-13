/**
 * What happens when a player's phone asks to film a match.
 *
 *   'take'      nobody holds it, or the phone that did has gone silent: it is this phone's
 *   'mine'      this phone already holds it
 *   'facility'  the facility films here, or its video is on the match already
 *   'player'    another phone holds it
 *
 * `held` is the match's video row as the claim reads it, or null:
 * { source, state, device_id, player_id, silent }.
 */
export function playerClaimVerdict({ filmsMatches, held, playerId, deviceId }) {
  // The facility's video is the one kept, so a player never films where it films.
  if (filmsMatches || held?.source === 'facility') return 'facility'
  if (!held) return 'take'
  if (held.state === 'filming' && held.player_id === playerId && held.device_id === deviceId) return 'mine'
  // Only a filming claim can be taken over: a video being sent or finished stays.
  return held.state === 'filming' && held.silent ? 'take' : 'player'
}
