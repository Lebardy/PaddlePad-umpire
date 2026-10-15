#!/usr/bin/env node
// ============================================================
// The Guests page's form choices and words, in Manila time.
//
//   node admin/scripts/check-guests.mjs
// ============================================================

import {
  dayOptions, endHours, feeWords, levelWords, scoreWords, spotsFor, startHours, toIso, whenWords,
} from '../src/lib/guests.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

// Thursday Oct 15, noon in Manila.
const now = Date.parse('2026-10-15T04:00:00Z')
const days = dayOptions(now)
check('seven days, today first', days.map((d) => d.label),
  ['Today', 'Tomorrow', 'Sat, Oct 17', 'Sun, Oct 18', 'Mon, Oct 19', 'Tue, Oct 20', 'Wed, Oct 21'])
check('each day is its Manila midnight', days[0].value, '2026-10-14T16:00:00.000Z')
check('late at night in Manila is already the next day',
  dayOptions(Date.parse('2026-10-15T17:30:00Z'))[0].value, '2026-10-15T16:00:00.000Z')

check('starts run 6 am to 10 pm', [startHours[0], startHours.at(-1)], [{ value: 6, label: '6 AM' }, { value: 22, label: '10 PM' }])
check('noon reads 12 PM', startHours.find((h) => h.value === 12).label, '12 PM')
check('ends run an hour to eight hours on', endHours(6).map((h) => h.value), [7, 8, 9, 10, 11, 12, 13, 14])
check('ends stop at 11 pm', endHours(20).map((h) => h.label), ['9 PM', '10 PM', '11 PM'])

check('a day and an hour make the start', toIso(days[2].value, 6), '2026-10-16T22:00:00.000Z')

check('8 spots a court', spotsFor(3), 24)
check('no courts typed, no spots', spotsFor(''), '')

check('levels highest first, new last',
  levelWords([{ name: 'Advanced', count: 4 }, { name: 'Developing', count: 7 }], 1), '4 Advanced · 7 Developing · 1 new')
check('only new players', levelWords([], 2), '2 new')
check('nobody going', levelWords([], 0), '')
check('no clear levels', levelWords(null, 0), '')

check('a score from 3 ratings', scoreWords({ rated: 12, average: 4.6 }), { figure: '4.6', words: '12 rated · last 30 days' })
check('a whole score keeps its decimal', scoreWords({ rated: 5, average: 4 }).figure, '4.0')
check('below 3 ratings, no score', scoreWords({ rated: 2, average: null }), { figure: null, words: '2 rated so far' })
check('no ratings', scoreWords({ rated: 0, average: null }), { figure: null, words: 'No ratings yet' })

check('a fee', feeWords(15000), '₱150')
check('a fee with centavos', feeWords(15050), '₱150.50')
check('a thousand', feeWords(100000), '₱1,000')
check('no fee', feeWords(null), 'Free')

check('when, same half of the day', whenWords('2026-10-16T22:00:00Z', '2026-10-17T01:00:00Z'), 'Sat, Oct 17 · 6–9 AM')
check('when, across noon', whenWords('2026-10-17T02:00:00Z', '2026-10-17T06:00:00Z'), 'Sat, Oct 17 · 10 AM–2 PM')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
