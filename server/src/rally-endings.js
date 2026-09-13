// ============================================================
// Every way a rally can end, in one list.
//
// An umpire used to pick one of four buttons -- clean winner, dink
// winner, unforced error, dink error -- under the player who hit the
// last shot. Watching real games showed that throws away what actually
// happened: "went out", "into the net" and "stepped in the kitchen" are
// three different habits, and all three were filed as one mistake.
//
// So a rally now records WHAT ended it (`detail`, a key from this list)
// as well as the two facts the four buttons used to record. Those two
// facts are not dropped: every ending below still names its `outcome`
// and `zone`, so the stat buckets, the ML export's existing columns and
// the player app all keep working exactly as before, and a rally logged
// by an older copy of the app (no detail at all) is still a valid rally.
//
// Lives under server/ for the same deploy reason as pickleball.js: the
// API is built from this directory alone, and src/lib/rally-endings.js
// re-exports it so both sides read one copy.
//
// This is deliberately a WIDE list to experiment with on court. Trim it
// once real nights show which endings umpires actually reach for --
// removing a key from here stops new taps using it, and old rallies
// that carry it still count in their bucket.
// ============================================================

/**
 * `outcome` and `zone` choose the stat bucket exactly as before:
 * winner+open clean_winners, winner+dink dink_winners, error+open
 * unforced_errors, error+dink dink_errors.
 *
 * `by: 'server'` marks an ending only the player serving can cause, so
 * the app can credit them without asking who it was.
 */
export const RALLY_ENDINGS = [
  // ---- Won with a shot: credited to whoever hit it ----
  {
    key: 'ace',
    label: 'Ace',
    help: 'The serve landed in and the receiver never touched it.',
    outcome: 'winner',
    zone: 'open',
    by: 'server',
  },
  {
    key: 'putaway',
    label: 'Put-away',
    help: 'A hard, attacking shot (a smash or a volley) the other side could not return.',
    outcome: 'winner',
    zone: 'open',
  },
  {
    key: 'passing',
    label: 'Passing shot',
    help: 'Hit past an opponent, down the line or through the middle.',
    outcome: 'winner',
    zone: 'open',
  },
  {
    key: 'lob',
    label: 'Lob',
    help: 'Hit high over an opponent at the net, and it landed in.',
    outcome: 'winner',
    zone: 'open',
  },
  {
    key: 'drop_winner',
    label: 'Drop winner',
    help: 'A soft shot from the back that dropped in and could not be reached.',
    outcome: 'winner',
    zone: 'open',
  },
  {
    key: 'dink_winner',
    label: 'Dink winner',
    help: 'Won with a soft shot at the net.',
    outcome: 'winner',
    zone: 'dink',
  },
  {
    key: 'other_winner',
    label: 'Other winner',
    help: 'Any other shot that won the rally outright.',
    outcome: 'winner',
    zone: 'open',
  },

  // ---- Lost by a fault: credited to whoever made it ----
  {
    key: 'out',
    label: 'Out of bounds',
    help: 'Their shot landed long or wide.',
    outcome: 'error',
    zone: 'open',
  },
  {
    key: 'net',
    label: 'Into the net',
    help: 'Their shot did not clear the net.',
    outcome: 'error',
    zone: 'open',
  },
  {
    key: 'dink_error',
    label: 'Missed dink',
    help: 'A soft shot at the net that went out or into the net.',
    outcome: 'error',
    zone: 'dink',
  },
  {
    key: 'kitchen',
    label: 'Kitchen fault',
    help: 'They volleyed while standing in the no-volley zone, or stepped into it straight after.',
    outcome: 'error',
    zone: 'open',
  },
  {
    key: 'service',
    label: 'Service fault',
    help: 'The serve went out, into the net, or into the wrong box.',
    outcome: 'error',
    zone: 'open',
    by: 'server',
  },
  {
    key: 'foot_fault',
    label: 'Foot fault',
    help: 'The server stepped on or over the baseline while serving.',
    outcome: 'error',
    zone: 'open',
    by: 'server',
  },
  {
    key: 'two_bounce',
    label: 'Two-bounce fault',
    help: 'The return or the third shot was volleyed before it had bounced.',
    outcome: 'error',
    zone: 'open',
  },
  {
    key: 'net_touch',
    label: 'Touched the net',
    help: 'Their paddle, body or clothing touched the net while the ball was in play.',
    outcome: 'error',
    zone: 'open',
  },
  {
    key: 'hit_by_ball',
    label: 'Hit by the ball',
    help: 'The ball struck them before it bounced.',
    outcome: 'error',
    zone: 'open',
  },
  {
    key: 'wrong_position',
    label: 'Wrong server or receiver',
    help: 'The wrong player served or returned.',
    outcome: 'error',
    zone: 'open',
  },
  {
    key: 'other_fault',
    label: 'Other fault',
    help: 'Any other fault that lost them the rally.',
    outcome: 'error',
    zone: 'open',
  },
]

const BY_KEY = new Map(RALLY_ENDINGS.map((ending) => [ending.key, ending]))

/** The ending with this key, or undefined. */
export function rallyEnding(key) {
  return BY_KEY.get(key)
}

/** The same four labels the buttons used to carry, for older rallies. */
export function legacyRallyLabel(outcome, zone) {
  if (outcome === 'winner') return zone === 'dink' ? 'Dink winner' : 'Clean winner'
  return zone === 'dink' ? 'Dink error' : 'Unforced error'
}

/**
 * Why a rally event's detail is unacceptable, or null when it is fine.
 *
 * A missing detail is fine: every rally logged before this list existed
 * has none. A detail that is present must be a known key AND agree with
 * the outcome and zone sent beside it -- otherwise a rally could claim
 * "out of bounds" while crediting a winner, and the stat bucket and the
 * detail would tell two different stories about the same point.
 */
export function rallyEndingProblem(event) {
  if (event.detail === undefined) return null
  const ending = BY_KEY.get(event.detail)
  if (!ending) return `unknown rally ending ${JSON.stringify(event.detail)}`
  if (ending.outcome !== event.outcome || ending.zone !== event.zone) {
    return `rally ending ${event.detail} must be ${ending.outcome}/${ending.zone}`
  }
  return null
}

/** The export column holding each ending's per-player count. */
export function rallyEndingColumn(key) {
  return `ended_${key}`
}
