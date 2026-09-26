#!/usr/bin/env node
// ============================================================
// The sentence under a tapped point box.
//
//   node player/scripts/check-point-words.mjs
//
// Every way the umpire app can record a rally ending must read as a
// plain sentence about a named player -- "You" included -- and a point
// with no recorded ending, or no name, must still say something true.
// ============================================================

// The list of endings lives on the server. A test script is never part
// of the player app's build, so reaching across here is fine.
import { RALLY_ENDINGS } from '../../server/src/rally-endings.js'
import { pointKind, pointSentence } from '../src/lib/pointWords.js'

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const how = (key) => (RALLY_ENDINGS.find((e) => e.key === key).outcome === 'winner' ? 'winner' : 'mistake')

check(
  'every ending has its own sentence, not the fallback',
  RALLY_ENDINGS.filter((e) => {
    const said = pointSentence({ how: how(e.key), ending: e.key, by: 'Jan' })
    return said === pointSentence({ how: how(e.key), ending: null, by: 'Jan' })
  }).map((e) => e.key).filter((k) => !['other_winner', 'other_fault'].includes(k)),
  [],
)
check(
  'every sentence starts with the player and ends without a full stop',
  RALLY_ENDINGS.filter((e) => {
    const said = pointSentence({ how: how(e.key), ending: e.key, by: 'Jan' })
    return !said.startsWith('Jan ') || said.endsWith('.')
  }).map((e) => e.key),
  [],
)
check('a winning shot', pointSentence({ how: 'winner', ending: 'drop_winner', by: 'Jan' }), 'Jan hit a soft drop they couldn’t reach')
check('a mistake', pointSentence({ how: 'mistake', ending: 'net', by: 'Ana' }), 'Ana hit it into the net')
check('the reader is "You"', pointSentence({ how: 'mistake', ending: 'kitchen', by: 'Ana', byYou: true }), 'You stepped into the kitchen')
check('an old rally, winner', pointSentence({ how: 'winner', ending: null, by: 'Jan' }), 'Jan hit a winning shot')
check('an old rally, mistake', pointSentence({ how: 'mistake', ending: null, by: 'Jan' }), 'Jan made a mistake')
check('an ending the app does not know yet', pointSentence({ how: 'mistake', ending: 'brand_new', by: 'Jan' }), 'Jan made a mistake')
check('no name to give', pointSentence({ how: 'winner', ending: 'ace', by: null }), null)
check('the label', [pointKind('winner'), pointKind('mistake')], ['Winning shot', 'Mistake'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
