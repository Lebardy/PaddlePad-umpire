#!/usr/bin/env node
// ============================================================
// Shrinking a logo before upload: the sums, and what is refused
// before anything is read. (Drawing and encoding need a browser and
// are checked on staging.)
//
//   node admin/scripts/check-logo-image.mjs
// ============================================================

import { MAX_PICKED_BYTES, fitWithin, pickProblem } from '../src/lib/logoImage.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('a wide logo keeps its shape', fitWithin(1200, 300, 512), { width: 512, height: 128 })
check('a tall logo keeps its shape', fitWithin(300, 900, 512), { width: 171, height: 512 })
check('a square one fills the box', fitWithin(2000, 2000, 128), { width: 128, height: 128 })
check('a small logo is never enlarged', fitWithin(200, 100, 512), { width: 200, height: 100 })
check('a sliver never rounds to nothing', fitWithin(5000, 2, 128), { width: 128, height: 1 })

check('a PNG is fine', pickProblem({ type: 'image/png', size: 1000 }), null)
check('a JPEG is fine', pickProblem({ type: 'image/jpeg', size: 1000 }), null)
check('a WebP is fine', pickProblem({ type: 'image/webp', size: 1000 }), null)
check('a GIF is refused', pickProblem({ type: 'image/gif', size: 1000 }), 'Pick a PNG, JPEG or WebP picture.')
check('a PDF is refused', pickProblem({ type: 'application/pdf', size: 1000 }), 'Pick a PNG, JPEG or WebP picture.')
check('10 MB is fine', pickProblem({ type: 'image/png', size: MAX_PICKED_BYTES }), null)
check('over 10 MB is refused', pickProblem({ type: 'image/png', size: MAX_PICKED_BYTES + 1 }),
  'That picture is over 10 MB. Pick a smaller one.')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
