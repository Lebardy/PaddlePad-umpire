#!/usr/bin/env node
// ============================================================
// Old admin addresses still land on the right page.
//
//   node admin/scripts/check-paths.mjs
//
// "People" split into Players and Umpires, and "Invite codes" moved
// under Umpires. A bookmark or an old link must keep working.
// ============================================================

import { movedPath } from '../src/lib/paths.js'

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const id = '0a7617ad-2f75-4da2-a92a-3b563cb3a6d5'
console.log('\nold addresses')
check('People goes to Players', movedPath('/people'), '/players')
check('People › Umpires goes to Umpires', movedPath('/people/umpires'), '/umpires')
check("a player's page keeps its id", movedPath(`/people/players/${id}`), `/players/${id}`)
check("an umpire's page keeps its id", movedPath(`/people/umpires/${id}`), `/umpires/${id}`)
check('Invite codes goes under Umpires', movedPath('/invites'), '/umpires/invites')

console.log('\ncurrent addresses stay put')
check('nothing else moves',
  ['/', '/players', '/umpires', '/umpires/invites', `/players/${id}`, '/facilities', '/account', '/people/nobody'].map(movedPath),
  [null, null, null, null, null, null, null, null])

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
