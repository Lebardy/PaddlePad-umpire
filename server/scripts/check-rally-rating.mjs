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
  MIN_MATCHES,
  MOVED_MOST_MIN_RALLIES,
  START_POINTS,
  endingWeight,
  expectedWin,
  movedMost,
  rallyRatingFor,
  rallyMatchFor,
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

section('The onRally callback')
{
  const calls = []
  const third = { type: 'thirdShot', id: randomUUID(), playerId: A1, shotType: 'drop', success: true }
  rateHistory([match([third, rally(A1, 'putaway')])], { onRally: (info) => calls.push(info) })
  check('onRally fires once per counted rally, not for third shots',
    calls.length, 1, 'A third shot describes how a rally started, not a contest of its own.')
  check('expected is 0.5 on the first rally between fresh players',
    calls[0].expected, 0.5, 'With no history yet, either side is an even chance to win the rally.')
  check('weight matches the ending that closed the rally',
    calls[0].weight, endingWeight('putaway'), 'The callback carries the same weight the points update used.')
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

section('What a player is sent')
{
  const four = Array.from({ length: 4 }, () => match([rally(A1, 'putaway')]))
  const unrated = rallyRatingFor(rateHistory(four), A1)
  check('under 5 matches a player is not rated yet',
    unrated, { state: 'not_enough_matches', have: 4, need: MIN_MATCHES },
    'The same floor the pipeline uses; the app shows progress towards it.')

  const five = [...four, match([rally(A1, 'net')])]
  const rated = rallyRatingFor(rateHistory(five), A1)
  check('at 5 matches the player is rated',
    rated.state, 'rated', 'Five counted matches is enough.')
  check('the response carries exactly the agreed fields',
    Object.keys(rated).sort(),
    ['matches', 'points', 'rallies', 'recentChange', 'state', 'trend', 'winChanceVsStart'],
    'Nothing about anyone else, and no movedMost unless asked for.')
  check('winChanceVsStart is a whole percentage against a 1500 player',
    rated.winChanceVsStart, Math.round(expectedWin(rateHistory(five).get(A1).rawPoints, START_POINTS) * 100),
    'This is the "54 of every 100 rallies" sentence.')
  check('a player nobody has seen is not rated',
    rallyRatingFor(rateHistory(five), randomUUID()), { state: 'not_enough_matches', have: 0, need: MIN_MATCHES },
    'A brand new player has no matches yet.')

  check('movedMost is withheld under 20 rallies with an ending',
    movedMost(rateHistory(five).get(A1)), null,
    'Naming a habit from five rallies would be guessing.')

  const many = Array.from({ length: 6 }, () =>
    match([rally(A1, 'putaway'), rally(A1, 'putaway'), rally(A1, 'lob'), rally(A1, 'net'), rally(A1, 'kitchen')]),
  )
  const rich = rateHistory(many).get(A1)
  const moved = movedMost(rich)
  check('with enough rallies it names the top gains and costs',
    [moved.gained.map((g) => g.ending), moved.cost.map((c) => c.ending)],
    [['putaway', 'lob'], ['kitchen', 'net']],
    'Put-aways earned the most; the heavier kitchen fault cost more than hitting into the net.')
  check('points in movedMost are whole numbers',
    moved.gained.every((g) => Number.isInteger(g.points)), true, 'Players never see decimals.')
  check('the rating screen response includes movedMost and the breakdown',
    ['movedMost', 'breakdown'].every((key) => key in rallyRatingFor(rateHistory(many), A1, { forRatingScreen: true })), true,
    'Only the rating screen needs them; the overview card stays small.')
}

section('Where every point came from')
{
  // One put-away by A1 between fresh sides: stake = K * 1 * 0.5.
  const one = rateHistory([match([rally(A1, 'putaway')])])
  const stake = DEFAULT_K * 0.5
  const ledger = (id) => Object.fromEntries(Object.entries(one.get(id).ledger).map(([k, v]) => [k, [v.rallies, Math.round(v.points * 1e6) / 1e6]]))
  check('the hitter\'s rally is filed under the ending',
    ledger(A1), { putaway: [1, stake * ACTOR_SHARE] }, 'Their own put-away earned three quarters of the stake.')
  check('the partner\'s share is filed as their partner\'s rally',
    ledger(A2), { partner: [1, stake * (1 - ACTOR_SHARE)] }, 'A2 did not end it, but shared in it.')
  check('an opponent\'s winning shot is filed as such',
    ledger(B1), { opponent_winner: [1, -stake / 2] }, 'B1 lost points to a shot they could do nothing about.')
  const fault = rateHistory([match([rally(B1, 'kitchen')])])
  check('an opponent\'s mistake is filed as such',
    Object.keys(fault.get(A1).ledger), ['opponent_error'], 'A1 gained from B1 stepping into the kitchen.')
  const bare = rateHistory([match([rally(A1, 'winner')])])
  check('a rally the player ended with no ending recorded has its own row',
    Object.keys(bare.get(A1).ledger), ['untagged'], 'Older rallies still move points and must be counted somewhere.')

  // A longer, mixed history: every ledger adds back to the points.
  const mixed = Array.from({ length: 7 }, (_, i) =>
    match([rally(A1, 'putaway'), rally(B2, 'net'), rally(A2, 'lob'), rally(B1, i % 2 ? 'ace' : 'kitchen'), rally(A1, 'out'), rally(A1, 'winner')]))
  const ratings = rateHistory(mixed)
  const sums = [A1, A2, B1, B2].map((id) => {
    const r = ratings.get(id)
    return near(Object.values(r.ledger).reduce((s, v) => s + v.points, 0), r.rawPoints - START_POINTS, 1e-6)
  })
  check('every player\'s ledger adds up to their points above or below 1,500',
    sums, [true, true, true, true], 'Nothing moves a player\'s points without a row to show for it.')

  const sent = rallyRatingFor(ratings, A1, { forRatingScreen: true })
  check('the rows sent add up exactly to the points shown, after rounding',
    sent.breakdown.reduce((s, row) => s + row.points, 0), sent.points - START_POINTS,
    'Rounded so the whole numbers on screen always add to the headline, never off by one.')
  check('every row sent is a whole number of points with a rally count',
    sent.breakdown.every((row) => Number.isInteger(row.points) && Number.isInteger(row.rallies) && row.rallies > 0), true,
    'Players never see decimals, and a row with no rallies is left out.')
  check('own endings name the ending, the rest name what they are',
    sent.breakdown.map((row) => row.ending ?? row.kind).sort(),
    ['opponent_error', 'opponent_winner', 'out', 'partner', 'putaway', 'untagged'].sort(),
    'A1 ended put-aways, outs and untagged rallies; the rest came from A2 and the opponents.')

  const internal = ratings.get(A1).recentMatches
  check('the replay still keeps each recent match\'s change, adding up to the points',
    internal.reduce((s, m) => s + m.change, 0), sent.points - START_POINTS,
    'Kept for the match screen; the rating screen no longer sends it.')
}

section('What one match did')
{
  const mixed = Array.from({ length: 7 }, (_, i) =>
    match([rally(A1, 'putaway'), rally(B2, 'net'), rally(A1, 'net'), rally(A2, 'lob'), rally(B1, i % 2 ? 'ace' : 'kitchen'), rally(A1, 'winner')]))
  const ratings = rateHistory(mixed)
  const a1 = ratings.get(A1)

  check('every match\'s before-to-after change adds up to the player\'s total',
    near(mixed.reduce((s, m) => s + a1.matchFacts[m.id].after - a1.matchFacts[m.id].before, 0), a1.rawPoints - START_POINTS, 1e-6),
    true, 'Nothing moves a player\'s points outside a match.')

  const summed = {}
  let untagged = 0
  for (const m of mixed) {
    for (const [ending, entry] of Object.entries(a1.matchFacts[m.id].endings)) {
      summed[ending] = (summed[ending] ?? 0) + entry.points
    }
    untagged += a1.matchFacts[m.id].untagged
  }
  check('each match\'s own endings add up to the same endings over the whole history',
    Object.keys(summed).sort().map((e) => near(summed[e], a1.ledger[e].points, 1e-6)), [true, true],
    'A1 ended put-aways and nets in every match; per match and overall must agree.')
  check('rallies the player ended with no ending are counted per match',
    untagged, a1.ledger.untagged.rallies, 'One bare winner per match, seven matches.')
  check('partner and opponent rallies are not the player\'s own endings',
    Object.keys(a1.matchFacts[mixed[0].id].endings).sort(), ['net', 'putaway'],
    'A2\'s lob and the opponents\' rallies belong to other rows.')

  const first = rateHistory([mixed[0]])
  const second = a1.matchFacts[mixed[1].id]
  check('side averages are the points before the match starts',
    [near(second.yourSide, (first.get(A1).rawPoints + first.get(A2).rawPoints) / 2),
      near(second.theirSide, (first.get(B1).rawPoints + first.get(B2).rawPoints) / 2)],
    [true, true], 'The second match\'s averages carry the first match\'s result and nothing from the second.')

  check('while anyone on court has under 5 matches, nothing is expected',
    rallyMatchFor(ratings, A1, mixed[4].id, true).expectation, null,
    'Before the fifth match nobody on court is established.')
  check('once everyone has 5 matches behind them, the expectation is said',
    typeof rallyMatchFor(ratings, A1, mixed[5].id, true).expectation?.expected, 'string',
    'Five counted matches each before the sixth.')

  const sixth = rallyMatchFor(ratings, A1, mixed[5].id, false)
  check('a rated player\'s change is the difference in rounded points',
    sixth.change, Math.round(a1.matchFacts[mixed[5].id].after) - Math.round(a1.matchFacts[mixed[5].id].before),
    'The same rounding as the overview, so changes add up to what it shows.')
  check('endings are sorted most frequent first, with outcome and whole points',
    sixth.endings.map((e) => [e.ending, e.outcome, e.rallies, Number.isInteger(e.points)]),
    [['net', 'error', 1, true], ['putaway', 'winner', 1, true]],
    'A tie in count falls back to the ending\'s name, so the order is stable.')
  check('the untagged count comes through',
    sixth.untagged, 1, 'One bare winner in that match.')

  const early = rateHistory(mixed.slice(0, 2))
  const unrated = rallyMatchFor(early, A1, mixed[0].id, true)
  check('an unrated player gets no change and no points on their endings',
    [unrated.change, unrated.endings.every((e) => e.points === null)], [null, true],
    'Points stay hidden until 5 matches, as on the overview.')
  check('an unrated player still gets their ending counts',
    unrated.endings.map((e) => e.rallies), [1, 1], 'Counts are just what happened.')

  check('a match the replay never counted gives nothing',
    rallyMatchFor(ratings, A1, randomUUID(), true), null, 'A voided match is not in the history.')
  check('a player who was not in the match gives nothing',
    rallyMatchFor(ratings, randomUUID(), mixed[0].id, true), null, 'Nobody reads another player\'s match.')
  check('the match section never carries a side average or anyone\'s points',
    Object.keys(sixth).sort(), ['change', 'endings', 'expectation', 'untagged'],
    'The averages only choose the words.')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
