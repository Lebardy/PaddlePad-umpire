#!/usr/bin/env node
// ============================================================
// A filming phone's own small decisions (src/lib/filming.js), and the
// one thing about updates the camera relies on.
//
//   node player/scripts/check-filming.mjs
// ============================================================

import { readFileSync, readdirSync } from 'node:fs'
import { CLAIM_AGAIN_MS, coveredBy, coveredFrom, mayClaim } from '../src/lib/filming.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

console.log('\nwhat a refused claim leaves behind')
const byPlayer = { status: 409, details: { covered: { by: 'player', name: 'Joshua Manalo' } } }
const byFacility = { status: 409, details: { covered: { by: 'facility', name: 'Boulevard Paddle Courts' } } }
check('another player is filming', coveredFrom(byPlayer, 'm1', 1000), { matchId: 'm1', by: 'player', name: 'Joshua Manalo', againAt: 1000 + CLAIM_AGAIN_MS })
check('the facility is filming', coveredFrom(byFacility, 'm1', 1000), { matchId: 'm1', by: 'facility', name: 'Boulevard Paddle Courts', againAt: 1000 + CLAIM_AGAIN_MS })
check('a refusal that names nobody (the match is gone, the connection dropped) is not "covered"', coveredFrom({ status: 404, details: {} }, 'm1', 1000), null)
check('nor is an error with no answer at all', coveredFrom(new Error('timeout'), 'm1', 1000), null)
check("a beat that says another player's phone took the match over reads the same way", coveredBy({ by: 'player', name: 'Joshua Manalo' }, 'm1', 1000), { matchId: 'm1', by: 'player', name: 'Joshua Manalo', againAt: 1000 + CLAIM_AGAIN_MS })
check('a beat that says nothing of the kind leaves nothing', coveredBy(undefined, 'm1', 1000), null)

console.log('\nwhen a phone asks for a match')
const held = coveredFrom(byPlayer, 'm1', 1000)
check('a match nobody has refused is asked for', mayClaim(null, 'm1', 1000), true)
check('one another player is filming is not asked for again at once', mayClaim(held, 'm1', 1000 + CLAIM_AGAIN_MS - 1), false)
check('but again after 10 seconds, in case their phone has gone quiet', mayClaim(held, 'm1', 1000 + CLAIM_AGAIN_MS), true)
check('one the facility films is never asked for again', mayClaim(coveredFrom(byFacility, 'm1', 1000), 'm1', 1000 + 60 * 60_000), false)
check('the next match is asked for at once', mayClaim(held, 'm2', 1001), true)
check('a blocked phone asks every 10 seconds', CLAIM_AGAIN_MS, 10_000)

// The camera screen relies on this: today a new version's service
// worker takes over WITHOUT reloading an open page, so an update never
// cuts a recording. Anything that reloads on an update (the
// vite-plugin-pwa register module, a controllerchange listener) would,
// and must then wait for the camera screen to close.
console.log('\nan update never reloads an open page')
const sources = readdirSync(new URL('../src', import.meta.url), { recursive: true })
  .filter((name) => /\.(js|jsx)$/.test(name))
  .map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'))
check('nothing in the app registers for update reloads', sources.some((text) => /virtual:pwa-register|controllerchange/.test(text)), false)
check('the build still registers the service worker by itself', /registerType:\s*'autoUpdate'/.test(readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8')), true)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
