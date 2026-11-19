#!/usr/bin/env node
// ============================================================
// Open play courts at a place: clashes, the lowest free courts, the
// court count, and what an edit may change.
//
//   node server/scripts/check-open-play-courts.mjs
// ============================================================

import {
  overlaps, takenCourts, courtClash, clashText, lowestFreeCourts, courtCountRefusal, editRefusal, timeChanged, openPlayChanges,
} from '../src/open-play-courts.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

// Friday 20 November 2026, Manila (UTC+8).
const at = (hm) => new Date(`2026-11-20T${hm}:00+08:00`)
const play = (id, from, to, courtNumbers, extra = {}) => ({
  id, startsAt: at(from), endsAt: at(to), courtNumbers, spots: 16, feeCentavos: 15000, umpire: true, note: null, ...extra,
})
const six = play('a', '18:00', '21:00', [4, 5])
const late = play('b', '20:00', '22:00', [5, 6])

console.log('\noverlap')
check('8-10 overlaps 6-9', overlaps(late, six), true)
check('9-11 only touches 6-9', overlaps(play('b', '21:00', '23:00', [1]), six), false)
check('3-6 only touches 6-9', overlaps(play('b', '15:00', '18:00', [1]), six), false)
check('inside it overlaps', overlaps(play('b', '19:00', '20:00', [1]), six), true)

console.log('\nclashes')
check('a shared court clashes, with the other open play', courtClash(late, [six]), { court: 5, startsAt: six.startsAt, endsAt: six.endsAt })
check('the lowest shared court is named', courtClash(play('b', '20:00', '22:00', [4, 5]), [six])?.court, 4)
check('other courts do not clash', courtClash(play('b', '20:00', '22:00', [1, 2]), [six]), null)
check('end to end does not clash', courtClash(play('b', '21:00', '23:00', [4, 5]), [six]), null)
check('an open play never clashes with itself', courtClash({ ...six }, [six]), null)
check('taken courts', [...takenCourts(late, [six]).keys()], [4, 5])
check('the words', clashText({ court: 5, startsAt: six.startsAt, endsAt: six.endsAt }), 'Court 5 is taken by the Fri, Nov 20 · 6–9 PM open play')

console.log('\nthe lowest free courts')
check('two free beside 4 and 5', lowestFreeCourts(late, 2, 6, [six]), [1, 2])
check('skips the taken ones', lowestFreeCourts(late, 4, 6, [six]), [1, 2, 3, 6])
check('not enough free', lowestFreeCourts(late, 5, 6, [six]), null)

console.log('\nthe court count')
check('raising it', courtCountRefusal(8, [six]), null)
check('down to the highest court used', courtCountRefusal(5, [six]), null)
check('below it', courtCountRefusal(4, [six]), 'Court 5 is in the Fri, Nov 20 · 6–9 PM open play')
check('clearing it while one is coming', courtCountRefusal(null, [six]), 'Court 4 is in the Fri, Nov 20 · 6–9 PM open play')
check('nothing coming', courtCountRefusal(null, []), null)

console.log('\nediting')
const ok = { now: at('17:30'), going: 3, startedCourts: [] }
const during = { ...ok, now: at('19:30') }
check('anything before it starts', editRefusal(six, play('a', '19:00', '22:00', [1], { spots: 8 }), ok), null)
check('court started early: the start stays', editRefusal(six, play('a', '19:00', '22:00', [4, 5]), { ...ok, startedCourts: [4] }), 'It has started, so its day and start stay')
check('court started early: the end can change', editRefusal(six, play('a', '18:00', '22:00', [4, 5]), { ...ok, startedCourts: [4] }), null)
check('over', editRefusal(six, six, { ...ok, now: at('21:00') }), 'This open play is over')
check('started: the start stays', editRefusal(six, play('a', '19:00', '21:00', [4, 5]), during), 'It has started, so its day and start stay')
check('started: a later end', editRefusal(six, play('a', '18:00', '22:00', [4, 5]), during), null)
check('started: an end already passed', editRefusal(six, play('a', '18:00', '19:00', [4, 5]), during), 'That end has passed')
check('a started court stays', editRefusal(six, play('a', '18:00', '21:00', [4]), { ...during, startedCourts: [5] }), 'Court 5 has started, so it stays')
check('an unstarted court can go', editRefusal(six, play('a', '18:00', '21:00', [5]), { ...during, startedCourts: [5] }), null)
check('spots below the players going', editRefusal(six, { ...six, spots: 2 }, ok), '3 players are going, so keep at least 3 spots')
check('spots equal to the players going', editRefusal(six, { ...six, spots: 3 }, ok), null)
check('umpire off once a court started', editRefusal(six, { ...six, umpire: false }, { ...during, startedCourts: [4] }), 'Courts have started, so the umpire stays on duty')
check('umpire off before any court started', editRefusal(six, { ...six, umpire: false }, ok), null)

console.log('\nwhat changed')
check('nothing', openPlayChanges(six, { ...six }), [])
check('everything', openPlayChanges(six, play('a', '19:00', '22:00', [1, 2], { spots: 8, feeCentavos: null, umpire: false, note: 'Bring water' })),
  ['time to Fri, Nov 20 · 7–10 PM', 'courts to 1, 2', 'spots to 8', 'fee', 'no umpire', 'note'])
check('umpire back on', openPlayChanges({ ...six, umpire: false }, six), ['umpire on duty'])
check('a time change', timeChanged(six, play('a', '18:00', '22:00', [4, 5])), true)
check('no time change', timeChanged(six, { ...six, spots: 4 }), false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
