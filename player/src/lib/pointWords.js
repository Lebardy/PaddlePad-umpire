// What a tapped point box says about how the point was won: one plain
// sentence about the player who did it, the way a player would tell it.
// Past tense throughout, so "You" reads as naturally as a name.

const SENTENCES = {
  ace: 'served one they couldn’t return',
  putaway: 'hit a hard put-away',
  passing: 'hit it past them',
  lob: 'lobbed it over them',
  drop_winner: 'hit a soft drop they couldn’t reach',
  dink_winner: 'won it with a soft shot at the net',
  other_winner: 'hit a winning shot',
  out: 'hit it out',
  net: 'hit it into the net',
  dink_error: 'missed a soft shot at the net',
  kitchen: 'stepped into the kitchen',
  service: 'missed the serve',
  foot_fault: 'stepped over the line on the serve',
  two_bounce: 'hit it before the bounce',
  net_touch: 'touched the net',
  hit_by_ball: 'got hit by the ball',
  wrong_position: 'was in the wrong place to serve or receive',
  other_fault: 'made a mistake',
}

/** "Winning shot" or "Mistake": which side's doing the point was. */
export function pointKind(how) {
  return how === 'winner' ? 'Winning shot' : 'Mistake'
}

/**
 * "Jan hit it into the net", or null when there is no name to give. A
 * rally from before endings were recorded, or one this app does not
 * know yet, falls back to the plain winning shot or mistake.
 */
export function pointSentence({ how, ending, by, byYou = false }) {
  const who = byYou ? 'You' : by
  if (!who) return null
  const fallback = how === 'winner' ? SENTENCES.other_winner : SENTENCES.other_fault
  return `${who} ${SENTENCES[ending] ?? fallback}`
}
