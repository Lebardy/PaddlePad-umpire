#!/usr/bin/env node
// ============================================================
// The People tab's title line and its name search.
//
//   node player/scripts/check-people-words.mjs
// ============================================================

const { findPeople, peopleLine } = await import('../src/lib/peopleWords.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('the usual line', peopleLine({ people: 21, partners: 15, faced: 18, beaten: 10 }), '21 people · 15 partnered · beaten 10 of 18 faced')
check('one person, never faced anyone', peopleLine({ people: 1, partners: 1, faced: 0, beaten: 0 }), '1 person · 1 partnered')
check('only ever faced people', peopleLine({ people: 2, partners: 0, faced: 2, beaten: 0 }), '2 people · beaten 0 of 2 faced')

const people = ['Marco Bautista', 'Rica Salazar', 'Niño Dela Cruz', 'Kristine Dela Cruz'].map((name) => ({ name }))
check('any part of the name', findPeople(people, 'dela').map((p) => p.name), ['Niño Dela Cruz', 'Kristine Dela Cruz'])
check('any case, extra spaces', findPeople(people, '  RICA ').map((p) => p.name), ['Rica Salazar'])
check('without the tilde', findPeople(people, 'nino').map((p) => p.name), ['Niño Dela Cruz'])
check('an empty search keeps everyone', findPeople(people, '').length, 4)
check('no match, no one', findPeople(people, 'zzz'), [])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
