#!/usr/bin/env node
// ============================================================
// Did the third shot win the point?
//
//   node server/scripts/check-third-shot.mjs
//
// A third shot and the rally it opened are two separate lines in the
// log, and until rallies started naming the third shot they followed,
// nothing connected them -- so "does dropping actually win me points"
// could not be asked at all. These check that the connection is made
// where it should be, and NOT made where it should not.
//
// deriveMatchState is pure, so every case here is a hand-built event
// log and there is no database and no network.
// ============================================================

import { randomUUID } from 'node:crypto'
import { deriveMatchState } from '../src/pickleball.js'

let pass = 0
let fail = 0

function check(label, actual, expected, why) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label}` +
    (ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`) +
    `\n       ${why}`,
  )
}
const section = (title) => console.log(`\n${title}`)

const A1 = randomUUID(), A2 = randomUUID(), B1 = randomUUID(), B2 = randomUUID()

const thirdShot = (playerId, shotType, success = null) => ({
  type: 'thirdShot', id: randomUUID(), playerId, shotType, success,
})
/** A rally, optionally naming the third shot it followed. */
const rally = (actingPlayerId, outcome, opener = null) => ({
  type: 'rally',
  id: randomUUID(),
  actingPlayerId,
  outcome,
  zone: 'open',
  ...(opener ? { thirdShotId: opener.id } : {}),
})

const play = (events) =>
  deriveMatchState({
    teamA: [A1, A2],
    teamB: [B1, B2],
    firstServer: { team: 'A', playerId: A1 },
    rightStart: { A: 0, B: 0 },
    pointTarget: 11,
    events,
  })

/** The four conversion counters for one player. */
const conversion = (state, playerId) => {
  const s = state.stats[playerId]
  return [s.drop_rallies, s.drop_rallies_won, s.drive_rallies, s.drive_rallies_won]
}
const attempts = (state, playerId) => {
  const s = state.stats[playerId]
  return [s.drop_attempts, s.drop_successes, s.drive_attempts]
}

// ============================================================
section('a third shot is credited with the rally it opened')
// ============================================================
{
  // A1 drops, and the point ends with B1 making an error -> A's point.
  const drop = thirdShot(A1, 'drop', true)
  const state = play([drop, rally(B1, 'error', drop)])
  check('a drop that led to a won point', conversion(state, A1), [1, 1, 0, 0],
    'the rally was won by A1\'s own side, so the drop converted')
  check('and it is still counted as an attempt exactly as before',
    attempts(state, A1), [1, 1, 0],
    'the attempt counters are untouched by any of this; the ML export sees no change')
}

{
  // A1 drops, then A1 themselves ends the rally with an error -> B's point.
  const drop = thirdShot(A1, 'drop', true)
  const state = play([drop, rally(A1, 'error', drop)])
  check('a drop that landed and still lost the point',
    conversion(state, A1), [1, 0, 0, 0],
    'this is the whole reason the stat is worth having: landing the drop and winning the rally are different things')
}

{
  const drive = thirdShot(A1, 'drive')
  const state = play([drive, rally(A1, 'winner', drive)])
  check('a drive that won the point', conversion(state, A1), [0, 0, 1, 1],
    'drives get the same treatment; there is no drive_successes to confuse it with')
}

// ============================================================
section('credit follows the player who hit it, not who ended the rally')
// ============================================================
{
  // A1 drops; B1 hits a winner, so B's side takes the point.
  const drop = thirdShot(A1, 'drop', true)
  const state = play([drop, rally(B1, 'winner', drop)])
  check('an opponent ending the rally does not earn the credit',
    [conversion(state, A1), conversion(state, B1)],
    [[1, 0, 0, 0], [0, 0, 0, 0]],
    'the rally is A1\'s drop, lost; B1 played no third shot and gets nothing')
}

// ============================================================
section('what must NOT be linked')
// ============================================================
{
  const state = play([rally(B1, 'error')])
  check('a rally with no third shot logged credits nothing',
    conversion(state, A1), [0, 0, 0, 0],
    'the umpire panel is optional and often skipped, so absence is normal rather than a loss')
}

{
  // The umpire taps drop, then corrects to drive without undoing.
  const first = thirdShot(A1, 'drop', false)
  const second = thirdShot(A1, 'drive')
  const state = play([first, second, rally(B1, 'error', second)])
  check('two taps before one rally: only the last one is linked',
    conversion(state, A1), [0, 0, 1, 1],
    'a re-tap without an undo is the umpire correcting themselves, and the correction is what they meant')
  check('but both still count as attempts, as they always did',
    attempts(state, A1), [1, 0, 1],
    'the link is singular; the attempt counting is unchanged from before any of this existed')
}

{
  // A third shot tapped after the last rally has no rally to belong to.
  const orphan = thirdShot(A1, 'drop', true)
  const state = play([rally(B1, 'error'), orphan])
  check('a trailing third shot is linked to nothing',
    conversion(state, A1), [0, 0, 0, 0],
    'there is no rally after it, and the one before it is not its own')
}

{
  const state = play([rally(B1, 'error', { id: randomUUID() })])
  check('a rally naming a third shot that is not in the log credits nothing',
    conversion(state, A1), [0, 0, 0, 0],
    'an undo can remove a third shot a later rally still names, and that must be survivable rather than a crash')
}

{
  // A rally cannot reach forward to a third shot logged after it.
  const later = thirdShot(A1, 'drop', true)
  const state = play([{ ...rally(B1, 'error'), thirdShotId: later.id }, later])
  check('a rally cannot credit a third shot that came after it',
    conversion(state, A1), [0, 0, 0, 0],
    'the index is built as the log replays, so a rally only ever sees what preceded it')
}

// ============================================================
section('the counts stay honest against each other')
// ============================================================
{
  const d1 = thirdShot(A1, 'drop', true)
  const d2 = thirdShot(A1, 'drop', false)
  const d3 = thirdShot(A1, 'drop', true)
  const state = play([
    d1, rally(B1, 'error', d1),   // won
    d2, rally(A1, 'error', d2),   // lost
    d3, rally(B2, 'error'),       // linked to nothing: umpire skipped it
  ])
  const s = state.stats[A1]
  check('linked rallies never exceed attempts',
    [s.drop_attempts, s.drop_rallies, s.drop_rallies_won], [3, 2, 1],
    'three drops tapped, two of them tied to a rally, one of those won -- a skipped link is absent, never assumed lost')
  check('and the rate is computed over the linked ones only',
    Math.round((s.drop_rallies_won / s.drop_rallies) * 100), 50,
    '1 of 2, not 1 of 3 -- counting the unlinked drop as a loss would invent a result')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
