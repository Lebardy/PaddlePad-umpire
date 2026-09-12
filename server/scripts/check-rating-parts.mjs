#!/usr/bin/env node
// ============================================================
// What the rating is made of, checked by hand.
//
//   node server/scripts/check-rating-parts.mjs
//
// buildRatingParts is pure -- rated rows in, three columns out -- so
// the arithmetic and the privacy rules can both be proven here with no
// database and no network. Every expected average below was worked out
// from the numbers beside it before the code ran.
//
// One deliberate choice in the data: no group average equals any
// member's own value. The first privacy check written for the playstyle
// proof could not tell a leaked value from an average, because the
// averages happened to land on a member's number. These do not, so
// "this figure came from one person" is a detectable failure.
// ============================================================

import { buildRatingParts, MIN_GROUP_MEMBERS, PARTS } from '../src/rating-parts.js'

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

function section(title) {
  console.log(`\n${title}`)
}

const MAX = { winningShots: 30, dropsLanding: 25, netMistakes: 25, mistakes: 20 }
const UNIT = {
  winningShots: 'per_minute',
  dropsLanding: 'proportion',
  netMistakes: 'per_minute',
  mistakes: 'per_minute',
}

/** One rated player's four parts: [value, points] each. */
const parts = (w, d, n, m) => ({
  winningShots: { value: w[0], points: w[1], max: 30, unit: 'per_minute' },
  dropsLanding: { value: d[0], points: d[1], max: 25, unit: 'proportion' },
  netMistakes: { value: n[0], points: n[1], max: 25, unit: 'per_minute' },
  mistakes: { value: m[0], points: m[1], max: 20, unit: 'per_minute' },
})

const rated = (group, p) => ({ skill_group: group, score_parts: p })

// This player. 10 + 12 + 20 + 8 = 50, which is what their rating is.
const MINE = parts([0.2, 10], [0.48, 12], [0.1, 20], [0.4, 8])

// Their group: themselves and two others.
//   winning shots  points 10, 13, 19 -> 14     values 0.20, 0.26, 0.38 -> 0.28
//   drops landing  points 12, 14, 19 -> 15     values 0.48, 0.54, 0.63 -> 0.55
//   net mistakes   points 20, 15, 13 -> 16     values 0.10, 0.19, 0.25 -> 0.18
//   mistakes       points  8,  9, 13 -> 10     values 0.40, 0.36, 0.26 -> 0.34
const GROUP = [
  rated('Middle', MINE),
  rated('Middle', parts([0.26, 13], [0.54, 14], [0.19, 15], [0.36, 9])),
  rated('Middle', parts([0.38, 19], [0.63, 19], [0.25, 13], [0.26, 13])),
]

// The rung above.
//   winning shots  points 22, 23, 27 -> 24     values 0.44, 0.46, 0.54 -> 0.48
//   drops landing  points 19, 20, 24 -> 21     values 0.66, 0.67, 0.71 -> 0.68
//   net mistakes   points 18, 19, 23 -> 20     values 0.14, 0.11, 0.11 -> 0.12
//   mistakes       points 14, 13, 18 -> 15     values 0.24, 0.23, 0.19 -> 0.22
const ABOVE = [
  rated('Upper', parts([0.44, 22], [0.66, 19], [0.14, 18], [0.24, 14])),
  rated('Upper', parts([0.46, 23], [0.67, 20], [0.11, 19], [0.23, 13])),
  rated('Upper', parts([0.54, 27], [0.71, 24], [0.11, 23], [0.19, 18])),
]

const row = (result, key) => result.parts.find((part) => part.key === key)

// ============================================================
section('the three columns')
// ============================================================
{
  const result = buildRatingParts({ mine: MINE, peers: GROUP, above: ABOVE })

  check('the parts come back in reading order, biggest share of the score first',
    result.parts.map((part) => [part.key, part.max]),
    [['winningShots', 30], ['dropsLanding', 25], ['netMistakes', 25], ['mistakes', 20]],
    'the model weights winning shots 30% and mistakes away from the net 20%; that order is the model\'s, not the page\'s')

  check('this player, their level, and the rung above — winning shots',
    [row(result, 'winningShots').you, row(result, 'winningShots').group, row(result, 'winningShots').above],
    [{ points: 10, value: 0.2 }, { points: 14, value: 0.28 }, { points: 24, value: 0.48 }],
    'group averages all three including this player; above averages the three in the group up')

  check('and net mistakes, the one part they are ahead on',
    [row(result, 'netMistakes').you, row(result, 'netMistakes').group, row(result, 'netMistakes').above],
    [{ points: 20, value: 0.1 }, { points: 16, value: 0.18 }, { points: 20, value: 0.12 }],
    'fewer mistakes is more points, so being above the group average here is being better than it')

  check('the four parts still add up to the rating',
    result.parts.reduce((sum, part) => sum + part.you.points, 0), 50,
    'the pipeline asserts this too; if it ever stopped holding the page would explain a number it no longer describes')

  check('how big each comparison group is, and that both were averaged',
    [result.groupSize, result.aboveSize, result.groupAveraged, result.aboveAveraged],
    [3, 3, true, true],
    'counts only — the page says what an average rests on, never who is in it')
}

// ============================================================
section('nobody else\'s numbers leave')
// ============================================================
{
  const result = buildRatingParts({ mine: MINE, peers: GROUP, above: ABOVE })

  // Parsed as NUMBERS rather than matched as text, and the data above
  // is chosen so that no average coincides with a member's value.
  //
  // Compared PART BY PART, which is the only comparison that means
  // anything: a drop rate of 0.14 and a mistake rate of 0.14 are two
  // unrelated quantities that happen to share a digit, and a check that
  // pools all four together reports those coincidences as leaks. It did
  // on the first run of this file.
  const published = new Map()
  for (const part of result.parts) {
    const numbers = new Set()
    for (const column of [part.you, part.group, part.above]) {
      if (column) {
        numbers.add(column.points)
        numbers.add(column.value)
      }
    }
    published.set(part.key, numbers)
  }
  const otherPeoples = []
  for (const person of [...GROUP.slice(1), ...ABOVE]) {
    for (const key of Object.keys(MAX)) {
      const own = person.score_parts[key]
      if (published.get(key).has(own.points)) otherPeoples.push([key, 'points', own.points])
      if (published.get(key).has(own.value)) otherPeoples.push([key, 'value', own.value])
    }
  }
  check('no individual value of anyone else appears anywhere in the result',
    otherPeoples, [],
    'averages and this player\'s own numbers only — the same line the playstyle proof draws')

  check('and nothing identifies a person at all',
    Object.keys(result).filter((key) => /player|name|id/i.test(key)), [],
    'no ids, no names, and no ordering for a caller to rebuild a leaderboard from')
}

// ============================================================
section('a group too small to average is never averaged')
// ============================================================
{
  const result = buildRatingParts({ mine: MINE, peers: GROUP, above: ABOVE.slice(0, 2) })
  check('two players above: the column is withheld, the rest stands',
    [result.parts.map((part) => part.above), result.aboveAveraged, result.aboveSize],
    [[null, null, null, null], false, 2],
    `under ${MIN_GROUP_MEMBERS} an average describes individuals; the page says what separates them from nobody rather than naming two people`)
  check('their own group is unaffected',
    row(result, 'winningShots').group, { points: 14, value: 0.28 },
    'one comparison being withheld never removes the other')
}

{
  const result = buildRatingParts({ mine: MINE, peers: GROUP.slice(0, 2), above: ABOVE })
  check('a group of two around this player is not averaged either',
    [result.parts.map((part) => part.group), result.groupAveraged],
    [[null, null, null, null], false],
    'the same floor applies to the player\'s own level — the page then says so instead of comparing')
}

// ============================================================
section('the top of the ladder, and the bottom of the data')
// ============================================================
{
  const result = buildRatingParts({ mine: MINE, peers: GROUP, above: [] })
  check('nobody above: no column, and the size says why',
    [result.parts.map((part) => part.above), result.aboveAveraged, result.aboveSize],
    [[null, null, null, null], false, 0],
    'the page reads this as "there is no group above yours", which is a fact worth showing on its own')
}

{
  check('a run published before the pipeline sent any of this',
    buildRatingParts({ mine: null, peers: GROUP, above: ABOVE }), null,
    'the rating above it is still true, so the page shows the score and simply nothing underneath')

  const { winningShots, ...incomplete } = MINE
  check('three parts out of four is not a breakdown of anything',
    buildRatingParts({ mine: incomplete, peers: GROUP, above: ABOVE }), null,
    'a partial breakdown would silently stop adding up to the rating, which is the one claim this makes')
}

// ============================================================
section('the parts are the ones the model actually uses')
// ============================================================
{
  check('four of them, and the shares add to 100',
    [PARTS.length, Object.values(MAX).reduce((sum, n) => sum + n, 0)],
    [4, 100],
    'drop shots 25, winning shots 30, mistakes 20, net mistakes 25 — the whole of skill_model.SKILL_WEIGHTS')
  check('every part is labelled in everyday words',
    PARTS.map((part) => part.label),
    ['winning shots', 'drop shots landing', 'mistakes at the net', 'mistakes away from the net'],
    'the player app never says "dink error"; the umpire app still may')
  check('and the two mistake rows are distinguishable from each other',
    PARTS.filter((part) => part.label.includes('mistakes')).length, 2,
    'the model counts a mistake at the net and a mistake anywhere else separately, and never both')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
