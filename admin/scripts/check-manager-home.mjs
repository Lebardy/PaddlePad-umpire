#!/usr/bin/env node
// ============================================================
// The words on a manager's home page, checked against the state of
// every facility on staging on 2026-10-10.
//
//   node admin/scripts/check-manager-home.mjs
// ============================================================

import {
  allTimeLine, missingLine, needsFlag, placeFacts, sessionLine, sessionNeeds, umpireLine, waitingCount,
} from '../src/lib/managerHome.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

// Staging's facilities as GET /admin/facilities/:id returned them.
const boulevard = { openingHours: '6:00 AM – 10:00 PM daily', hourlyFeeCentavos: 20000, feeText: '₱200 per hour', umpireFeeCentavos: 10000, umpireFeeText: '₱100 per hour', logoUrl: null, locationUrl: null }
const sibulan = { openingHours: null, hourlyFeeCentavos: 0, feeText: 'Free', umpireFeeCentavos: null, umpireFeeText: null, logoUrl: null, locationUrl: null }
const starting = { openingHours: null, hourlyFeeCentavos: null, feeText: 'Fee not set', umpireFeeCentavos: null, umpireFeeText: null, logoUrl: null, locationUrl: null }
const complete = { ...boulevard, logoUrl: '/logos/f1?v=1', locationUrl: 'https://maps.example/f1' }

check('Boulevard lacks a logo and a map link', missingLine(boulevard), 'Missing: logo, map link.')
check('hours and fees are left to the facts above, which say Not set', missingLine(starting), 'Missing: logo, map link.')
check('a logo but no map link', missingLine({ ...complete, locationUrl: null }), 'Missing: map link.')
check('nothing missing is no line at all', missingLine(complete), null)

check('Boulevard’s three facts', placeFacts(boulevard).map((f) => f.value), ['6:00 AM – 10:00 PM daily', '₱200 per hour', '₱100 per hour'])
check('Sibulan: Free shows, the rest say Not set', placeFacts(sibulan).map((f) => f.value), ['Not set', 'Free', 'Not set'])
check('an unset court fee says Not set, not "Fee not set"', placeFacts(starting).map((f) => f.value), ['Not set', 'Not set', 'Not set'])

const now = Date.parse('2026-10-10T04:00:00Z')
check('an umpire with matches this week says only that', umpireLine({ weekMatches: 21, lastScoredAt: '2026-10-06T11:58:00Z' }, now), '21 matches this week')
check('one match, not one matches', umpireLine({ weekMatches: 1, lastScoredAt: '2026-10-06T11:58:00Z' }, now), '1 match this week')
check('a quiet week names the last day scored, in Manila', umpireLine({ weekMatches: 0, lastScoredAt: '2026-09-26T11:58:00Z' }, now), 'Last scored Saturday, Sep 26')
check('late evening UTC is the next day in Manila', umpireLine({ weekMatches: 0, lastScoredAt: '2026-09-26T17:00:00Z' }, now), 'Last scored Sunday, Sep 27')
check('a new umpire', umpireLine({ weekMatches: 0, lastScoredAt: null }, now), 'Hasn’t scored yet')

check('a session row', sessionLine({ matches: 14, players: 11 }), '14 matches · 11 players')
check('singular counts', sessionLine({ matches: 1, players: 1 }), '1 match · 1 player')
check('a session nobody played in', sessionLine({ matches: 0, players: 4 }), 'No matches')

const warnings = [
  { matchId: 'm1', sessionId: 's1', voided: null },
  { matchId: 'm2', sessionId: 's1', voided: { byMe: true } },
  { matchId: 'm3', sessionId: 's2', voided: null },
  { matchId: 'm4', sessionId: 's2', voided: null },
]
check('a voided match no longer counts for its session', sessionNeeds('s1', warnings), 1)
check('two waiting in one session', sessionNeeds('s2', warnings), 2)
check('a session with nothing flagged', sessionNeeds('s3', warnings), 0)
check('no flag for nothing', needsFlag(0), null)
check('one match needs you', needsFlag(1), '1 match needs you')
check('two matches need you', needsFlag(2), '2 matches need you')

check('waiting = left open + flagged, minus the voided', waitingCount({ leftOpen: [{ sessionId: 's9' }], warnings }), 4)
check('nothing waiting', waitingCount({ leftOpen: [], warnings: [] }), 0)

check('Boulevard’s all-time line', allTimeLine({ players: { count: 44 }, matches: { count: 322 }, sessions: { count: 38 } }),
  '44 players · 322 matches · 38 sessions')
check('singulars in the all-time line', allTimeLine({ players: { count: 1 }, matches: { count: 1 }, sessions: { count: 1 } }),
  '1 player · 1 match · 1 session')
check('an empty facility has no all-time line', allTimeLine({ players: { count: 0 }, matches: { count: 0 }, sessions: { count: 0 } }), null)
check('players who have not played yet still show', allTimeLine({ players: { count: 3 }, matches: { count: 0 }, sessions: { count: 0 } }),
  '3 players · 0 matches · 0 sessions')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
