#!/usr/bin/env node
// ============================================================
// The rally rating, checked rule by rule.
//
//   node server/scripts/check-rally-rating.mjs
//
// Every rally is a small contest: the side that won it takes points
// from the side that lost, more for an upset, and every rally counts the
// same however it ended. A match against a newcomer counts for less for
// everyone else. Pure functions only: hand-built matches, no database.
// ============================================================

import { randomUUID } from 'node:crypto'
import {
  ACTOR_SHARE,
  DEFAULT_K,
  MATCH_REWARD,
  MIN_MATCHES,
  MOVED_MOST_MIN_RALLIES,
  START_POINTS,
  expectedWin,
  movedMost,
  rallyRatingFor,
  rallyMatchFor,
  rateHistory,
} from '../src/rally-rating.js'
import { RALLY_ENDINGS, rallyEnding } from '../src/rally-endings.js'
import { gameWinChance } from '../src/game-chance.js'

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
/** A match between any two sides, ending an hour after the last one built. */
function game(teamA, teamB, events, { id = randomUUID() } = {}) {
  clock += 60 * 60_000
  return {
    id,
    endedAt: new Date(clock).toISOString(),
    teamA,
    teamB,
    firstServer: { team: 'A', playerId: teamA[0] },
    rightStart: teamA.length === 2 ? { A: teamA[0], B: teamB[0] } : undefined,
    pointTarget: 11,
    events,
  }
}
/** A match between the usual four: A1 and A2 against B1 and B2, or A1 against B1. */
function match(events, { doubles = true, id } = {}) {
  return game(doubles ? [A1, A2] : [A1], doubles ? [B1, B2] : [B1], events, { id })
}

section('Every rally counts the same')
{
  // One rally ended by A1 between fresh sides, once for every ending.
  const moved = (key) => rateHistory([match([rally(A1, key)])]).get(A1).rawPoints - START_POINTS
  const stake = DEFAULT_K * (1 - 0.5) * ACTOR_SHARE
  check(
    'every ending moves points by the same amount',
    RALLY_ENDINGS.filter((e) => !near(Math.abs(moved(e.key)), stake)).map((e) => e.key),
    [],
    'Endings are still recorded and shown; they no longer change what a rally is worth (decided 2026-09-26).',
  )
  check(
    'endings that used to weigh more or less now move exactly as much as a put-away',
    ['kitchen', 'other_winner', 'hit_by_ball', 'out'].map((key) => near(Math.abs(moved(key)), moved('putaway'))),
    [true, true, true, true],
    'A kitchen fault used to weigh 1.25, another kind of winner 0.75, being hit by the ball 0.5.',
  )
}

section('One rally between equal sides')
{
  const ratings = rateHistory([match([rally(A1, 'putaway')])])
  const stake = DEFAULT_K * (1 - 0.5)
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
    'Four newcomers together all count in full, so a rally only moves points between the sides.')
}

section('A fault')
{
  const ratings = rateHistory([match([rally(A1, 'kitchen')])])
  const stake = DEFAULT_K * (1 - 0.5)
  check('the player who faulted loses three quarters of the stake',
    near(ratings.get(A1).rawPoints, START_POINTS - stake * ACTOR_SHARE), true,
    'A kitchen fault costs the player who made it the same as any other lost rally.')
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
  check('a rally with no ending still counts in full',
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
  check('the callback carries the expected chance and nothing else',
    Object.keys(calls[0]), ['expected'],
    'Every rally weighs the same, so there is no weight to pass on; the prediction script reads only expected.')
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
    match([rally(A1, 'putaway'), rally(A1, 'putaway'), rally(A1, 'lob'), rally(A1, 'net'), rally(A1, 'net'), rally(A1, 'kitchen')]),
  )
  const rich = rateHistory(many).get(A1)
  const moved = movedMost(rich)
  check('with enough rallies it names the top gains and costs',
    [moved.gained.map((g) => g.ending), moved.cost.map((c) => c.ending)],
    [['putaway', 'lob'], ['net', 'kitchen']],
    'Two put-aways a match earned more than one lob; two nets a match cost more than one kitchen fault.')
  check('points in movedMost are whole numbers',
    moved.gained.every((g) => Number.isInteger(g.points)), true, 'Players never see decimals.')
  check('the rating screen response includes movedMost and the breakdown',
    ['movedMost', 'breakdown'].every((key) => key in rallyRatingFor(rateHistory(many), A1, { forRatingScreen: true })), true,
    'Only the rating screen needs them; the overview card stays small.')
}

section('Where every point came from')
{
  // One put-away by A1 between fresh sides: stake = K * 0.5.
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
    sent.breakdown.every((row) => Number.isInteger(row.points) && Number.isInteger(row.rallies ?? row.matches) && (row.rallies ?? row.matches) > 0), true,
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
    Object.keys(sixth).sort(), ['change', 'endings', 'expectation', 'result', 'untagged'],
    'The averages only choose the words.')
}

section('Winning the match')
{
  // A1 serves first and A wins eleven rallies in a row: 11-0 to A.
  const won = () => match(Array.from({ length: 11 }, () => rally(A1, 'putaway')))
  const reward = (ratings, id) => ratings.get(id).ledger.match_result?.points
  const levelChance = gameWinChance(0.5, { doubles: true, target: 11, firstServer: 'A' })

  const one = rateHistory([won()])
  check('each winner gets half their side\'s reward, worked out from the game chance',
    near(reward(one, A1), (MATCH_REWARD * (1 - levelChance)) / 2, 1e-9), true,
    'Level sides before the match; the side\'s reward is shared equally, like a rally\'s stake.')
  check('partners get the same share, and the losers give up the same',
    [near(reward(one, A1), reward(one, A2)), near(reward(one, B1), -reward(one, A1)), near(reward(one, B2), reward(one, B1))],
    [true, true, true], 'Winning is a team result; the three-quarters rule is for rallies only.')
  check('the reward adds up to nothing across the match',
    near([A1, A2, B1, B2].reduce((s, id) => s + reward(one, id), 0), 0, 1e-9), true,
    'Four newcomers together all count in full, so the reward only moves points between the sides.')
  check('the ledger, reward included, still adds up to the points',
    [A1, B1].map((id) => near(Object.values(one.get(id).ledger).reduce((s, v) => s + v.points, 0), one.get(id).rawPoints - START_POINTS, 1e-6)),
    [true, true], 'The rating screen shows this arithmetic; it must stay exact.')
  check('without a reward the rallies are untouched',
    near(rateHistory([won()], { matchReward: 0 }).get(A1).rawPoints, one.get(A1).rawPoints - reward(one, A1), 1e-9), true,
    'In a single match the reward comes after every rally, so taking it away leaves exactly the rally points.')
  check('matchReward 0 records no match result at all',
    'match_result' in rateHistory([won()], { matchReward: 0 }).get(A1).ledger, false, 'Today\'s ratings, row for row.')

  const unfinished = rateHistory([match([rally(A1, 'putaway'), rally(B1, 'out')])])
  check('a match with no winner gives no reward',
    'match_result' in unfinished.get(A1).ledger, false, 'A match stopped early has nobody to reward.')

  const singles = rateHistory([match(Array.from({ length: 11 }, () => rally(A1, 'putaway')), { doubles: false })])
  check('in singles the whole side\'s reward goes to the one player',
    near(reward(singles, A1), MATCH_REWARD * (1 - gameWinChance(0.5, { doubles: false, target: 11, firstServer: 'A' })), 1e-9), true,
    'Serving first in singles is a small edge, so the level winner gets a little under half the reward.')

  const pair = [won(), won()]
  const afterFirst = rateHistory([pair[0]])
  const both = rateHistory(pair)
  const chanceBefore = gameWinChance(
    expectedWin((afterFirst.get(A1).rawPoints + afterFirst.get(A2).rawPoints) / 2, (afterFirst.get(B1).rawPoints + afterFirst.get(B2).rawPoints) / 2),
    { doubles: true, target: 11, firstServer: 'A' })
  check('the reward is worked out from points before the match',
    near(both.get(A1).matchFacts[pair[1].id].result, (MATCH_REWARD * (1 - chanceBefore)) / 2, 1e-9), true,
    'The second match\'s chance comes from the first match\'s results, not from its own rallies.')
  check('beating a side you were expected to beat earns less',
    both.get(A1).matchFacts[pair[1].id].result < both.get(A1).matchFacts[pair[0].id].result, true,
    'After winning the first, A were favourites for the second.')

  const five = Array.from({ length: 6 }, won)
  const rated = rateHistory(five)
  check('a rated player is sent their whole-point share of the reward',
    rallyMatchFor(rated, A1, five[5].id, true).result, Math.round(rated.get(A1).matchFacts[five[5].id].result),
    'The same rounding as the change.')
  check('an unrated player is sent no reward',
    rallyMatchFor(rateHistory(five.slice(0, 2)), A1, five[0].id, true).result, null, 'Points wait for five matches.')
  const noWinner = [...Array.from({ length: 5 }, won), match([rally(A1, 'putaway')])]
  check('a match with no winner sends no reward, even to a rated player',
    rallyMatchFor(rateHistory(noWinner), A1, noWinner[5].id, null).result, null, 'Nothing to show a split for.')
  const sent = rallyRatingFor(rated, A1, { forRatingScreen: true })
  const row = sent.breakdown.find((r) => r.kind === 'match_result')
  check('the rating screen gets a match row counted in matches',
    [row?.matches, 'rallies' in (row ?? {})], [6, false], 'Six matches won; the row is not a kind of rally.')
  check('the rating screen rows still add up with the match row',
    sent.breakdown.reduce((s, r) => s + r.points, 0), sent.points - START_POINTS, 'Whole numbers, exactly.')

  // A longer game with the other side serving first, so the reward path
  // is checked against rules other than the target-11, A-serves-first
  // default every other check in this section uses.
  clock += 60 * 60_000
  const toFifteen = {
    id: randomUUID(),
    endedAt: new Date(clock).toISOString(),
    teamA: [A1, A2],
    teamB: [B1, B2],
    firstServer: { team: 'B', playerId: B1 },
    rightStart: { A: A1, B: B1 },
    pointTarget: 15,
    events: Array.from({ length: 15 }, () => rally(B1, 'putaway')),
  }
  // Confirmed via deriveMatchState during development that this match
  // completes with B winning 15-0; if it somehow did not, the check
  // below would fail loudly since there would be no match_result row.
  const fifteenRatings = rateHistory([toFifteen])
  const chanceB = gameWinChance(0.5, { doubles: true, target: 15, firstServer: 'B' })
  check('a longer game with the other side serving first still rewards from the right game chance',
    near(reward(fifteenRatings, B1), (MATCH_REWARD * chanceB) / 2, 1e-9), true,
    'B\'s chance is 1 minus A\'s chance of winning with B serving first, which by symmetry is the same number as A\'s chance with A serving first; B\'s side gets MATCH_REWARD times that chance, split evenly.')
}

section('Games against newcomers')
{
  // A match counts for an established player (five or more earlier
  // matches) at min(n, 5) / 5, where n is the fewest earlier matches
  // among the OTHER players on court. A player under five matches always
  // moves in full. Every scenario reaches its last match through
  // newcomers only playing newcomers, which counts in full either way,
  // so the same history run with and without the protection differs
  // only in that last match.
  //
  // Exact ratios need a last match of ONE rally: over more rallies each
  // rally's chance comes from points the protection has already changed.
  // The win bonus is the exception, worked out from the points before
  // the match, so a whole match gives its ratio exactly.
  const ids = (count) => Array.from({ length: count }, () => randomUUID())
  const wins = (playerId, count) => Array.from({ length: count }, () => rally(playerId, 'putaway'))
  const both = (history, last) => ({
    last,
    history,
    withIt: rateHistory([...history, last]),
    without: rateHistory([...history, last], { newcomerProtection: false }),
  })
  const moved = (ratings, id, last) => ratings.get(id).matchFacts[last.id].after - ratings.get(id).matchFacts[last.id].before
  // How much of the full change the protection let through, to 9 places.
  const share = (run, id) => Math.round((moved(run.withIt, id, run.last) / moved(run.without, id, run.last)) * 1e9) / 1e9
  const ramp = [0, 1, 2, 3, 4, 5, 6]

  // Singles: E has five matches behind them (against S), newcomer N has
  // n (against T). Then N beats E, in one rally or 11-0.
  const singles = (n, lastRallies) => {
    const [E, S, N, T] = ids(4)
    const run = both(
      [
        ...Array.from({ length: MIN_MATCHES }, () => game([E], [S], wins(E, 3))),
        ...Array.from({ length: n }, () => game([N], [T], wins(N, 3))),
      ],
      game([N], [E], wins(N, lastRallies)),
    )
    return { ...run, E, N }
  }
  const oneRally = ramp.map((n) => singles(n, 1))
  const elevenNil = ramp.map((n) => singles(n, 11))

  const first = elevenNil[0]
  check('a newcomer\'s first match leaves an established player\'s points unchanged',
    moved(first.withIt, first.E, first.last), 0,
    'The concern that started this: losing 11-0 to a strong newcomer the app has never seen costs the regular nothing.')
  check('it counts 0, 1/5, 2/5, 3/5, 4/5, then fully, by the newcomer\'s earlier matches',
    oneRally.map((run) => share(run, run.E)), [0, 0.2, 0.4, 0.6, 0.8, 1, 1],
    'The table the owner approved: 1st game not at all, 2nd 20%, 3rd 40%, 4th 60%, 5th 80%, 6th onward fully.')
  check('a player under five matches always moves at full strength',
    oneRally.slice(0, MIN_MATCHES).map((run) => share(run, run.N)), [1, 1, 1, 1, 1],
    'A newcomer has no rating to protect yet, and their own number should find its level quickly.')
  check('the win bonus is scaled the same way',
    elevenNil.map((run) => {
      const bonus = (ratings) => ratings.get(run.E).matchFacts[run.last.id].result
      return Math.round((bonus(run.withIt) / bonus(run.without)) * 1e9) / 1e9
    }), [0, 0.2, 0.4, 0.6, 0.8, 1, 1],
    'Losing the match to a newcomer counts for as little as the rallies in it.')
  const lone = oneRally[0]
  check('points are no longer only moved: the newcomer gains what the regular does not lose',
    [near(moved(lone.withIt, lone.N, lone.last), moved(lone.without, lone.N, lone.last)), moved(lone.withIt, lone.E, lone.last)],
    [true, 0],
    'Intended (2026-09-26): the newcomer\'s rating must find its level, and the regular must not pay for the app not knowing them.')
  check('without the protection, the same rally only moves points between the two',
    near(moved(lone.without, lone.N, lone.last) + moved(lone.without, lone.E, lone.last), 0), true,
    'newcomerProtection: false gives the old rules, minus the ending weights, as matchReward: 0 does for the win bonus.')

  // Doubles: E1 and E2 have five matches behind them against O1 and O2.
  // Newcomer N (n earlier matches) partners O1 and wins them a rally
  // against E1 and E2. For E1, E2 and O1 alike the least-known other
  // player on court is N: a partner counts the same as an opponent.
  const doubles = ramp.map((n) => {
    const [E1, E2, O1, O2, N, T] = ids(6)
    const run = both(
      [
        ...Array.from({ length: MIN_MATCHES }, () => game([E1, E2], [O1, O2], wins(E1, 3))),
        ...Array.from({ length: n }, () => game([N], [T], wins(N, 3))),
      ],
      game([N, O1], [E1, E2], wins(N, 1)),
    )
    return { ...run, players: [E1, E2, O1, N] }
  })
  check('in doubles it goes by the least-known other player on court, partner included',
    doubles.map((run) => run.players.map((id) => share(run, id))),
    [[0, 0, 0, 1], [0.2, 0.2, 0.2, 1], [0.4, 0.4, 0.4, 1], [0.6, 0.6, 0.6, 1], [0.8, 0.8, 0.8, 1], [1, 1, 1, 1], [1, 1, 1, 1]],
    'E1 and E2 (opponents) and O1 (N\'s partner) count the match by N\'s earlier matches; N moves in full.')

  // Two newcomers on court, with two and three earlier matches: the one
  // with fewer decides. E1, partnered by N2, wins a rally against O1 and
  // N3.
  const [E1, E2, O1, O2, N2, N3, T] = ids(7)
  const pair = both(
    [
      ...Array.from({ length: MIN_MATCHES }, () => game([E1, E2], [O1, O2], wins(E1, 3))),
      ...Array.from({ length: 2 }, () => game([N2], [T], wins(N2, 3))),
      ...Array.from({ length: 3 }, () => game([N3], [T], wins(N3, 3))),
    ],
    game([E1, N2], [O1, N3], wins(E1, 1)),
  )
  check('with two newcomers on court, the one with fewer matches decides',
    [E1, O1, N2, N3].map((id) => share(pair, id)), [0.4, 0.4, 1, 1],
    'N2 has two earlier matches and N3 three, so E1 and O1 count this match at 2/5.')
  const onMatchScreen = (ratings) => ratings.get(E1).matchFacts[pair.last.id].endings.putaway.points
  const addedToEndings = (ratings) => ratings.get(E1).byEnding.putaway - rateHistory(pair.history).get(E1).byEnding.putaway
  check('the scaled change is what reaches the match screen and the endings too',
    [near(onMatchScreen(pair.withIt), 0.4 * onMatchScreen(pair.without)), near(addedToEndings(pair.withIt), 0.4 * addedToEndings(pair.without))],
    [true, true],
    'Every change is scaled before it is recorded anywhere, so no screen shows more than was applied.')
  check('under the protection every player\'s ledger still adds up to their points',
    [E1, O1, N2, N3].map((id) => {
      const r = pair.withIt.get(id)
      return near(Object.values(r.ledger).reduce((s, v) => s + v.points, 0), r.rawPoints - START_POINTS, 1e-6)
    }),
    [true, true, true, true],
    'The ledger records the changes actually applied, so the rating screen\'s arithmetic stays exact.')
  const sent = rallyRatingFor(pair.withIt, E1, { forRatingScreen: true })
  check('and the rows sent still add up to the points shown',
    sent.breakdown.reduce((s, row) => s + row.points, 0), sent.points - START_POINTS,
    'Whole numbers, exactly, as before the protection.')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
