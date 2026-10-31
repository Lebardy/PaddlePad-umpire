// ============================================================
// How a main umpire's ruling changes the scorekeeper's log.
//
//   node server/scripts/check-scorekeeper-rules.mjs
//
// A ruling never changes score math: it removes the ruled rally (Replay,
// Overturned, Wrong winner) or leaves it (Stands), and always leaves a
// note the engine skips. Pure, so no database and no network.
// ============================================================

import { applyRuling, rallyWinnerTeam, rulingProblem, waitingReentry, TOO_LATE } from '../src/scorekeeper-rules.js'
import { deriveMatchState } from '../src/pickleball.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${expected}, got ${actual}`}`)
}

const teamA = ['a1']
const teamB = ['b1']
const rally = (id, actingPlayerId, outcome = 'winner') => ({ type: 'rally', id, at: 1, actingPlayerId, outcome, zone: 'open' })
const log = [rally('r1', 'a1'), rally('r2', 'b1', 'error')]
const match = (events) => ({ teamA, teamB, firstServer: { team: 'A', playerId: 'a1' }, events })

check('a winning shot gives the point to its own team', rallyWinnerTeam(teamA, rally('x', 'a1')), 'A')
check('a mistake gives the point to the other team', rallyWinnerTeam(teamA, rally('x', 'b1', 'error')), 'A')
check('the last rally may be ruled on', rulingProblem(log, 'r2'), null)
check('an earlier rally is too late', rulingProblem(log, 'r1'), TOO_LATE)
check('an unknown rally is too late', rulingProblem(log, 'nope'), TOO_LATE)
check('a third shot after the rally makes it too late', rulingProblem([...log, { type: 'thirdShot', id: 't' }], 'r2'), TOO_LATE)

const stands = applyRuling(log, { id: 'g1', targetEventId: 'r2', kind: 'stands' }, teamA, 5)
check('Stands keeps the rally', stands.events.length, 3)
check('Stands adds a ruling note last', stands.events.at(-1).type, 'ruling')
check('Stands asks for nothing', stands.reenterFor, null)

const replay = applyRuling(log, { id: 'g2', targetEventId: 'r2', kind: 'replay' }, teamA, 5)
check('Replay removes the rally (note takes its place)', replay.events.length, 2)
check('Replay keeps what the rally was', replay.events.at(-1).was.actingPlayerId, 'b1')
check('Replay asks for nothing', replay.reenterFor, null)

const over = applyRuling(log, { id: 'g3', targetEventId: 'r2', kind: 'overturned' }, teamA, 5)
check('Overturned asks for the rally again, won by the other team', over.reenterFor, 'B')
check('the log now waits for that re-entry', waitingReentry(over.events, teamA), 'B')
check('Wrong winner behaves like Overturned',
  applyRuling(log, { id: 'g4', targetEventId: 'r2', kind: 'wrongWinner' }, teamA).reenterFor, 'B')
check('a re-entered rally ends the wait', waitingReentry([...over.events, rally('r3', 'b1')], teamA), null)
check('a ruling on a stale rally is refused', applyRuling(log, { id: 'g5', targetEventId: 'r1', kind: 'replay' }, teamA).refused, TOO_LATE)
check('a note is not a rally, so it cannot be ruled on again', rulingProblem(stands.events, 'g1'), TOO_LATE)

// The engine must not see the notes at all.
const plain = deriveMatchState(match(log))
const noted = deriveMatchState(match(stands.events))
check('the score is the same with a Stands note', `${noted.score.A}-${noted.score.B}`, `${plain.score.A}-${plain.score.B}`)
const replayed = deriveMatchState(match(replay.events))
check('Replay scores as if the rally never happened', `${replayed.score.A}-${replayed.score.B}`,
  (() => { const s = deriveMatchState(match([log[0]])).score; return `${s.A}-${s.B}` })())

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
