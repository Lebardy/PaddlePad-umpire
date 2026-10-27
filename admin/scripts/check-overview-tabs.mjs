#!/usr/bin/env node
// The Overview's tab in the address, and the Worth a look filters.
//   node admin/scripts/check-overview-tabs.mjs
import { readTab } from '../src/lib/tabParam.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('a known tab', readTab('?tab=look', ['now', 'look'], 'now'), 'look')
check('no tab -> fallback', readTab('', ['now', 'look'], 'now'), 'now')
check('unknown tab -> fallback', readTab('?tab=xyz', ['now', 'look'], 'look'), 'look')
check('other params are ignored', readTab('?facilityId=1&tab=now', ['now', 'look'], 'look'), 'now')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
