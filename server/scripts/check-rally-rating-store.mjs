#!/usr/bin/env node
// ============================================================
// The rally rating cache: loads once, rebuilds after a change.
//
//   node server/scripts/check-rally-rating-store.mjs
//
// A fake query stands in for Postgres, so this needs no database.
// ============================================================

import { randomUUID } from 'node:crypto'
import { getRallyRatings, invalidateRallyRatings } from '../src/rally-rating-store.js'

let pass = 0
let fail = 0
function check(label, ok, why) {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}\n       ${why}`)
}

const [a, b] = [randomUUID(), randomUUID()]
const matchId = randomUUID()
let calls = 0
let voided = false

async function fakeQuery(sql) {
  calls += 1
  if (sql.includes('FROM match_events')) {
    return {
      rows: voided
        ? []
        : [{ match_id: matchId, id: randomUUID(), seq: 0, type: 'rally', payload: { actingPlayerId: a, outcome: 'winner', zone: 'open', detail: 'ace' } }],
    }
  }
  return {
    rows: voided
      ? []
      : [{
          id: matchId, team_a: [a], team_b: [b], first_server_team: 'A', first_server_player: a,
          point_target: 11, right_start_a: null, right_start_b: null, ended_at: '2026-09-01T10:00:00Z',
        }],
  }
}

const first = await getRallyRatings(fakeQuery)
check('the history is loaded and rated', first.get(a)?.points > 1500, 'A won the only rally.')
const callsAfterFirst = calls
await getRallyRatings(fakeQuery)
check('a second request uses the cache', calls === callsAfterFirst, 'No queries the second time.')

voided = true
invalidateRallyRatings()
const after = await getRallyRatings(fakeQuery)
check('after invalidation the history is loaded again', calls > callsAfterFirst, 'A change must be seen.')
check('and a voided match no longer counts', after.get(a) === undefined, 'The match was the only history.')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
