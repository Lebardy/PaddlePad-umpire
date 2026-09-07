// The four rally-ending buttons, in one place.
//
// LiveMatch draws them and Guide explains them, and they used to hold
// a copy of this list each -- which is exactly how a guide ends up
// describing buttons that have since changed. The (outcome, zone) pair
// is what addRallyEvent files into the ML stat buckets; `won` and
// `dink` are the same two facts said in the words a person reading the
// legend needs, so the 2x2 can be built from this list rather than
// written out again by hand.
//
// The ORDER is the on-screen button order. describeEvent also finds a
// label by matching outcome + zone, so nothing here is free to move.
export const OUTCOMES = [
  {
    outcome: 'winner',
    zone: 'open',
    label: 'Clean Winner',
    won: true,
    dink: false,
    help: 'They hit the shot that won the rally, and it was not a dink.',
  },
  {
    outcome: 'winner',
    zone: 'dink',
    label: 'Dink Winner',
    won: true,
    dink: true,
    help: 'They won it with a soft shot at the net.',
  },
  {
    outcome: 'error',
    zone: 'open',
    label: 'Unforced Error',
    won: false,
    dink: false,
    help: 'They ended the rally by missing — long, wide, or into the net — on anything other than a dink.',
  },
  {
    outcome: 'error',
    zone: 'dink',
    label: 'Dink Error',
    won: false,
    dink: true,
    help: 'They missed a soft shot at the net.',
  },
]

// The whole rule in one line. Everything else is this said slower.
export const RALLY_RULE =
  'Tap under whoever hit the last shot of the rally. Won it → Winner. Lost it → Error. If that shot was a soft one at the net, use the Dink button.'

export const THIRD_SHOT_RULE =
  'Only the serving side gets these, and only for their third shot of the rally. Drop ✓ it landed soft at the net, Drop ✗ they tried and missed it, Drive they hit it hard instead. Separate from how the rally ended — one rally can have both.'

/** The one outcome matching a won/dink combination, for the 2×2. */
export function outcomeFor(won, dink) {
  return OUTCOMES.find((o) => o.won === won && o.dink === dink)
}
