#!/usr/bin/env node
// ============================================================
// What a path says about the code panel on the sign-in screen.
//
//   node player/scripts/check-claim-path.mjs
//
// A printed QR opens /claim/CODE and must land on the panel with the
// code filled. The landing page's "Have a code?" opens a bare /claim
// and must land on the same panel, empty. Anything else is not a claim.
// ============================================================

import { claimFromPath } from '../src/lib/claimPath.js'

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('a QR link opens the panel with its code', claimFromPath('/claim/AB12'), { open: true, code: 'AB12' })
check('an escaped code is read back', claimFromPath('/claim/A%20B'), { open: true, code: 'A B' })
check('bare /claim opens the panel empty', claimFromPath('/claim'), { open: true, code: '' })
check('/claim/ opens the panel empty', claimFromPath('/claim/'), { open: true, code: '' })
check('the home page is not a claim', claimFromPath('/'), { open: false, code: '' })
check('/you is not a claim', claimFromPath('/you'), { open: false, code: '' })
check('/claimed is not a claim', claimFromPath('/claimed'), { open: false, code: '' })
check('a deeper path is not a code', claimFromPath('/claim/AB12/x'), { open: true, code: 'AB12/x' })

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
