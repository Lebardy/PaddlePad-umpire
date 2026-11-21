#!/usr/bin/env node
// What sharing a video file answers (src/lib/saveFile.js). No network, no browser.
//   node player/scripts/check-save-file.mjs
import { SHARE_LIMIT_BYTES, shareFile } from '../src/lib/saveFile.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const small = { name: 'a highlights.mp4', size: 1000 }
let calls = 0
const sharing = (result) => {
  calls = 0
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { share: async () => { calls += 1; if (result) throw result } } })
}
const named = (name) => Object.assign(new Error(name), { name })

sharing(null)
check('shared', await shareFile(small), 'shared')
sharing(named('AbortError'))
check('the player cancelled', await shareFile(small), 'cancelled')
sharing(named('NotAllowedError'))
check('the tap was too long ago', await shareFile(small), 'needs-tap')
sharing(named('TypeError'))
let thrown = null
try { await shareFile(small) } catch (e) { thrown = e.name }
check('another error is rethrown', thrown, 'TypeError')
sharing(null)
check('a file over the limit is not shared', [await shareFile({ name: 'big.mp4', size: SHARE_LIMIT_BYTES + 1 }), calls], ['too-big', 0])
check('a file at the limit is', [await shareFile({ name: 'edge.mp4', size: SHARE_LIMIT_BYTES }), calls], ['shared', 1])

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
