// ============================================================
// The See it loop: one sample rally followed through the three apps.
// Made-up players, labelled Sample on screen. Every number is what the
// real apps would show for this one rally, nothing more.
// ============================================================

import { ENDINGS } from './endings.js'

export const STEPS = [
  { id: 'tap', label: 'Umpire taps', ms: 3600 },
  { id: 'lands', label: 'On Rio’s phone', ms: 3200 },
  { id: 'star', label: 'Starred', ms: 2800 },
  { id: 'reel', label: 'Highlights', ms: 3600 },
  { id: 'rating', label: 'Rating', ms: 3600 },
]

export const SAMPLE = {
  label: 'Sample',
  player: 'Rio',
  opponent: 'Dani',
  ending: 'Dink winner',
  before: [7, 5],
  after: [8, 5],
  stars: [2, 3],
  reel: { of: 3 },
  rating: 1709,
}

export const nextStep = (i) => (i + 1) % STEPS.length
export const prevStep = (i) => (i - 1 + STEPS.length) % STEPS.length

export function autoplays({ reducedMotion, onScreen, paused }) {
  return !reducedMotion && onScreen && !paused
}

// The game rally by rally, as the umpire logged it: who ended it, how, and
// when in the video. The umpire's Video list has one row per rally, side-outs
// included. Rally 21 is the sample rally (point 13, 7-5 to 8-5); the rest are
// how Rio took the game 11-6, which is what the match page shows once the
// match has ended. Whoever logged a winner won the rally; whoever logged a
// fault lost it. Rio serves first, and a rally the server loses only passes
// the serve (side-out scoring), so those rallies score nothing.
export const RALLIES = [
  { by: 'Dani', key: 'out', at: '00:21' },
  { by: 'Rio', key: 'dink_winner', at: '00:58' },
  { by: 'Dani', key: 'passing', at: '01:09' },
  { by: 'Dani', key: 'lob', at: '01:20' },
  { by: 'Dani', key: 'out', at: '01:36' },
  { by: 'Rio', key: 'passing', at: '01:52' },
  { by: 'Dani', key: 'dink_winner', at: '02:08' },
  { by: 'Rio', key: 'net', at: '02:25' },
  { by: 'Dani', key: 'drop_winner', at: '02:51' },
  { by: 'Dani', key: 'net', at: '03:10' },
  { by: 'Rio', key: 'drop_winner', at: '03:30' },
  { by: 'Dani', key: 'putaway', at: '03:46' },
  { by: 'Rio', key: 'dink_error', at: '04:02' },
  { by: 'Dani', key: 'dink_error', at: '04:16' },
  { by: 'Rio', key: 'dink_winner', at: '04:31' },
  { by: 'Rio', key: 'drop_winner', at: '05:30' },
  { by: 'Dani', key: 'drop_winner', at: '05:44' },
  { by: 'Dani', key: 'passing', at: '05:58' },
  { by: 'Dani', key: 'out', at: '06:09' },
  { by: 'Dani', key: 'net', at: '06:20' },
  { by: 'Rio', key: 'dink_winner', at: '06:48' },
  { by: 'Dani', key: 'lob', at: '07:01' },
  { by: 'Rio', key: 'net', at: '07:15' },
  { by: 'Dani', key: 'service', at: '07:26' },
  { by: 'Dani', key: 'out', at: '07:38' },
  { by: 'Dani', key: 'kitchen', at: '07:55' },
  { by: 'Rio', key: 'putaway', at: '08:15' },
]
// Who won each point, 1 = Rio, walking the serve: a winner is the logger's, a
// fault the other side's, and only the serving side scores.
const SCORED = (() => {
  let server = 'Rio'
  const won = []
  for (const r of RALLIES) {
    const winner = (r.by === 'Rio') === (ENDINGS.find((e) => e.key === r.key).outcome === 'winner') ? 'Rio' : 'Dani'
    if (winner === server) won.push(Number(winner === 'Rio'))
    else server = winner
  }
  return won
})()
// The points up to and including the sample rally (the player app's 13 boxes), then the rest.
export const POINTS = SCORED.slice(0, 13)
export const LATER = SCORED.slice(13)
// The points the umpire has starred, as boxes on the player's phone (1-based).
// The last is the sample rally, starred in step 3, so the star count goes 2 to 3.
export const STARRED = [4, 10, 13]
// The same rallies by their place in the umpire's list (1-based), the sample rally last.
export const STARRED_RALLIES = [6, 16, 21]
export const SAMPLE_RALLY = 21

// What Rio's phone says about this match once it is over. Rio and Dani
// start it on these ratings, and every rally moves points by the real
// rule (server/src/rally-rating.js: k x (1 - chance), all to the one who
// ended it in singles) plus the match reward; scripts/check-seeit.mjs
// replays the 27 rallies through that code and holds these numbers to it.
export const RATED = { rio: 1644, dani: 1647 }
export const ENDED = {
  cost: { rallies: 2, ppr: -17 },
  won: { rallies: 3, ppr: 23 },
}
