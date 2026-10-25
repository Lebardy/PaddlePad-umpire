#!/usr/bin/env node
// ============================================================
// Rivals, best partners and the alert words. No database, no network.
//
//   node server/scripts/check-rivals.mjs
// ============================================================

import { alertTitle, blockFor, pushGone, sendAfter } from '../src/rivals.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const person = (name, extra = {}) => ({ name, nameVisible: true, nearRatingName: false, ...extra })
const vs = (them, won) => ({ teamA: ['me'], teamB: [them], winner: won ? 'A' : 'B' })
const withP = (partner, won) => ({ teamA: ['me', partner], teamB: ['x1', 'x2'], winner: won ? 'A' : 'B' })
const rated = (points, matches = 5) => ({ points, matches })
const base = { me: 'me', minMatches: 5 }
const ids = (list) => list.map((r) => r.id)

// Shared-match rivals
let people = new Map([['dani', person('Dani')], ['jo', person('Jo')], ['kai', person('Kai')]])
check('one match against is not a rival', ids(blockFor({ ...base, matches: [vs('dani', true)], ratings: new Map(), people }).rivals), [])
check('2-0 is not close enough', ids(blockFor({ ...base, matches: [vs('dani', true), vs('dani', true)], ratings: new Map(), people }).rivals), [])
check('1-1 is a rival', blockFor({ ...base, matches: [vs('dani', true), vs('dani', false)], ratings: new Map(), people }).rivals,
  [{ id: 'dani', kind: 'matches', won: 1, lost: 1, name: 'Dani' }])
check('2-1 is a rival, 3-1 is not',
  ids(blockFor({ ...base, matches: [vs('dani', true), vs('dani', true), vs('dani', false), vs('jo', true), vs('jo', true), vs('jo', true), vs('jo', false)], ratings: new Map(), people }).rivals),
  ['dani'])
check('most matches against first',
  ids(blockFor({ ...base, matches: [vs('dani', true), vs('dani', false), vs('jo', true), vs('jo', false), vs('jo', true)], ratings: new Map(), people }).rivals),
  ['jo', 'dani'])

// Rating rivals
people = new Map([['a', person('Ana')], ['b', person('Ben')], ['c', person('Cy')], ['d', person('Di')], ['e', person('Ed')]])
let ratings = new Map([['me', rated(1600)], ['a', rated(1625)], ['b', rated(1626)], ['c', rated(1590)], ['d', rated(1610, 4)]])
let block = blockFor({ ...base, matches: [], ratings, people })
check('within 25 counts, 26 does not, 4 matches does not, closest first', ids(block.rivals), ['c', 'a'])
check('a stranger near your rating is not named without the switch', block.rivals.map((r) => r.name), [null, null])
check('my own rating must count too', ids(blockFor({ ...base, matches: [], ratings: new Map([...ratings, ['me', rated(1600, 4)]]), people }).rivals), [])
people.set('a', person('Ana', { nearRatingName: true }))
check('the switch names a stranger', blockFor({ ...base, matches: [], ratings, people }).rivals.find((r) => r.id === 'a').name, 'Ana')
people.set('a', person('Ana', { nearRatingName: true, nameVisible: false }))
check('a hidden name stays hidden even with the switch', blockFor({ ...base, matches: [], ratings, people }).rivals.find((r) => r.id === 'a').name, null)
people.set('a', person('Ana'))
check('someone I played once is named as a rating rival', blockFor({ ...base, matches: [vs('a', true)], ratings, people }).rivals.find((r) => r.id === 'a').name, 'Ana')
check('a shared-match rival is listed once, as a match rival',
  blockFor({ ...base, matches: [vs('c', true), vs('c', false)], ratings, people }).rivals.map((r) => [r.id, r.kind]),
  [['c', 'matches'], ['a', 'rating']])

// Partners
people = new Map([['rio', person('Rio')], ['ana', person('Ana')], ['ben', person('Ben')], ['cy', person('Cy')]])
block = blockFor({
  ...base, ratings: new Map(), people,
  matches: [withP('rio', true), withP('rio', true), withP('rio', false), withP('ana', true), withP('ana', true), withP('ben', true), withP('ben', true), withP('ben', true), withP('cy', true)],
})
check('2+ wins together, most wins first, then fewer losses', block.partners.map((p) => [p.id, p.wins, p.losses]), [['ben', 3, 0], ['ana', 2, 0], ['rio', 2, 1]])
check('opponents in a doubles match are rivals material, not partners', ids(block.rivals), [])

// Limits and who may appear
people = new Map(['p1', 'p2', 'p3', 'p4'].map((id) => [id, person(id.toUpperCase())]))
block = blockFor({ ...base, ratings: new Map(), people, matches: ['p1', 'p2', 'p3', 'p4'].flatMap((id) => [vs(id, true), vs(id, false)]) })
check('at most 3 rivals', block.rivals.length, 3)
check('a closed or paused player (not in people) never appears',
  ids(blockFor({ ...base, ratings: new Map(), people: new Map([['p1', person('P1')]]), matches: [vs('p1', true), vs('p1', false), vs('p2', true), vs('p2', false)] }).rivals), ['p1'])
people = new Map([['dani', person('Dani', { nameVisible: false })]])
check('a hidden name is never named, even to an opponent', blockFor({ ...base, ratings: new Map(), people, matches: [vs('dani', true), vs('dani', false)] }).rivals[0].name, null)

// Alert titles
check('nobody going', alertTitle([]), null)
check('one named', alertTitle([{ kind: 'rival', name: 'Dani' }]), 'Dani is going')
check('named + 2 rivals', alertTitle([{ kind: 'rival', name: 'Dani' }, { kind: 'rival', name: null }, { kind: 'rival', name: 'Jo' }]), 'Dani and 2 rivals are going')
check('named + 1 partner', alertTitle([{ kind: 'rival', name: 'Dani' }, { kind: 'partner', name: 'Rio' }]), 'Dani and 1 partner are going')
check('named + 1 rival + 2 partners', alertTitle([{ kind: 'rival', name: 'Dani' }, { kind: 'rival', name: null }, { kind: 'partner', name: 'Rio' }, { kind: 'partner', name: 'Ana' }]), 'Dani, 1 rival and 2 partners are going')
check('first named may be a partner', alertTitle([{ kind: 'rival', name: null }, { kind: 'partner', name: 'Rio' }]), 'Rio and 1 rival are going')
check('one unnamed', alertTitle([{ kind: 'rival', name: null }]), 'A player near your rating is going')
check('two unnamed', alertTitle([{ kind: 'rival', name: null }, { kind: 'rival', name: null }]), '2 players near your rating are going')

// Quiet hours (Manila = UTC+8)
const at = (iso) => sendAfter(new Date(iso)).toISOString()
check('3 PM Manila sends now', at('2026-10-25T07:00:00Z'), '2026-10-25T07:00:00.000Z')
check('9:59 PM Manila sends now', at('2026-10-25T13:59:00Z'), '2026-10-25T13:59:00.000Z')
check('10 PM Manila waits for 7 AM next day', at('2026-10-25T14:00:00Z'), '2026-10-25T23:00:00.000Z')
check('2 AM Manila waits for 7 AM same day', at('2026-10-25T18:00:00Z'), '2026-10-25T23:00:00.000Z')
check('7 AM Manila sends now', at('2026-10-25T23:00:00Z'), '2026-10-25T23:00:00.000Z')

check('410 means the phone is gone', pushGone(410), true)
check('404 means the phone is gone', pushGone(404), true)
check('500 does not', pushGone(500), false)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
