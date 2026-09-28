#!/usr/bin/env node
// ============================================================
// The Leaderboard tab's wording, gaps and glide.
//
//   node player/scripts/check-leaderboard.mjs
// ============================================================

process.env.TZ = 'Asia/Manila'

const {
  easeInOutCubic, gapBefore, glideDuration, glideTarget, namesList, ordinal, shortDate, standingWords, stepUpFigure,
} = await import('../src/lib/leaderboard.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('ordinals', [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal),
  ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th'])
check('a date, Manila time', shortDate('2026-07-11T17:00:00Z'), '12 Jul')

check('a big gap is drawn to scale and labelled', gapBefore(1648, 1548), { px: 27.5, label: '100 PPR gap' })
check('a small gap has no label', gapBefore(1652, 1616), { px: 9.9, label: null })
check('a tie has no gap', gapBefore(1652, 1652), { px: 0, label: null })
check('a huge gap is capped', gapBefore(2700, 1500), { px: 48, label: '1,200 PPR gap' })

check('on the list, behind one player', standingWords({ state: 'on', place: 17, of: 24, points: 1476, behind: { points: 12, name: 'Dev Reyes', others: 0, place: 16 } }),
  { place: '17th', of: 24, line: '12 PPR behind Dev Reyes in 16th.', sub: null })
check('behind a tie of three', standingWords({ state: 'on', place: 5, of: 40, points: 1500, behind: { points: 3, name: 'Ana', others: 2, place: 2 } }).line,
  '3 PPR behind Ana and 2 others in 2nd.')
check('behind a tie of two', standingWords({ state: 'on', place: 3, of: 40, points: 1500, behind: { points: 1, name: 'Ana', others: 1, place: 1 } }).line,
  '1 PPR behind Ana and 1 other in 1st.')
check('at the top', standingWords({ state: 'on', place: 1, of: 40, points: 1612, behind: null }).line, 'Nobody is above you.')
check('too few matches: no place', standingWords({ state: 'needs_matches', have: 7, need: 10 }), null)
check('away: no place', standingWords({ state: 'away', lastPlayedAt: '2026-07-11T17:00:00Z' }), null)

check('glide target centres the row', glideTarget(800, 50, 300, 2000), 675)
check('glide target never goes above the top', glideTarget(40, 50, 300, 2000), 0)
check('glide target never passes the bottom', glideTarget(2400, 50, 300, 2000), 2000)
check('a short glide is at least 0.7 s', glideDuration(100), 700)
check('a long glide is at most 1.3 s', glideDuration(5000), 1300)
check('easing ends where it should', [easeInOutCubic(0), easeInOutCubic(0.5), easeInOutCubic(1)], [0, 0.5, 1])

check('PPR gained', stepUpFigure('ppr', { change: 38 }), '+38 PPR')
check('shots per mistake', stepUpFigure('shots', { before: 0.9, now: 1.3 }), '0.9 → 1.3')
check('no mistakes this month', stepUpFigure('shots', { before: 0.5, now: null }), '0.5 → no mistakes')
check('a share', stepUpFigure('mistakes', { before: 31, now: 22 }), '31% → 22%')
check('a tie with different figures, mistakes', stepUpFigure('mistakes', { change: 8 }), '8 points fewer')
check('a tie with different figures, win rate', stepUpFigure('winRate', { change: 33 }), '+33 points')
check('a tie with different figures, shots', stepUpFigure('shots', { change: 50 }), '+50%')

check('names', [namesList({ names: ['Ana'], more: 0 }), namesList({ names: ['Ana', 'Ben'], more: 0 }),
  namesList({ names: ['Ana', 'Ben', 'Cy'], more: 2 })], ['Ana', 'Ana and Ben', 'Ana, Ben, Cy and 2 more'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
