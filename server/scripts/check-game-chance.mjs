#!/usr/bin/env node
// ============================================================
// The chance of winning a game, from the chance of winning a rally.
//
//   node server/scripts/check-game-chance.mjs
//
// Only the serving side scores, so a small edge per rally grows over a
// game in a way that depends on the serving rules. gameWinChance works
// it out exactly; this checks it against common sense and against the
// real scoring engine playing thousands of games. Pure, so no database
// and no network. The simulated games use a fixed seed, so the result
// never changes from run to run.
// ============================================================

import { gameWinChance } from '../src/game-chance.js'
import { deriveMatchState } from '../src/pickleball.js'

let pass = 0
let fail = 0
function check(label, actual, expected, why) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label}` +
    (ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`) +
    `\n       ${why}`,
  )
}
const section = (title) => console.log(`\n${title}`)
const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance

section('common sense')
{
  check('a level doubles game is as good as even',
    near(gameWinChance(0.5, { doubles: true, target: 11, firstServer: 'A' }), 0.5, 1e-6), true,
    'The one-server start all but cancels serving first; to 11 it leaves A about 0.0000025% short.')
  check('serving first in a level singles game is a small edge',
    ((c) => c > 0.5 && c < 0.56)(gameWinChance(0.5, { doubles: false, target: 11, firstServer: 'A' })), true,
    'Singles has no one-server start, so the first server gets the first chance to score.')
  check('B\'s chance is one minus A\'s',
    near(gameWinChance(0.53, { doubles: true, target: 11, firstServer: 'A' }) +
      gameWinChance(0.47, { doubles: true, target: 11, firstServer: 'B' }), 1, 1e-9), true,
    'Swapping the sides and who serves first swaps the answer.')
  const rising = [0, 0.2, 0.45, 0.5, 0.52, 0.6, 0.9, 1].map((p) => gameWinChance(p, { doubles: true, target: 11, firstServer: 'A' }))
  check('a better rally chance never means a worse game chance',
    rising.every((c, i) => i === 0 || c >= rising[i - 1]), true, `game chances ${rising.map((c) => c.toFixed(3)).join(', ')}`)
  check('certain rallies make a certain game',
    [gameWinChance(1, { doubles: true, target: 11, firstServer: 'B' }), gameWinChance(0, { doubles: false, target: 11, firstServer: 'A' })], [1, 0],
    'Nothing can go wrong for a side that wins every rally.')
  const to = (target) => gameWinChance(0.53, { doubles: true, target, firstServer: 'A' })
  check('a longer game turns the same edge into a bigger chance',
    to(11) < to(15) && to(15) < to(21), true, 'More rallies give the better side more room to show it.')
  check('no rally chance, no game chance',
    Number.isNaN(gameWinChance(Number.NaN, { doubles: true, target: 11, firstServer: 'A' })), true,
    'A missing number must not quietly become a real one.')
}

section('against the real scoring engine')
{
  // mulberry32: small, seeded and good enough for this.
  let seed = 20260914
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const GAMES = 20000
  function played(p, { doubles, target, firstServer }) {
    let aWon = 0
    for (let game = 0; game < GAMES; game += 1) {
      const events = Array.from({ length: 400 }, (_, i) => ({
        type: 'rally', id: String(i), actingPlayerId: random() < p ? 'a1' : 'b1', outcome: 'winner', zone: 'open',
      }))
      const { winner } = deriveMatchState({
        teamA: doubles ? ['a1', 'a2'] : ['a1'],
        teamB: doubles ? ['b1', 'b2'] : ['b1'],
        firstServer: { team: firstServer, playerId: firstServer === 'A' ? 'a1' : 'b1' },
        rightStart: doubles ? { A: 'a1', B: 'b1' } : undefined,
        pointTarget: target,
        events,
      })
      if (winner === 'A') aWon += 1
    }
    return aWon / GAMES
  }
  for (const [p, rules] of [
    [0.5, { doubles: false, target: 11, firstServer: 'A' }],
    [0.52, { doubles: true, target: 11, firstServer: 'A' }],
    [0.55, { doubles: false, target: 15, firstServer: 'B' }],
    [0.45, { doubles: true, target: 21, firstServer: 'B' }],
  ]) {
    const exact = gameWinChance(p, rules)
    const engine = played(p, rules)
    check(`rally ${p}, ${rules.doubles ? 'doubles' : 'singles'} to ${rules.target}, ${rules.firstServer} serves first`,
      near(exact, engine, 0.01), true,
      `worked out ${(exact * 100).toFixed(1)}%, engine played ${(engine * 100).toFixed(1)}% of ${GAMES} games`)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
