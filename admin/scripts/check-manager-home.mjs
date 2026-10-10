#!/usr/bin/env node
// ============================================================
// The words on a manager's home page, checked against the state of
// every facility on staging on 2026-10-10.
//
//   node admin/scripts/check-manager-home.mjs
// ============================================================

import {
  allTimeLine, missingLine, needsFlag, placeFacts, sessionLine, sessionNeeds, umpireLastText, umpireWeekText, waitingCount,
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
const valencia = { openingHours: '6:00 AM – 6:00 PM', hourlyFeeCentavos: 10000, feeText: '₱100 per hour', umpireFeeCentavos: null, umpireFeeText: null, logoUrl: null, locationUrl: null }
const starting = { openingHours: null, hourlyFeeCentavos: null, feeText: 'Fee not set', umpireFeeCentavos: null, umpireFeeText: null, logoUrl: null, locationUrl: null }
const complete = { ...boulevard, logoUrl: '/logos/f1?v=1', locationUrl: 'https://maps.example/f1' }

check('Boulevard lacks only a logo and a map link', missingLine(boulevard), 'Players can’t see yet: logo, map link.')
check('Sibulan: a free court is a court fee', missingLine(sibulan), 'Players can’t see yet: logo, opening hours, umpire fee, map link.')
check('Valencia lacks an umpire fee too', missingLine(valencia), 'Players can’t see yet: logo, umpire fee, map link.')
check('a facility with nothing filled in lists all five', missingLine(starting),
  'Players can’t see yet: logo, opening hours, court fee, umpire fee, map link.')
check('nothing missing is no line at all', missingLine(complete), null)

check('Boulevard’s three facts', placeFacts(boulevard).map((f) => f.value), ['6:00 AM – 10:00 PM daily', '₱200 per hour', '₱100 per hour'])
check('Sibulan: Free shows, the rest say Not set', placeFacts(sibulan).map((f) => f.value), ['Not set', 'Free', 'Not set'])
check('an unset court fee says Not set, not "Fee not set"', placeFacts(starting).map((f) => f.value), ['Not set', 'Not set', 'Not set'])

const now = Date.parse('2026-10-10T04:00:00Z')
check('an umpire with matches this week', umpireWeekText({ weekMatches: 21 }), '21 matches this week')
check('one match, not one matches', umpireWeekText({ weekMatches: 1 }), '1 match this week')
check('a quiet week', umpireWeekText({ weekMatches: 0 }), 'None this week')
check('last scored names the day in Manila', umpireLastText({ lastScoredAt: '2026-10-06T11:58:00Z' }, now), 'Last scored Tuesday, Oct 6')
check('late evening UTC is the next day in Manila', umpireLastText({ lastScoredAt: '2026-10-06T17:00:00Z' }, now), 'Last scored Wednesday, Oct 7')
check('a new umpire', umpireLastText({ lastScoredAt: null }, now), 'Hasn’t scored yet')

check('a session row', sessionLine({ matches: 14, players: 11, openedBy: 'Paolo Sy' }), '14 matches · 11 players · run by Paolo Sy')
check('singular counts', sessionLine({ matches: 1, players: 1, openedBy: 'Paolo Sy' }), '1 match · 1 player · run by Paolo Sy')
check('a session nobody played in', sessionLine({ matches: 0, players: 4, openedBy: 'Joy Abellana' }), 'No matches · run by Joy Abellana')
check('an umpire since removed', sessionLine({ matches: 7, players: 6, openedBy: null }), '7 matches · 6 players')

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
check('an empty facility', allTimeLine({ players: { count: 0 }, matches: { count: 0 }, sessions: { count: 0 } }),
  '0 players · 0 matches · 0 sessions')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
