#!/usr/bin/env node
// ============================================================
// What a tap on a 3rd-shot button does to the match log
// (src/lib/thirdShot.js). No browser, no network.
//
//   node scripts/check-third-shot.mjs
//
// The server counts every thirdShot event as an attempt, so a
// corrected tap must replace the waiting one (even after a serve
// correction was logged) and never add a second.
// ============================================================

import { isSameThirdShot, waitingThirdShot, withThirdShotTap } from '../src/lib/thirdShot.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

let n = 0
const stamp = () => ({ id: `e${(n += 1)}`, at: n })
const rally = { type: 'rally', id: 'r1', at: 0, actingPlayerId: 'ana', outcome: 'winner', zone: 'open' }
const dropIn = { playerId: 'ana', shotType: 'drop', success: true }
const dropMiss = { playerId: 'ana', shotType: 'drop', success: false }
const drive = { playerId: 'ana', shotType: 'drive', success: null }
const shots = (events) => events.filter((e) => e.type === 'thirdShot').map((e) => [e.playerId, e.shotType, e.success])

console.log('\nwhich 3rd shot is waiting')
check('nothing logged: none', waitingThirdShot([]), null)
let log = withThirdShotTap([rally], dropIn, stamp())
check('a tap after a rally waits', waitingThirdShot(log)?.id, log[log.length - 1].id)
check('a rally after it: none waiting', waitingThirdShot([...log, { ...rally, id: 'r2' }]), null)
const correction = { type: 'serverCorrection', id: 'c1', at: 9, playerId: 'ben' }
check('a serve correction after it: still waiting', waitingThirdShot([...log, correction])?.id, log[log.length - 1].id)

console.log('\nwhich button is the waiting one')
check('same player, shot and result', isSameThirdShot(waitingThirdShot(log), dropIn), true)
check('a miss is not a landed drop', isSameThirdShot(waitingThirdShot(log), dropMiss), false)
check('another player is not it', isSameThirdShot(waitingThirdShot(log), { ...dropIn, playerId: 'ben' }), false)
check('nothing waiting matches nothing', isSameThirdShot(null, dropIn), false)
check('a drive logged before success was sent still matches', isSameThirdShot({ type: 'thirdShot', playerId: 'ana', shotType: 'drive' }, drive), true)

console.log('\nwhat a tap does')
check('first tap adds one', shots(withThirdShotTap([rally], dropMiss, stamp())), [['ana', 'drop', false]])
log = withThirdShotTap(withThirdShotTap([rally], dropMiss, stamp()), dropIn, stamp())
check('Drop ✗ then Drop ✓ leaves one Drop ✓', shots(log), [['ana', 'drop', true]])
check('the rally before it is kept', log[0], rally)
check('tapping the filled one again leaves none', shots(withThirdShotTap(log, dropIn, stamp())), [])
const missThenCorrection = [rally, ...withThirdShotTap([], dropMiss, stamp()), correction]
log = withThirdShotTap(missThenCorrection, dropMiss, stamp())
check('after a serve correction, the same button clears the waiting one', shots(log), [])
check('the serve correction is kept when it clears', log.some((e) => e.id === 'c1'), true)
log = withThirdShotTap(missThenCorrection, { ...dropIn, playerId: 'ben' }, stamp())
check('after a serve correction, another button replaces it', shots(log), [['ben', 'drop', true]])
check('the replacement is at the end', log[log.length - 1].type, 'thirdShot')
check('the serve correction stays in place, before the new tap', log.findIndex((e) => e.id === 'c1'), 1)
const earlier = missThenCorrection.filter((e) => e.type === 'thirdShot')
log = withThirdShotTap([...missThenCorrection, { ...rally, id: 'r3' }], dropIn, stamp())
check('after a later rally nothing is waiting: appended, earlier one untouched', shots(log), [['ana', 'drop', false], ['ana', 'drop', true]])
check('the earlier 3rd shot is the same event', log.includes(earlier[0]), true)
const older = withThirdShotTap([], dropMiss, stamp())[0]
const full = [older, { ...rally, thirdShotId: older.id }, ...withThirdShotTap([], dropMiss, stamp()), correction]
check('a clear removes only the waiting one', withThirdShotTap(full, dropMiss, stamp()), [older, full[1], correction])
check('a replace keeps everything before it', withThirdShotTap(full, dropIn, stamp()).slice(0, 3), [older, full[1], correction])
const added = withThirdShotTap([], drive, { id: 'x1', at: 5 })
check('the event has the shape the server takes', added, [{ type: 'thirdShot', id: 'x1', at: 5, playerId: 'ana', shotType: 'drive', success: null }])

console.log(`\n${pass} ok / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
