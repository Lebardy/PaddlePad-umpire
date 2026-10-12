#!/usr/bin/env node
// ============================================================
// The match page's words and rules.
//
//   node admin/scripts/check-matches.mjs
//
// Who may open a match, how one point reads and is marked, how much
// video is stored, and which point a playing video is on.
// ============================================================

import { mayOpenMatch, playingIndex, pointLine, pointMark, pointSaid, sizeText } from '../src/lib/matches.js'

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

console.log('\nwho may open a match')
check('the owner opens any match', mayOpenMatch({ role: 'owner', facilityId: null }, 'f1'), true)
check('the owner opens a match with no facility', mayOpenMatch({ role: 'owner', facilityId: null }, null), true)
check('a manager opens a match at their own facility', mayOpenMatch({ role: 'admin', facilityId: 'f1' }, 'f1'), true)
check("a manager does not open another facility's match", mayOpenMatch({ role: 'admin', facilityId: 'f1' }, 'f2'), false)
check('a manager with no facility never opens one', mayOpenMatch({ role: 'admin', facilityId: null }, null), false)
check('nor a match that has a facility', mayOpenMatch({ role: 'admin', facilityId: null }, 'f1'), false)
check('a match with no facility is not a manager’s', mayOpenMatch({ role: 'admin', facilityId: 'f1' }, null), false)

console.log('\none point, in a line')
check('with who did it', pointLine({ a: 12, b: 9, team: 'A', how: 'winner', label: 'Put-away', by: 'Jan' }), '12–9 · Put-away · Jan')
check('with nobody named', pointLine({ a: 12, b: 9, team: 'A', how: 'winner', label: 'Put-away', by: null }), '12–9 · Put-away')

console.log('\nhow a point ended, as a mark and in words')
check('a winning shot is ticked', pointMark({ how: 'winner' }), 'check')
check('a mistake is crossed', pointMark({ how: 'mistake' }), 'x')
check('anything that is not a winning shot is a mistake', pointMark({ how: 'fault' }), 'x')
check('a winning shot, said', pointSaid({ a: 12, b: 9, team: 'A', how: 'winner', label: 'Put-away', by: 'Jan' }, 'Jan & Bea'), 'Jan & Bea: 12–9, Put-away, winning shot by Jan')
check('a mistake, said: the name is who made it', pointSaid({ a: 0, b: 1, team: 'B', how: 'mistake', label: 'Into the net', by: 'Jan' }, 'Cho & Ria'), 'Cho & Ria: 0–1, Into the net, mistake by Jan')
check('with nobody named', pointSaid({ a: 0, b: 1, team: 'B', how: 'mistake', label: 'Into the net', by: null }, 'Cho'), 'Cho: 0–1, Into the net, mistake')
check('a point labelled only "Mistake" says it once', pointSaid({ a: 0, b: 1, team: 'B', how: 'mistake', label: 'Mistake', by: 'Jan' }, 'Cho'), 'Cho: 0–1, mistake by Jan')
check('and one labelled only "Winning shot"', pointSaid({ a: 1, b: 0, team: 'A', how: 'winner', label: 'Winning shot', by: 'Jan' }, 'Jan'), 'Jan: 1–0, winning shot by Jan')

console.log('\nhow much video is stored')
check('nothing', sizeText(0), '0 GB')
check('a little is never rounded to nothing', sizeText(1024), '0.1 GB')
check('one decimal', sizeText(1.44e9), '1.4 GB')
check('a round figure keeps its decimal', sizeText(2e9), '2.0 GB')

console.log('\nthe point a playing video is on')
check('the last point whose rally has started', playingIndex([0, null, 16, 31], 20), 2)
check('a rally at second 0 counts', playingIndex([0, 16], 3), 0)
check('a quarter second early still counts', playingIndex([0, null, 16, 31], 15.8), 2)
check('before the first rally', playingIndex([4, 9], 1), null)
check('a video that shows no point', playingIndex([null, null], 5), null)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
