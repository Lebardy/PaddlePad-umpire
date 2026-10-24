// ============================================================
// The See it loop: one sample rally followed through the three apps.
// Made-up players, labelled Sample on screen. Every number is what the
// real apps would show for this one rally, nothing more.
// ============================================================

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
  dinks: [2, 3],
  stars: [2, 3],
  reel: { at: 1, of: 3 },
  rating: 1709,
}

export const nextStep = (i) => (i + 1) % STEPS.length
export const prevStep = (i) => (i - 1 + STEPS.length) % STEPS.length

export function autoplays({ reducedMotion, onScreen, paused }) {
  return !reducedMotion && onScreen && !paused
}

// The game point by point, 1 = Rio won it. Rio's 7 and Dani's 5 are the
// score before this rally; the last entry is the sample rally, point 13.
export const POINTS = [1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]
// The rallies the umpire has starred (1-based points). The last is the
// sample rally, starred in step 3, so the star count goes 2 to 3.
export const STARRED = [4, 10, 13]
