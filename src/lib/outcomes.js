// How a rally can end, and the words the scoring screen and the guide
// use to explain it.
//
// The list itself lives in server/src/rally-endings.js, for the same
// deploy reason as pickleball.js: it is the one place both the app and
// the API can reach. LiveMatch draws buttons from it and Guide explains
// the same list, so neither can describe an ending the other lacks.

import { RALLY_ENDINGS } from '../../server/src/rally-endings.js'

export { RALLY_ENDINGS, rallyEnding, legacyRallyLabel } from '../../server/src/rally-endings.js'

/** Endings where the player tapped WON the rally with their shot. */
export const WINNING_ENDINGS = RALLY_ENDINGS.filter((ending) => ending.outcome === 'winner')

/** Endings where the player tapped LOST the rally with a fault. */
export const FAULT_ENDINGS = RALLY_ENDINGS.filter((ending) => ending.outcome === 'error')

// The whole rule in one line. Everything else is this said slower.
export const RALLY_RULE =
  'Tap what ended the rally, then the player who did it. An ace, a service fault or a foot fault can only be the server, so those count at once.'

export const THIRD_SHOT_RULE =
  'Serving side only, for their third shot. Drop ✓ landed soft at the net, Drop ✗ missed, Drive hit hard. Separate from how the rally ended: one rally can have both.'
