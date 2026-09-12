// ============================================================
// What the model expected, before the match was played.
//
// A win is a win on the Matches screen, which is the one thing a
// result screen should not say: beating someone stronger than you and
// beating someone weaker are different achievements, and the model
// already knows which was which.
//
// TWO RULES SHAPE EVERYTHING HERE.
//
// 1. Only what was knowable BEFOREHAND. The expectation is read from
//    the newest rating run that finished BEFORE the match ended, never
//    the current one. A run computed afterwards has already seen this
//    match, so using it would be marking the model's own homework --
//    and the match itself would be part of the reason it "expected"
//    the result. A match played before any run existed gets no claim
//    at all.
//
// 2. NO NUMBERS ABOUT ANYONE ELSE. This is the same privacy line the
//    rest of the app draws, and it bites harder here. In doubles a
//    team average is two people, one of whom is the asking player, so
//    publishing "your side was rated 8 below theirs" would hand over
//    their partner's rating by subtraction. So nothing leaves here but
//    a verdict in words. Which side was favoured is unavoidably
//    implied -- that is the whole feature -- but no figure is.
//
// IS THERE ANYTHING BEHIND IT? Checked before this was written, over
// every completed match on the staging pool that had a rating run
// before it: 60 usable matches, and the higher-rated side won 41 of
// them, 68%. It grades the way it should, too -- near-level matches
// were a coin flip while gaps above 10 points won 8 or 9 times in 10.
// So the claim is worth making. The bands below come from that spread
// and deserve rechecking as real matches accumulate; the numbers are
// deliberately in one place so that is a one-line change.
// ============================================================

// Rating points between the two sides' averages.
//
// Below EVEN_WITHIN the sides are level as far as the model can tell,
// and the honest thing is to say so rather than to name a favourite on
// a fraction of a point. Above CLEAR_GAP the favourite won about four
// times in five, which is worth saying more strongly.
export const EVEN_WITHIN = 6
export const CLEAR_GAP = 15

function average(values) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null
}

/**
 * One side's rating, or null if anybody on it was unrated.
 *
 * All-or-nothing on purpose: averaging the one rated player of a pair
 * would describe a different team from the one that played.
 */
export function sideRating(playerIds, scores) {
  const known = playerIds.map((id) => scores.get(id)).filter(Number.isFinite)
  return known.length === playerIds.length ? average(known) : null
}

/**
 * What was expected of this match, from one player's side.
 *
 * @param {number|null} yours your side's average rating beforehand
 * @param {number|null} theirs their side's
 * @param {boolean|null} won whether your side went on to win
 * @returns {null | {expected, margin, upset}}
 *   expected: 'win' | 'loss' | 'even'
 *   margin:   'clear' | 'slight' | null   (null when even)
 *   upset:    true when the result went against a NON-even expectation
 */
export function expectationFor(yours, theirs, won) {
  if (!Number.isFinite(yours) || !Number.isFinite(theirs)) return null

  const gap = yours - theirs
  const size = Math.abs(gap)

  if (size < EVEN_WITHIN) {
    // No favourite, so no upset is possible -- a result that was a coin
    // flip beforehand cannot have gone against expectation.
    return { expected: 'even', margin: null, upset: false }
  }

  const expected = gap > 0 ? 'win' : 'loss'
  const margin = size >= CLEAR_GAP ? 'clear' : 'slight'

  return {
    expected,
    margin,
    // A match stopped at a tied score has no winner, and so cannot be
    // an upset either.
    upset: won === null ? false : (expected === 'win') !== won,
  }
}
