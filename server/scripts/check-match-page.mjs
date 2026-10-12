#!/usr/bin/env node
// ============================================================
// The points of a match, as the admin site's match page is told them.
// No database, no network.
//
//   node server/scripts/check-match-page.mjs
// ============================================================

import { randomUUID } from 'node:crypto'
import { matchPagePoints } from '../src/match-page.js'
import { rallyEnding } from '../src/rally-endings.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}
const section = (title) => console.log(`\n${title}`)

const A = randomUUID()
const B = randomUUID()
const nameOf = new Map([[A, 'Ana'], [B, 'Ben']])
const row = {
  team_a: [A],
  team_b: [B],
  first_server_team: 'A',
  first_server_player: A,
  right_start_a: 0,
  right_start_b: 0,
  point_target: 11,
}
function ended(actingPlayerId, detail) {
  const ending = rallyEnding(detail)
  return { type: 'rally', id: randomUUID(), actingPlayerId, outcome: ending.outcome, zone: ending.zone, detail }
}

section('Three rallies: a put-away, a net mistake, a side-out')
{
  // A serves: put-away 1-0; B nets 2-0; A hits out, a side-out (no point).
  const points = matchPagePoints(row, [ended(A, 'putaway'), ended(B, 'net'), ended(A, 'out')], nameOf)
  check('two points come back', points.length, 2)
  check('the first is a winner by Ana', points[0], { a: 1, b: 0, team: 'A', how: 'winner', label: 'Put-away', by: 'Ana' })
  check('the second is Ben\'s mistake', points[1], { a: 2, b: 0, team: 'A', how: 'mistake', label: 'Into the net', by: 'Ben' })
}

section('Rallies without an ending, and strangers')
{
  const old = (id, outcome) => ({ type: 'rally', id: randomUUID(), actingPlayerId: id, outcome, zone: 'open' })
  const points = matchPagePoints(row, [old(A, 'winner'), old(B, 'error')], nameOf)
  check('no detail reads Winning shot / Mistake', points.map((p) => p.label), ['Winning shot', 'Mistake'])
  check('a player missing from the names gives no name', matchPagePoints(row, [old(A, 'winner')], new Map())[0].by, null)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
