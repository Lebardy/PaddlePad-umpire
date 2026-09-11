#!/usr/bin/env node
// ============================================================
// The match-of-the-month story, checked against games read by hand.
//
//   node player/scripts/check-drama.mjs
//
// Every game below is written as its score after each point, winners
// first, and turned into the margins the page receives. The expected
// answers were worked out from those scores before the code ran.
// ============================================================

import { headline, readGame } from '../src/lib/matchDrama.js'

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

/** "0-1 1-1 ..." (winners first) -> the margins the server sends. */
function margins(path) {
  return path.split(' ').map((s) => {
    const [w, l] = s.split('-').map(Number)
    return w - l
  })
}

// ------------------------------------------------------------
console.log('\nthe real match of the month on staging, 14-12')
// ------------------------------------------------------------
{
  const game = readGame(margins(
    '0-1 1-1 1-2 1-3 1-4 2-4 3-4 4-4 5-4 6-4 7-4 7-5 7-6 7-7 7-8 8-8 9-8 10-8 10-9 10-10 11-10 11-11 12-11 12-12 13-12 14-12',
  ), 11)
  check('level 7 times', game.level, 7)
  check('lead changed hands 3 times (to 5-4, to 7-8, back at 9-8)', game.leadChanges, 3)
  check('low point 1-4', [game.lowPoint.winners, game.lowPoint.losers], [1, 4])
  check('last level at 12-12', [game.lastLevel.winners, game.lastLevel.losers], [12, 12])
  check('five game points, four of them saved', [game.winnersGamePoints, game.savedByLosers], [5, 4])
  check('the losers never had one', game.savedByWinners, 0)
  check('longest run: six by the winners', game.longestRun, { by: 'winners', points: 6 })
  check('headline', headline(game, 'Ana & Jae', 11),
    'Ana & Jae came back from 1–4 down, then needed five game points to finish it.')
}

// ------------------------------------------------------------
console.log('\na winner who saved game points')
// ------------------------------------------------------------
{
  // The losers lead 10-8 and 10-9 (8-10 and 9-10 below, winners first) --
  // two chances to win it -- and lose the next four points.
  const game = readGame(margins('1-0 1-1 1-2 2-2 2-3 3-3 3-4 4-4 4-5 5-5 5-6 6-6 6-7 7-7 7-8 8-8 8-9 8-10 9-10 10-10 11-10 12-10'), 11)
  check('the winners saved two', game.savedByWinners, 2)
  check('headline leads with the save', headline(game, 'Cy', 11),
    'Cy came back from 8–10 down, then saved two game points.')
}

// ------------------------------------------------------------
console.log('\na game the winners never trailed')
// ------------------------------------------------------------
{
  const game = readGame(margins('1-0 2-0 3-0 3-1 4-1 5-1 6-1 7-1 8-1 9-1 10-1 11-1'), 11)
  check('no low point', game.lowPoint, null)
  check('never level after the start', game.level, 0)
  check('headline', headline(game, 'Dee', 11), 'Dee never trailed on the way to 11–1.')
}

// ------------------------------------------------------------
console.log('\na plain game with nothing special in it')
// ------------------------------------------------------------
{
  // One point down once, runs of three at most, never near a close finish.
  const game = readGame(margins('0-1 1-1 2-1 3-1 3-2 4-2 5-2 6-2 6-3 7-3 8-3 9-3 9-4 10-4 11-4'), 11)
  check('headline says only what happened', headline(game, 'Eli', 11), 'Eli won 11–4.')
}

// ------------------------------------------------------------
console.log('\na game to 15, scaled correctly')
// ------------------------------------------------------------
{
  // Level or ahead the whole way, and 14-13 is a game point to 15 while
  // 13-12 is not -- the thresholds move with the target.
  const game = readGame(margins(
    '1-0 1-1 2-1 2-2 3-2 3-3 4-3 4-4 5-4 5-5 6-5 6-6 7-6 7-7 8-7 8-8 9-8 9-9 10-9 10-10 11-10 11-11 12-11 12-12 13-12 13-13 14-13 14-14 15-14 16-14',
  ), 15)
  check('game points only count at 14 and over', game.winnersGamePoints, 2)
  check('never behind', game.lowPoint, null)
  check('headline', headline(game, 'Fay & Gus', 15),
    'Fay & Gus never trailed, then needed two game points to finish it.')
}

// ------------------------------------------------------------
console.log('\nfive more real candidates from staging, not just the winner')
// ------------------------------------------------------------
// The headline was first tuned on one game. Read across all fifteen of
// the month's closest, "came back from ... down" opened eleven of them.
// These are margins exactly as the server sends them (winners' side),
// and each expected sentence was worked out from the score path first.
{
  const cases = [
    {
      who: 'Quin & Nia', score: '13–11, down 2–6',
      margins: [1, 0, -1, -2, -1, -2, -3, -4, -3, -2, -1, 0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 0, 1, 2],
      expect: 'Quin & Nia came back from 2–6 down, then needed six game points to finish it.',
    },
    {
      who: 'John & R-jay', score: '12–10 in 68 rallies, 5 lead changes',
      margins: [-1, -2, -1, 0, 1, 0, -1, 0, 1, 0, -1, -2, -3, -2, -1, 0, -1, -2, -1, 0, 1, 2],
      expect: 'John & R-jay came back from 5–8 down, then saved two game points.',
    },
    {
      who: 'Iris & Rey', score: '12–10, only ever 2 down',
      margins: [1, 2, 3, 2, 3, 4, 5, 4, 3, 2, 3, 2, 1, 0, -1, -2, -1, 0, 1, 0, 1, 2],
      expect: 'Iris & Rey came back from 7–9 down, then needed two game points to finish it.',
    },
    {
      who: 'Tara & Dev', score: '12–10, 2 down but the lead changed 4 times',
      margins: [1, 0, -1, 0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2],
      expect: 'Tara & Dev traded the lead four times, then needed five game points to finish it.',
    },
    {
      who: 'Xena & Pia', score: '11–9, one down at most',
      margins: [-1, 0, 1, 2, 3, 4, 3, 4, 5, 6, 5, 4, 3, 2, 1, 2, 1, 0, 1, 2],
      expect: 'Xena & Pia won five points in a row on the way to 11–9.',
    },
  ]
  for (const c of cases) {
    check(`${c.who} (${c.score})`, headline(readGame(c.margins, 11), c.who, 11), c.expect)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
