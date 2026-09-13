#!/usr/bin/env node
// ============================================================
// The rally rating, checked rule by rule.
//
//   node server/scripts/check-rally-rating.mjs
//
// Every rally is a small contest: the side that won it takes points
// from the side that lost, more for an upset, weighted by how the rally
// ended. Pure functions only: hand-built matches, no database.
// ============================================================

import { randomUUID } from 'node:crypto'
import {
  ACTOR_SHARE,
  DEFAULT_K,
  ENDING_WEIGHTS,
  START_POINTS,
  endingWeight,
  expectedWin,
  rateHistory,
} from '../src/rally-rating.js'
import { RALLY_ENDINGS, rallyEnding } from '../src/rally-endings.js'

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
const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) <= tolerance
const section = (title) => console.log(`\n${title}`)

const [A1, A2, B1, B2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]

/** A rally ended by `playerId` with ending `detail` (or bare outcome). */
function rally(playerId, detailOrOutcome) {
  const ending = rallyEnding(detailOrOutcome)
  return ending
    ? { type: 'rally', id: randomUUID(), actingPlayerId: playerId, outcome: ending.outcome, zone: ending.zone, detail: ending.key }
    : { type: 'rally', id: randomUUID(), actingPlayerId: playerId, outcome: detailOrOutcome, zone: 'open' }
}

let clock = Date.parse('2026-09-01T10:00:00Z')
function match(events, { doubles = true, id = randomUUID() } = {}) {
  clock += 60 * 60_000
  return {
    id,
    endedAt: new Date(clock).toISOString(),
    teamA: doubles ? [A1, A2] : [A1],
    teamB: doubles ? [B1, B2] : [B1],
    firstServer: { team: 'A', playerId: A1 },
    rightStart: doubles ? { A: A1, B: B1 } : undefined,
    pointTarget: 11,
    events,
  }
}

section('The ending weights')
check(
  'every ending has a weight',
  RALLY_ENDINGS.filter((e) => typeof ENDING_WEIGHTS[e.key] !== 'number').map((e) => e.key),
  [],
  'An ending without a weight would silently count as 1 and nobody would notice.',
)
check(
  'weights match the agreed table',
  [endingWeight('kitchen'), endingWeight('out'), endingWeight('other_winner'), endingWeight('hit_by_ball'), endingWeight(undefined)],
  [1.25, 1, 0.75, 0.5, 1],
  'Self-inflicted faults weigh more, forced or bookkeeping ones less, and older rallies with no ending count normally.',
)

section('One rally between equal sides')
{
  const ratings = rateHistory([match([rally(A1, 'putaway')])])
  const stake = DEFAULT_K * 1 * (1 - 0.5)
  check('everyone started at 1500 and equal sides expect 50%', expectedWin(START_POINTS, START_POINTS), 0.5,
    'With no history, a rally is a coin flip.')
  check('the hitter gains three quarters of the stake',
    near(ratings.get(A1).rawPoints, START_POINTS + stake * ACTOR_SHARE), true,
    'The player who ended the rally takes most of the credit.')
  check('their partner gains one quarter',
    near(ratings.get(A2).rawPoints, START_POINTS + stake * (1 - ACTOR_SHARE)), true,
    'Doubles is a team effort, so the partner shares a little.')
  check('the other side splits the loss evenly',
    [near(ratings.get(B1).rawPoints, START_POINTS - stake / 2), near(ratings.get(B2).rawPoints, START_POINTS - stake / 2)], [true, true],
    'Neither opponent ended the rally, so neither is singled out.')
  const total = [A1, A2, B1, B2].reduce((sum, id) => sum + ratings.get(id).rawPoints - START_POINTS, 0)
  check('points are only moved, never created', near(total, 0), true,
    'The pool average must stay at 1500.')
}

section('A fault')
{
  const ratings = rateHistory([match([rally(A1, 'kitchen')])])
  const stake = DEFAULT_K * 1.25 * (1 - 0.5)
  check('the player who faulted loses three quarters of a heavier stake',
    near(ratings.get(A1).rawPoints, START_POINTS - stake * ACTOR_SHARE), true,
    'A kitchen fault weighs 1.25 and costs the player who made it.')
  check('the other side gains it',
    near(ratings.get(B1).rawPoints, START_POINTS + stake / 2), true,
    'Their opponents won that rally.')
}

section('Singles')
{
  const ratings = rateHistory([match([rally(A1, 'ace')], { doubles: false })])
  check('one player takes the whole stake',
    [near(ratings.get(A1).rawPoints, START_POINTS + DEFAULT_K / 2), near(ratings.get(B1).rawPoints, START_POINTS - DEFAULT_K / 2)],
    [true, true], 'There is no partner to share with.')
}

section('Upsets move more')
{
  // Build A up first with several winners, then compare what one more
  // winner by A gains against what one winner by B gains.
  const buildUp = Array.from({ length: 8 }, () => rally(A1, 'putaway'))
  const favourite = rateHistory([match(buildUp), match([rally(A1, 'putaway')])])
  const underdog = rateHistory([match(buildUp), match([rally(B1, 'putaway')])])
  const beforeA = rateHistory([match(buildUp)]).get(A1).rawPoints
  const beforeB = rateHistory([match(buildUp)]).get(B1).rawPoints
  const favouriteGain = favourite.get(A1).rawPoints - beforeA
  const underdogGain = underdog.get(B1).rawPoints - beforeB
  check('the weaker side winning a rally gains more than the stronger side does',
    underdogGain > favouriteGain, true, 'Beating a stronger side is worth more.')
}

section('What does not count')
{
  const third = { type: 'thirdShot', id: randomUUID(), playerId: A1, shotType: 'drop', success: true }
  const correction = { type: 'serverCorrection', id: randomUUID(), playerId: A2 }
  const ratings = rateHistory([match([third, correction])])
  check('third shots and serve corrections move nothing',
    ratings.get(A1).rawPoints, START_POINTS, 'They describe how a rally started, not how it ended.')

  // Eleven straight winners win the game; a twelfth rally after it must not count.
  const eleven = Array.from({ length: 11 }, () => rally(A1, 'other_winner'))
  const withExtra = rateHistory([match([...eleven, rally(B1, 'ace')])])
  const without = rateHistory([match(eleven)])
  check('a rally after game point is ignored',
    near(withExtra.get(B1).rawPoints, without.get(B1).rawPoints), true,
    'Scoring stops when the game is won, so points must too.')

  const old = rateHistory([match([rally(A1, 'winner')])])
  check('a rally with no ending still counts at weight 1',
    near(old.get(A1).rawPoints, START_POINTS + DEFAULT_K * 0.5 * ACTOR_SHARE), true,
    'Every match scored before endings existed still says who won each rally.')
}

section('Order, history and the summary fields')
{
  const m1 = match([rally(A1, 'putaway'), rally(A1, 'net')])
  const m2 = match([rally(B1, 'out')])
  const forward = rateHistory([m1, m2])
  const backward = rateHistory([m2, m1])
  check('input order does not matter, only when matches ended',
    near(forward.get(A1).rawPoints, backward.get(A1).rawPoints), true,
    'Replaying the same history must give the same points.')
  check('matches and rallies are counted for everyone who played',
    [forward.get(A2).matches, forward.get(A2).rallies], [2, 3],
    'A2 played both matches and was on court for all three rallies.')
  check('trend holds rounded points after each match, oldest first',
    forward.get(A1).trend.length, 2, 'One entry per counted match.')
  check('byEnding only records the shots this player ended',
    Object.keys(forward.get(A1).byEnding).sort(), ['net', 'putaway'],
    'A2 never ended a rally, so A2 has nothing in byEnding.')
  check('A2 has nothing in byEnding', forward.get(A2).byEnding, {}, 'Partner shares are excluded.')
  check('recentChange is points now minus the start when there are fewer than 5 matches',
    forward.get(A1).recentChange, Math.round(forward.get(A1).rawPoints - START_POINTS),
    'With only two matches, the change is since their first.')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
