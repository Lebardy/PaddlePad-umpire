#!/usr/bin/env node
// A newer video answer keeps each ready video's old link (src/lib/keepLinks.js). No browser, no network.
//   node scripts/check-keep-links.mjs
import { keepLinks } from '../src/lib/keepLinks.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const was = { video: { side: 'A', url: 'old-a' }, otherVideo: { side: 'B', url: 'old-b' }, starred: [] }
const saved = { video: { side: 'A', url: 'new-a' }, otherVideo: { side: 'B', url: 'new-b' }, starred: ['r1'] }
check('each side keeps its old link, the rest is new', keepLinks(was, saved),
  { video: { side: 'A', url: 'old-a' }, otherVideo: { side: 'B', url: 'old-b' }, starred: ['r1'] })
check('an angle that just turned ready takes its new link',
  keepLinks({ video: { side: 'A', url: 'old-a' }, otherVideo: { side: 'B' } }, saved).otherVideo.url, 'new-b')
check('links follow the side, not the position',
  keepLinks(was, { video: { side: 'B', url: 'x' }, otherVideo: { side: 'A', url: 'y' } }).video.url, 'old-b')
check('an unready video stays without a link', keepLinks(was, { video: { side: 'A', state: 'filming' }, otherVideo: null }).video, { side: 'A', state: 'filming' })
check('no earlier answer: the new one as it is', keepLinks(null, saved), saved)
check('no new answer: nothing', keepLinks(was, null), null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
