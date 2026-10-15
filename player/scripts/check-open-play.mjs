#!/usr/bin/env node
// ============================================================
// Open play in words: the day, the hours, the fee and who's coming.
// Manila is UTC+8 all year.
//
//   node player/scripts/check-open-play.mjs
// ============================================================

const { buttonState, courtsWords, dayHeading, dayTile, feeWords, timeSpan, whoWords } = await import('../src/lib/openPlay.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

// Sat Oct 17 2026, 6 am Manila = Fri 22:00 UTC.
check('the day tile, in Manila', dayTile('2026-10-16T22:00:00.000Z'), { day: 'Sat', date: '17' })
check('the day heading, in Manila', dayHeading('2026-10-16T22:00:00.000Z'), 'Sat, Oct 17')
check('late evening UTC is the next day in Manila', dayHeading('2026-10-17T17:00:00.000Z'), 'Sun, Oct 18')

check('a morning', timeSpan('2026-10-16T22:00:00.000Z', '2026-10-17T01:00:00.000Z'), '6–9 am')
check('an evening', timeSpan('2026-10-17T10:00:00.000Z', '2026-10-17T12:00:00.000Z'), '6–8 pm')
check('across noon', timeSpan('2026-10-17T03:00:00.000Z', '2026-10-17T05:00:00.000Z'), '11 am–1 pm')
check('from noon', timeSpan('2026-10-17T04:00:00.000Z', '2026-10-17T06:00:00.000Z'), '12–2 pm')

check('one court', courtsWords(1), '1 court')
check('two courts', courtsWords(2), '2 courts')

check('a fee in whole pesos', feeWords(15000), '₱150 · pay when you arrive')
check('a fee with centavos', feeWords(15050), '₱150.50 · pay when you arrive')
check('no fee', feeWords(null), 'Free')

const row = (fields) => ({ count: 0, spots: 16, atYourLevel: null, levels: null, newCount: 0, names: [], you: false, ...fields })
check('at your level, two names and the rest',
  whoWords(row({ count: 12, atYourLevel: 7, levels: [{ name: 'Advanced', count: 7 }], newCount: 5, names: ['Paolo Garcia', 'Bea Mendoza'] })),
  { level: '7 at your level', mix: null, empty: null, names: 'Paolo, Bea +10' })
check('you are not counted in the "+"',
  whoWords(row({ count: 24, atYourLevel: 9, levels: [], names: ['Tristan Yu'], you: true })),
  { level: '9 at your level', mix: null, empty: null, names: 'Tristan +22' })
check('no one at your level: the levels coming, highest first, then new',
  whoWords(row({ count: 2, atYourLevel: 0, levels: [{ name: 'Expert', count: 1 }, { name: 'Advanced', count: 1 }], newCount: 1 })),
  { level: null, mix: 'Expert · Advanced · new', empty: null, names: null })
check('no level of your own',
  whoWords(row({ count: 2, levels: [{ name: 'Advanced', count: 1 }], newCount: 1 })),
  { level: null, mix: 'Advanced · new', empty: null, names: null })
check('no clear levels: nothing about levels at all',
  whoWords(row({ count: 3, atYourLevel: null, levels: null, names: ['Bea Mendoza'] })),
  { level: null, mix: null, empty: null, names: 'Bea +2' })
check('only you going: nothing about levels',
  whoWords(row({ count: 1, levels: [{ name: 'Developing', count: 1 }], you: true })),
  { level: null, mix: null, empty: null, names: null })
check('nobody yet', whoWords(row({ levels: [] })), { level: null, mix: null, empty: 'Nobody yet. Be the first.', names: null })
check('two names and nobody else', whoWords(row({ count: 3, levels: null, names: ['Paolo Garcia', 'Bea Mendoza'], you: true })),
  { level: null, mix: null, empty: null, names: 'Paolo, Bea' })

check('going', buttonState(row({ count: 16, you: true })), 'going')
check('full', buttonState(row({ count: 16 })), 'full')
check('join', buttonState(row({ count: 15 })), 'join')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
