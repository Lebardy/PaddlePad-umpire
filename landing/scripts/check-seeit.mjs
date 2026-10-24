#!/usr/bin/env node
// ============================================================
// The See it screens are copies of the real apps' screens, so the parts
// that can drift are held to their sources: the umpire's scoring keys
// to server/src/rally-endings.js and src/components/Icon.jsx, and the
// sample game to the score the sample rally changes.
//
//   node landing/scripts/check-seeit.mjs
// ============================================================

import { readFileSync } from 'node:fs'
import { RALLY_ENDINGS } from '../../server/src/rally-endings.js'
import { ENDINGS } from '../src/lib/endings.js'
import { expectedWin, DEFAULT_K, MATCH_REWARD } from '../../server/src/rally-rating.js'
import { gameWinChance } from '../../server/src/game-chance.js'
import { deriveMatchState } from '../../server/src/pickleball.js'
import { rallyEnding } from '../../server/src/rally-endings.js'
import { SAMPLE, POINTS, LATER, RALLIES, RATED, ENDED, STARRED, STARRED_RALLIES, SAMPLE_RALLY } from '../src/lib/loop.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const icons = readFileSync(new URL('../../src/components/Icon.jsx', import.meta.url), 'utf8')
const iconPath = (key) => icons.match(new RegExp(`^  ${key}: '([^']+)',`, 'm'))?.[1]

check('all 18 keys, in the real order, with the real labels and outcomes',
  ENDINGS.map((e) => [e.key, e.label, e.outcome]),
  RALLY_ENDINGS.map((e) => [e.key, e.label, e.outcome]))
check('server-only endings marked as the real screen marks them', ENDINGS.map((e) => Boolean(e.by)), RALLY_ENDINGS.map((e) => Boolean(e.by)))
check('each key carries the umpire app’s own icon', ENDINGS.map((e) => e.path), ENDINGS.map((e) => iconPath(e.key)))

// The sample game goes through the umpire app's own scoring engine, so the
// log can only be one the real apps could have produced.
const ID = { Rio: 'rio', Dani: 'dani' }
const match = {
  id: 'sample', teamA: ['rio'], teamB: ['dani'], firstServer: { team: 'A', playerId: 'rio' }, rightStart: { A: 0, B: 0 }, pointTarget: 11,
  events: RALLIES.map((r, i) => {
    const e = rallyEnding(r.key)
    return { id: `r${i + 1}`, seq: i + 1, type: 'rally', actingPlayerId: ID[r.by], outcome: e.outcome, zone: e.zone, detail: r.key }
  }),
}
const stateAt = (n) => deriveMatchState({ ...match, events: match.events.slice(0, n) })
const end = stateAt(RALLIES.length)
check('the engine ends it 11-6 to Rio, finished, all 27 rallies counted', [end.score.A, end.score.B, end.completed, end.winner, end.foldedEvents], [11, 6, true, 'A', 27])
check('before the sample rally it is 7-5 with Rio serving', [stateAt(SAMPLE_RALLY - 1).score, stateAt(SAMPLE_RALLY - 1).servingTeam], [{ A: SAMPLE.before[0], B: SAMPLE.before[1] }, 'A'])
check('the sample rally makes it 8-5', stateAt(SAMPLE_RALLY).score, { A: SAMPLE.after[0], B: SAMPLE.after[1] })
const pointRallies = RALLIES.map((_, i) => i + 1).filter((n) => { const s = stateAt(n).score; const p = n === 1 ? { A: 0, B: 0 } : stateAt(n - 1).score; return s.A + s.B !== p.A + p.B })
check('the points are these rallies', pointRallies, [1, 2, 4, 6, 8, 9, 11, 13, 15, 16, 18, 20, 21, 23, 25, 26, 27])
check('POINTS and LATER are who won each of them', POINTS.concat(LATER), pointRallies.map((n) => Number(stateAt(n).score.A > stateAt(n - 1).score.A || (n === 1 && stateAt(1).score.A > 0))))
check('the sample rally is the 13th point, and Rio’s', [pointRallies[12], POINTS.length, POINTS.at(-1)], [SAMPLE_RALLY, 13, 1])
check('stars: 2 before, 3 after, the rally last', [STARRED.length - 1, STARRED.length, STARRED.at(-1)], [...SAMPLE.stars, POINTS.length])
check('the starred boxes are those rallies', STARRED.map((b) => pointRallies[b - 1]), STARRED_RALLIES)
check('every rally has an ending, and the times only go forward', RALLIES.every((r, i) => ENDINGS.some((e) => e.key === r.key) && (i === 0 || r.at > RALLIES[i - 1].at)), true)
check('the sample rally is Rio’s dink winner, and the last rally a put-away', [RALLIES[SAMPLE_RALLY - 1].by, RALLIES[SAMPLE_RALLY - 1].key, RALLIES.at(-1).key], ['Rio', 'dink_winner', 'putaway'])

// Rio's phone: replay all 27 rallies through the real rule (singles: all of a
// rally's stake goes to who ended it), taking each winner from its ending.
let [rioPts, daniPts] = [RATED.rio, RATED.dani]
const ended = {}
RALLIES.forEach((r) => {
  const actorWon = ENDINGS.find((e) => e.key === r.key).outcome === 'winner'
  const [w, l] = (actorWon ? r.by === 'Rio' : r.by !== 'Rio') ? [rioPts, daniPts] : [daniPts, rioPts]
  const stake = DEFAULT_K * (1 - expectedWin(w, l))
  const change = (r.by === 'Rio' ? 1 : -1) * (actorWon ? stake : -stake)
  rioPts += change
  daniPts -= change
  if (r.by === 'Rio') (ended[r.key] ??= []).push(change)
})
const sum = (key) => Math.round((ended[key] ?? []).reduce((a, b) => a + b, 0))
check('"cost you most": the net, 2 rallies, and its PPR', [ended.net.length, sum('net')], [ENDED.cost.rallies, ENDED.cost.ppr])
check('"won you most": dink winners, 3 rallies, and their PPR', [ended.dink_winner.length, sum('dink_winner')], [ENDED.won.rallies, ENDED.won.ppr])
for (const [outcome, leader] of [['winner', 'dink_winner'], ['error', 'net']]) {
  const rows = Object.entries(ended).filter(([k]) => ENDINGS.find((e) => e.key === k).outcome === outcome)
  const most = Math.max(...rows.map(([, v]) => v.length))
  check(`only ${leader} has the most ${outcome} rallies`, rows.filter(([, v]) => v.length === most).map(([k]) => k), [leader])
}
const reward = MATCH_REWARD * (1 - gameWinChance(expectedWin(RATED.rio, RATED.dani), { doubles: false, target: 11, firstServer: 'A' }))
check('the rating the match leaves Rio on is the one step 5 shows', Math.round(rioPts + reward), SAMPLE.rating)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
