#!/usr/bin/env node
// ============================================================
// The page's words against the system they describe.
//
//   node landing/scripts/check-content.mjs
//
// The landing page states facts about PaddlePad. These checks tie each
// one to its source, so the page cannot drift from the apps: the 18 is
// the umpire app's list of rally endings, the playstyle names are the
// pipeline's, and the copy never says "club" (PaddlePad has none).
// ============================================================

import { readFileSync } from 'node:fs'
import { RALLY_ENDINGS } from '../../server/src/rally-endings.js'
import { AUDIENCES, TALLY, RATING_STEPS } from '../src/lib/content.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const all = JSON.stringify({ AUDIENCES, TALLY, RATING_STEPS })
const pipeline = readFileSync(new URL('../../ml/pipeline/clustering.py', import.meta.url), 'utf8')
// Only the IDENTITY_DESCRIPTORS block: other tuples in the file are adjectives.
const block = pipeline.slice(pipeline.indexOf('IDENTITY_DESCRIPTORS = {'), pipeline.indexOf('}', pipeline.indexOf('IDENTITY_DESCRIPTORS = {')))
const nouns = [...block.matchAll(/\("([A-Z][\w -]+)", "([A-Z][\w -]+)"\)/g)].flatMap((m) => [m[1], m[2]])
const fallback = pipeline.match(/DEFAULT_IDENTITY_NOUN = "([^"]+)"/)[1]

const endings = RALLY_ENDINGS.length
check('the tally reads 2 / <endings> / 5 / 3 AM', TALLY.map((t) => t.value), [2, endings, 5, '3 AM'])
check('the endings count appears wherever endings are counted', (all.match(/\b(\d+) (ways|kinds of ending)/g) ?? []).every((s) => s.startsWith(`${endings} `)), true)
check('the pipeline still has these five playstyle names', [...new Set([...nouns, fallback])].sort(), ['All-Court Player', 'Driver', 'Dropper', 'Net Player', 'Power Player'])
check('every playstyle name appears in the Players facts', ['Dropper', 'Driver', 'Net Player', 'Power Player', 'All-Court'].every((n) => JSON.stringify(AUDIENCES.players).includes(n)), true)
check('every playstyle name appears in the rating steps', ['Dropper', 'Driver', 'Net Player', 'Power Player', 'All-Court Player'].every((n) => JSON.stringify(RATING_STEPS).includes(n)), true)
check('four facts per audience', Object.values(AUDIENCES).map((a) => a.facts.length), [4, 4, 4])
check('four rating steps', RATING_STEPS.length, 4)
check('every fact and step has an icon', [...Object.values(AUDIENCES).flatMap((a) => a.facts), ...RATING_STEPS].every((f) => f.icon), true)
check('never says club', /club/i.test(all), false)
check('courts button mails the owner', AUDIENCES.courts.actions[0].href.startsWith('mailto:jhlibrando.student@asiancollege.edu.ph'), true)
check('Have a code goes to /claim', AUDIENCES.players.actions.find((a) => /code/i.test(a.label)).href.endsWith('/claim'), true)
check('umpires are told it is invite only', JSON.stringify(AUDIENCES.umpires.actions).includes('Invite only'), true)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
