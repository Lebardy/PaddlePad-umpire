// What the umpire app calls each rally ending, said the way a player
// would say it. The umpire app keeps the short technical labels.
const PHRASES = {
  ace: 'Serves they couldn’t return',
  putaway: 'Hard put-away shots',
  passing: 'Shots past your opponent',
  lob: 'Lobs over your opponent',
  drop_winner: 'Soft drops they couldn’t reach',
  dink_winner: 'Soft shots at the net',
  other_winner: 'Other winning shots',
  out: 'Hitting out',
  net: 'Hitting into the net',
  dink_error: 'Missed soft shots at the net',
  kitchen: 'Stepping into the kitchen',
  service: 'Missed serves',
  foot_fault: 'Stepping over the line on serve',
  two_bounce: 'Hitting before the bounce',
  net_touch: 'Touching the net',
  hit_by_ball: 'Getting hit by the ball',
  wrong_position: 'Wrong server or receiver',
  other_fault: 'Other mistakes',
}

export function endingPhrase(key) {
  return PHRASES[key] ?? 'Other rallies'
}
