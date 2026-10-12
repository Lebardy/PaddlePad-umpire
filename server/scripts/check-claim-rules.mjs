#!/usr/bin/env node
// ============================================================
// Whether a player's phone may take a match to film (src/claim-rules.js).
//
//   node server/scripts/check-claim-rules.mjs
// ============================================================

import { playerClaimVerdict } from '../src/claim-rules.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = actual === expected
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `   expected ${expected}, got ${actual}`}`)
}

const me = { playerId: 'p1', deviceId: 'phone-1' }
const filming = (over) => ({ source: 'player', state: 'filming', player_id: 'p2', device_id: 'phone-2', silent: false, ...over })

check('nobody holds it: it is this phone’s', playerClaimVerdict({ ...me, filmsMatches: false, held: null }), 'take')
check('the facility films here: never a player’s, even with no video yet', playerClaimVerdict({ ...me, filmsMatches: true, held: null }), 'facility')
check('the facility’s video is on the match already', playerClaimVerdict({ ...me, filmsMatches: false, held: filming({ source: 'facility', player_id: null }) }), 'facility')
check('a silent facility camera still keeps it', playerClaimVerdict({ ...me, filmsMatches: false, held: filming({ source: 'facility', player_id: null, silent: true }) }), 'facility')
check('this phone already holds it', playerClaimVerdict({ ...me, filmsMatches: false, held: filming({ player_id: 'p1', device_id: 'phone-1' }) }), 'mine')
check('another player is filming', playerClaimVerdict({ ...me, filmsMatches: false, held: filming() }), 'player')
check('another player’s phone has gone silent: taken over', playerClaimVerdict({ ...me, filmsMatches: false, held: filming({ silent: true }) }), 'take')
check('this player’s other phone is filming', playerClaimVerdict({ ...me, filmsMatches: false, held: filming({ player_id: 'p1' }) }), 'player')
check('this player’s other phone has gone silent: taken over', playerClaimVerdict({ ...me, filmsMatches: false, held: filming({ player_id: 'p1', silent: true }) }), 'take')
check('a video already being sent stays, however quiet', playerClaimVerdict({ ...me, filmsMatches: false, held: filming({ state: 'sending', silent: true }) }), 'player')
check('a finished video stays', playerClaimVerdict({ ...me, filmsMatches: false, held: filming({ state: 'ready', silent: true }) }), 'player')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
