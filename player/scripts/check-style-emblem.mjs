#!/usr/bin/env node
// ============================================================
// Which emblem and trait marks a playstyle name is drawn with.
//
//   node player/scripts/check-style-emblem.mjs
// ============================================================

const { emblemFor } = await import('../src/lib/styleEmblem.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('two trait words and an identity', emblemFor('Clean Steady Net Player'), { identity: 'net', traits: ['Clean', 'Steady'] })
check('an identity on its own', emblemFor('All-Court Player'), { identity: 'all', traits: [] })
check('a one-word identity', emblemFor('Streaky Driver'), { identity: 'driver', traits: ['Streaky'] })
check('the hyphenated trait word', emblemFor('Solid-Net Consistent Dropper'), { identity: 'dropper', traits: ['Solid-Net', 'Consistent'] })
check('power is not read as net', emblemFor('Precise Power Player'), { identity: 'power', traits: ['Precise'] })
check('a word that is on no list gets no mark', emblemFor('Patient Clean Net Player'), { identity: 'net', traits: ['Clean'] })
check('the same word twice is one mark', emblemFor('Unpredictable Unpredictable Driver'), { identity: 'driver', traits: ['Unpredictable'] })
check('never more than two marks', emblemFor('Clean Steady Composed Net Player').traits.length, 2)
check('an unknown identity draws nothing', emblemFor('Clean Steady Baseliner'), null)
check('no name draws nothing', emblemFor(null), null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
