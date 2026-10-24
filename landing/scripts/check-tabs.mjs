#!/usr/bin/env node
// The top board's tabs: which one a link opens, and where the arrow keys go.
import { TABS, tabFromHash, tabAfterKey } from '../src/lib/tabs.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('the four tabs, See it first', TABS.map((t) => t.id), ['see-it', 'players', 'umpires', 'courts'])
check('no hash opens See it', tabFromHash(''), 'see-it')
check('#courts opens Courts', tabFromHash('#courts'), 'courts')
check('an unknown hash opens See it', tabFromHash('#nope'), 'see-it')
check('right from the last wraps to the first', tabAfterKey('courts', 'ArrowRight'), 'see-it')
check('left from the first wraps to the last', tabAfterKey('see-it', 'ArrowLeft'), 'courts')
check('Home and End', [tabAfterKey('umpires', 'Home'), tabAfterKey('players', 'End')], ['see-it', 'courts'])
check('other keys do nothing', tabAfterKey('players', 'a'), 'players')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
