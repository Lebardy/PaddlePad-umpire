#!/usr/bin/env node
// ============================================================
// The "couldn't sync" list: each refused upload named in words.
//
//   node scripts/check-refused.mjs
// ============================================================

const { describeRefused } = await import('../src/lib/refused.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${expected}\n       got      ${actual}`}`)
}

const sessions = {
  s1: { id: 's1', name: 'Saturday Morning Open Play' },
  s2: { id: 's2', name: 'Sunday Doubles', endedAt: 1, voidedAt: 2 },
}
const matches = {
  m1: { id: 'm1', teamA: ['p1', 'p2'], teamB: ['p3', 'p4'] },
  m2: { id: 'm2', teamA: ['p1'], teamB: ['gone'], voidedAt: 5 },
}
const names = { p1: 'Joanna', p2: 'Marco', p3: 'Rica', p4: 'Ivy' }
const find = {
  session: (id) => sessions[id] ?? null,
  match: (id) => matches[id] ?? null,
  playerName: (id) => names[id] ?? null,
}
const words = (kind, entityId) => describeRefused({ kind, entityId }, find)

check('a new session is named', words('session', 's1'), 'The new session “Saturday Morning Open Play”')
check('a roster names its session', words('roster', 's1'), 'The players in “Saturday Morning Open Play”')
check('ending a session', words('sessionEnd', 's2'), 'Ending “Sunday Doubles”')
check('reopening a session', words('sessionEnd', 's1'), 'Reopening “Saturday Morning Open Play”')
check('voiding a session', words('sessionVoid', 's2'), 'Voiding “Sunday Doubles”')
check('restoring a session', words('sessionVoid', 's1'), 'Restoring “Saturday Morning Open Play”')
check('a new doubles match names both sides', words('match', 'm1'), 'The new match, Joanna & Marco vs Rica & Ivy')
check('rallies name the match', words('log', 'm1'), 'The rallies of Joanna & Marco vs Rica & Ivy')
check('a player this device has forgotten is a question mark', words('matchVoid', 'm2'), 'Voiding Joanna vs ?')
check('a session that is gone says so', words('roster', 'nope'), 'The players in a session no longer on this device')
check('a match that is gone says so', words('log', 'nope'), 'The rallies of a match no longer on this device')
check('deletes have no record left to name', words('matchDelete', 'm1'), 'Deleting a match')
check('and neither do session deletes', words('sessionDelete', 's1'), 'Deleting a session')
check('an unknown kind is still a line', words('later', 'x'), 'A change')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
