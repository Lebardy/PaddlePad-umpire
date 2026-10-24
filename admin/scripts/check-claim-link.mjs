#!/usr/bin/env node
// ============================================================
// What the admin's claim QR holds.
//
//   node admin/scripts/check-claim-link.mjs
//
// A phone camera opens a link but only shows plain text, so the QR
// holds the player app's claim link (as the umpire app's does) and the
// player lands on the code panel with the code filled. Without the
// setting it falls back to the bare code, as before.
// ============================================================

import { claimQrText } from '../src/lib/claimLink.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('the claim link', claimQrText('AB12', 'https://play.paddlepad.app'), 'https://play.paddlepad.app/claim/AB12')
check('a trailing slash is not doubled', claimQrText('AB12', 'https://play.paddlepad.app/'), 'https://play.paddlepad.app/claim/AB12')
check('odd characters are escaped', claimQrText('A B', 'https://play.paddlepad.app'), 'https://play.paddlepad.app/claim/A%20B')
check('no setting: the bare code', claimQrText('AB12', undefined), 'AB12')
check('empty setting: the bare code', claimQrText('AB12', ''), 'AB12')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
