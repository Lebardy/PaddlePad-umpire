#!/usr/bin/env node
// ============================================================
// Where an old player link goes now that paddlepad.app is the landing page.
//
//   node landing/scripts/check-forward.mjs
//
// Every path but / belongs to the player app and keeps its path, query
// and hash. / stays here, unless it is an old home-screen icon (running
// as an installed app), which must open the player app, not this page.
// ============================================================

import { forwardTarget } from '../src/lib/forward.js'

const PLAY = 'https://play.paddlepad.app'
let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const at = (pathname, extra = {}) => ({ pathname, search: '', hash: '', standalone: false, ...extra })

check('home stays', forwardTarget(at('/'), PLAY), null)
check('home with a tab hash stays', forwardTarget(at('/', { hash: '#courts' }), PLAY), null)
check('a printed QR keeps its code', forwardTarget(at('/claim/AB12'), PLAY), `${PLAY}/claim/AB12`)
check('query and hash ride along', forwardTarget(at('/claim/AB12', { search: '?x=1', hash: '#y' }), PLAY), `${PLAY}/claim/AB12?x=1#y`)
check('a match page', forwardTarget(at('/matches/0b6e'), PLAY), `${PLAY}/matches/0b6e`)
check('the rating page', forwardTarget(at('/rating'), PLAY), `${PLAY}/rating`)
check('an old home-screen icon opens the player app', forwardTarget(at('/', { standalone: true }), PLAY), `${PLAY}/`)
check('a trailing slash on the setting is not doubled', forwardTarget(at('/rating'), `${PLAY}/`), `${PLAY}/rating`)
check('without a setting nothing forwards', forwardTarget(at('/rating'), ''), null)
check('index.html counts as home', forwardTarget(at('/index.html'), PLAY), null)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
