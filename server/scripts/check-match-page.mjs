#!/usr/bin/env node
// ============================================================
// The points of a match, as the admin site's match page is told them.
// No database, no network.
//
//   node server/scripts/check-match-page.mjs
// ============================================================

import { randomUUID } from 'node:crypto'
import { matchPagePoints, pageMatch } from '../src/match-page.js'
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

section('A point scored by B')
{
  // A serves and nets: side-out. B serves and wins with a put-away: 0-1.
  const points = matchPagePoints(row, [ended(A, 'net'), ended(B, 'putaway')], nameOf)
  check('B\'s point reads team B', points, [{ a: 0, b: 1, team: 'B', how: 'winner', label: 'Put-away', by: 'Ben' }])
}

section('Rallies without an ending, and strangers')
{
  const old = (id, outcome) => ({ type: 'rally', id: randomUUID(), actingPlayerId: id, outcome, zone: 'open' })
  const points = matchPagePoints(row, [old(A, 'winner'), old(B, 'error')], nameOf)
  check('no detail reads Winning shot / Mistake', points.map((p) => p.label), ['Winning shot', 'Mistake'])
  check('a player missing from the names gives no name', matchPagePoints(row, [old(A, 'winner')], new Map())[0].by, null)
}

section('The page answer')
{
  const C = randomUUID()
  const D = randomUUID()
  const names = new Map([[A, 'Ana'], [B, 'Ben'], [C, 'Cy']])
  const full = { id: 'm1', status: 'completed', ended_early: false, team_a: [A, C], team_b: [B, D], winner: 'A', point_target: 11,
    session_name: 'Night', facility_id: 'f1', voided_at: null }
  const score = { A: 11, B: 7 }
  const video = { url: 'u', durationMs: 1, width: 2, height: 3, seconds: [1] }
  const page = pageMatch(full, { points: [], video, names, score, hasVideoRow: true, isOwner: true })
  check('both sides in order, a stranger is Someone', [page.teamA, page.teamB], [[{ id: A, name: 'Ana' }, { id: C, name: 'Cy' }], [{ id: B, name: 'Ben' }, { id: D, name: 'Someone' }]])
  check('winner and score', [page.winner, page.scoreA, page.scoreB, page.voided], ['A', 11, 7, null])
  check('the video passes through untouched', page.video, video)
  const voided = pageMatch({ ...full, voided_at: 'then', void_reason: 'test' }, { points: [], video: null, names, score, hasVideoRow: false, isOwner: false })
  check('a voided match carries when and why', voided.voided, { at: 'then', reason: 'test' })
  const may = (hasVideoRow, isOwner) => pageMatch(full, { points: [], video: null, names, score, hasVideoRow, isOwner }).mayRemoveVideo
  check('removal only for the owner AND a video row', [may(true, true), may(true, false), may(false, true), may(false, false)], [true, false, false, false])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
