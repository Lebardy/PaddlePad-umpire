# Rally Rating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give players a new skill rating, calculated rally by rally in the API from how each rally ended and who ended it, shown as points with anchors, while the ML pipeline and its K-Means clustering stay untouched.

**Architecture:** A pure module (`server/src/rally-rating.js`) replays every completed, non-voided match and moves Elo-style points on each rally. A small store (`server/src/rally-rating-store.js`) loads the history from Postgres, caches the result in memory and is cleared by every route that changes a completed match. `/player/me` and `/player/standing` add a `rallyRating` field, and the player app's rating card and rating step 1 are rebuilt around it. Two scripts regenerate staging's synthetic pool through the API (with hidden abilities saved) and measure how well the new rating predicts winners against the old score.

**Tech Stack:** Node 20+ ES modules and Express 5 (server), React 18 + Vite (player app), Python 3 + pandas (the old-score comparison only).

**Spec:** `docs/superpowers/specs/2026-09-13-rally-rating-design.md`

## Global Constraints

- The ML pipeline (`ml/`), its K-Means clustering, `rating_runs`/`player_ratings`, the export and `server/src/expectation.js` do not change.
- Never show percentiles, places or any comparison with other players on the new rating.
- A player only ever receives their own points; no response carries another player's points.
- Player-app copy uses everyday words; ending keys map to the phrases in Task 7.
- Starting points `1500`; acting player's share `0.75`; rated after `5` counted matches; "What's moving it" needs `20` rallies with a detail.
- Ending weights exactly as the spec's table (1.25 / 1 / 0.75 / 0.5).
- Commit messages end with the last line of the body: no `Co-Authored-By` trailer.
- Deploy to staging only (`railway up --service <api|play> --environment staging --ci`), never production.
- Checks in this repo are standalone scripts in `server/scripts/check-*.mjs` printing `N passed, M failed` and exiting non-zero on failure; there is no test framework.

---

### Task 1: The rating model

**Files:**
- Modify: `server/src/pickleball.js` (the fold in `deriveMatchState`, around the `for (const event of match.events)` loop and its `return`)
- Create: `server/src/rally-rating.js`
- Create: `server/scripts/check-rally-rating.mjs`
- Modify: `server/package.json` (scripts)

**Interfaces:**
- Consumes: `deriveMatchState(match)` and `RALLY_ENDINGS` from `server/src/rally-endings.js`.
- Produces:
  - `deriveMatchState(match).foldedEvents: number` — how many events were folded before the game was won.
  - `START_POINTS = 1500`, `DEFAULT_K = 8`, `DEFAULT_SCALE = 400`, `ACTOR_SHARE = 0.75`, `MIN_MATCHES = 5`, `TREND_MATCHES = 10`, `RECENT_MATCHES = 5`, `ENDING_WEIGHTS: Record<string, number>`.
  - `endingWeight(detail?: string): number`
  - `expectedWin(ratingFor: number, ratingAgainst: number, scale?: number): number`
  - `rateHistory(matches: Match[], options?: { k?: number, scale?: number, actorShare?: number }): Map<string, PlayerRating>` where `Match = { id, endedAt, teamA, teamB, firstServer, rightStart?, pointTarget?, events }` and `PlayerRating = { points: number, rawPoints: number, matches: number, rallies: number, detailedRallies: number, trend: number[], recentChange: number, byEnding: Record<string, number> }`.

- [ ] **Step 1: Write the failing check**

Create `server/scripts/check-rally-rating.mjs`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node server/scripts/check-rally-rating.mjs`
Expected: exits with `Cannot find module '.../server/src/rally-rating.js'`.

- [ ] **Step 3: Expose how many events were folded**

In `server/src/pickleball.js`, inside `deriveMatchState`, change the loop so it counts folded events, and return the count:

```js
  let foldedEvents = 0
  for (const event of match.events) {
    if (scoreState.completed) break
    foldedEvents += 1
```

(the rest of the loop body is unchanged) and change the final return to:

```js
  return { ...scoreState, isDoubles, pointTarget: target, stats, endings, foldedEvents }
```

Add to the doc comment above `deriveMatchState`:

```js
 * `foldedEvents` is how many events were folded before the game was won,
 * so a caller can apply its own rules to exactly the rallies that counted.
```

- [ ] **Step 4: Write the rating module**

Create `server/src/rally-rating.js`:

```js
// ============================================================
// The rally rating: a skill rating built rally by rally.
//
// Every counted rally is a small contest. The side that won it takes
// points from the side that lost it -- more when the winners were the
// weaker side -- weighted by how the rally ended. The player who ended
// the rally takes three quarters of their side's share, their partner a
// quarter; the other side splits theirs evenly.
//
// Separate from the ML pipeline's skill_score on purpose. That score is
// part of the thesis's K-Means pipeline (it names the skill clusters and
// residualises the playstyle features) and stays exactly as it is; this
// is the number players see. See
// docs/superpowers/specs/2026-09-13-rally-rating-design.md.
//
// Pure: matches in, ratings out. Recomputed from the whole history
// rather than patched, so voiding a match or undoing a rally can never
// leave stale points behind.
// ============================================================

import { deriveMatchState } from './pickleball.js'
import { RALLY_ENDINGS } from './rally-endings.js'

export const START_POINTS = 1500
export const DEFAULT_K = 8
export const DEFAULT_SCALE = 400
export const ACTOR_SHARE = 0.75
export const MIN_MATCHES = 5
export const TREND_MATCHES = 10
export const RECENT_MATCHES = 5

// How much each ending moves. A first guess, agreed before any real
// match carried endings: self-inflicted faults weigh more, faults that
// are often forced or are bookkeeping weigh less. Revisit with real data.
export const ENDING_WEIGHTS = {
  ace: 1,
  putaway: 1,
  passing: 1,
  lob: 1,
  drop_winner: 1,
  dink_winner: 1,
  other_winner: 0.75,
  out: 1,
  net: 1,
  dink_error: 1,
  kitchen: 1.25,
  service: 1.25,
  foot_fault: 1.25,
  two_bounce: 1.25,
  net_touch: 0.5,
  hit_by_ball: 0.5,
  wrong_position: 0.5,
  other_fault: 0.75,
}

for (const ending of RALLY_ENDINGS) {
  if (typeof ENDING_WEIGHTS[ending.key] !== 'number') {
    throw new Error(`rally-rating: no weight for ending ${ending.key}`)
  }
}

/** A rally's weight. No detail (a rally from before endings) weighs 1. */
export function endingWeight(detail) {
  if (detail === undefined || detail === null) return 1
  return ENDING_WEIGHTS[detail] ?? 1
}

/** The chance a side rated `ratingFor` wins a rally against `ratingAgainst`. */
export function expectedWin(ratingFor, ratingAgainst, scale = DEFAULT_SCALE) {
  return 1 / (1 + 10 ** ((ratingAgainst - ratingFor) / scale))
}

function endedTime(match) {
  return new Date(match.endedAt).getTime()
}

function byWhenEnded(a, b) {
  return endedTime(a) - endedTime(b) || String(a.id).localeCompare(String(b.id))
}

/**
 * Every player's rating after replaying `matches` in the order they ended.
 *
 * `matches` must already be the ones that count: completed and not voided.
 */
export function rateHistory(matches, options = {}) {
  const k = options.k ?? DEFAULT_K
  const scale = options.scale ?? DEFAULT_SCALE
  const actorShare = options.actorShare ?? ACTOR_SHARE

  const players = new Map()
  const player = (id) => {
    if (!players.has(id)) {
      players.set(id, {
        points: START_POINTS,
        matches: 0,
        rallies: 0,
        detailedRallies: 0,
        history: [],
        byEnding: {},
      })
    }
    return players.get(id)
  }
  const average = (ids) => ids.reduce((sum, id) => sum + player(id).points, 0) / ids.length

  for (const match of [...matches].sort(byWhenEnded)) {
    const everyone = [...match.teamA, ...match.teamB]
    everyone.forEach(player)
    const { foldedEvents } = deriveMatchState(match)

    for (const event of match.events.slice(0, foldedEvents)) {
      if (event.type !== 'rally') continue

      const actorOnA = match.teamA.includes(event.actingPlayerId)
      const actorSide = actorOnA ? match.teamA : match.teamB
      const otherSide = actorOnA ? match.teamB : match.teamA
      const actorSideWon = event.outcome === 'winner'
      const winners = actorSideWon ? actorSide : otherSide
      const losers = actorSideWon ? otherSide : actorSide

      const stake =
        k * endingWeight(event.detail) * (1 - expectedWin(average(winners), average(losers), scale))
      const actorSideChange = actorSideWon ? stake : -stake

      // Worked out in full before anything is applied, so every share is
      // based on the points everyone had before this rally.
      const changes = new Map()
      if (actorSide.length === 1) {
        changes.set(event.actingPlayerId, actorSideChange)
      } else {
        const partner = actorSide.find((id) => id !== event.actingPlayerId)
        changes.set(event.actingPlayerId, actorSideChange * actorShare)
        changes.set(partner, actorSideChange * (1 - actorShare))
      }
      for (const id of otherSide) changes.set(id, -actorSideChange / otherSide.length)

      for (const [id, change] of changes) player(id).points += change
      for (const id of everyone) {
        player(id).rallies += 1
        if (event.detail) player(id).detailedRallies += 1
      }
      if (event.detail) {
        const mine = player(event.actingPlayerId).byEnding
        mine[event.detail] = (mine[event.detail] ?? 0) + changes.get(event.actingPlayerId)
      }
    }

    for (const id of everyone) {
      player(id).matches += 1
      player(id).history.push(player(id).points)
    }
  }

  const ratings = new Map()
  for (const [id, p] of players) {
    const before =
      p.history.length > RECENT_MATCHES ? p.history[p.history.length - 1 - RECENT_MATCHES] : START_POINTS
    ratings.set(id, {
      points: Math.round(p.points),
      rawPoints: p.points,
      matches: p.matches,
      rallies: p.rallies,
      detailedRallies: p.detailedRallies,
      trend: p.history.slice(-TREND_MATCHES).map((value) => Math.round(value)),
      recentChange: Math.round(p.points - before),
      byEnding: p.byEnding,
    })
  }
  return ratings
}
```

- [ ] **Step 5: Run the check and the existing checks**

Run: `node server/scripts/check-rally-rating.mjs && node server/scripts/check-serving.mjs && node server/scripts/check-rally-endings.mjs && node server/scripts/check-third-shot.mjs`
Expected: every script ends `N passed, 0 failed`.

- [ ] **Step 6: Register the check and commit**

In `server/package.json` scripts, after `"test:rally-endings"`, add:

```json
    "test:rally-rating": "node scripts/check-rally-rating.mjs",
```

```bash
git add server/src/pickleball.js server/src/rally-rating.js server/scripts/check-rally-rating.mjs server/package.json
git commit -m "Rate players rally by rally

Every counted rally moves Elo-style points from the side that lost it to
the side that won it, weighted by how it ended, with the player who
ended it taking three quarters of their side's share. Pure and replayed
from the whole history. deriveMatchState now reports how many events it
folded, so the rating counts exactly the rallies the score did."
```

---

### Task 2: The player-facing shape

**Files:**
- Modify: `server/src/rally-rating.js` (append)
- Modify: `server/scripts/check-rally-rating.mjs` (append a section before the final `console.log`)

**Interfaces:**
- Consumes: `rateHistory`, `MIN_MATCHES`, `START_POINTS`, `expectedWin` from Task 1.
- Produces:
  - `MOVED_MOST_MIN_RALLIES = 20`
  - `movedMost(rating: PlayerRating): { gained: {ending: string, points: number}[], cost: {ending: string, points: number}[] } | null`
  - `rallyRatingFor(ratings: Map<string, PlayerRating>, playerId: string, { withMovedMost?: boolean }): RallyRatingResponse` where `RallyRatingResponse` is `{ state: 'not_enough_matches', have: number, need: number }` or `{ state: 'rated', points: number, recentChange: number, trend: number[], rallies: number, matches: number, winChanceVsStart: number, movedMost?: ... }`.

- [ ] **Step 1: Append the failing checks**

Insert before `console.log(\`\n${pass} passed, ${fail} failed\`)` in `server/scripts/check-rally-rating.mjs`, and add `MIN_MATCHES, MOVED_MOST_MIN_RALLIES, movedMost, rallyRatingFor` to its import from `../src/rally-rating.js`:

```js
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
  check('the standing response includes movedMost when asked',
    'movedMost' in rallyRatingFor(rateHistory(many), A1, { withMovedMost: true }), true,
    'Only the rating screen needs it.')
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node server/scripts/check-rally-rating.mjs`
Expected: `SyntaxError: The requested module '../src/rally-rating.js' does not provide an export named 'MIN_MATCHES'` or similar missing export.

- [ ] **Step 3: Append the implementation**

Append to `server/src/rally-rating.js`:

```js
export const MOVED_MOST_MIN_RALLIES = 20

/**
 * The two endings that earned this player the most points, and the two
 * that cost the most, from the shots they ended themselves. Null until
 * enough rallies carry an ending to say anything.
 */
export function movedMost(rating) {
  if (!rating || rating.detailedRallies < MOVED_MOST_MIN_RALLIES) return null
  const entries = Object.entries(rating.byEnding).map(([ending, points]) => ({ ending, points }))
  const round = ({ ending, points }) => ({ ending, points: Math.round(points) })
  return {
    gained: entries.filter((e) => e.points > 0).sort((a, b) => b.points - a.points).slice(0, 2).map(round),
    cost: entries.filter((e) => e.points < 0).sort((a, b) => a.points - b.points).slice(0, 2).map(round),
  }
}

/** What one player is sent about their own rally rating. */
export function rallyRatingFor(ratings, playerId, { withMovedMost = false } = {}) {
  const rating = ratings.get(playerId)
  const have = rating?.matches ?? 0
  if (have < MIN_MATCHES) return { state: 'not_enough_matches', have, need: MIN_MATCHES }

  const response = {
    state: 'rated',
    points: rating.points,
    recentChange: rating.recentChange,
    trend: rating.trend,
    rallies: rating.rallies,
    matches: rating.matches,
    winChanceVsStart: Math.round(expectedWin(rating.rawPoints, START_POINTS) * 100),
  }
  if (withMovedMost) response.movedMost = movedMost(rating)
  return response
}
```

- [ ] **Step 4: Run the check**

Run: `node server/scripts/check-rally-rating.mjs`
Expected: `N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server/src/rally-rating.js server/scripts/check-rally-rating.mjs
git commit -m "Shape the rally rating for the player who owns it

rallyRatingFor sends a player their own points, recent change, trend,
rally and match counts, and their chance against a 1,500 player; or
their progress towards five matches. movedMost names the endings that
earned and cost them the most once twenty rallies carry an ending."
```

---

### Task 3: Loading, caching and clearing

**Files:**
- Create: `server/src/rally-rating-store.js`
- Create: `server/scripts/check-rally-rating-store.mjs`
- Modify: `server/src/routes/matches.js` (`PUT /:id/log`, `DELETE /:id`, `POST /:id/void`)
- Modify: `server/src/routes/sessions.js` (`DELETE /:id`, `POST /:id/void`)
- Modify: `server/package.json` (scripts)

**Interfaces:**
- Consumes: `rateHistory` (Task 1), `eventFromRow` from `server/src/pickleball.js`.
- Produces:
  - `getRallyRatings(query: (sql: string, params?: unknown[]) => Promise<{ rows: object[] }>): Promise<Map<string, PlayerRating>>`
  - `invalidateRallyRatings(): void`

- [ ] **Step 1: Write the failing check**

Create `server/scripts/check-rally-rating-store.mjs`:

```js
#!/usr/bin/env node
// ============================================================
// The rally rating cache: loads once, rebuilds after a change.
//
//   node server/scripts/check-rally-rating-store.mjs
//
// A fake query stands in for Postgres, so this needs no database.
// ============================================================

import { randomUUID } from 'node:crypto'
import { getRallyRatings, invalidateRallyRatings } from '../src/rally-rating-store.js'

let pass = 0
let fail = 0
function check(label, ok, why) {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}\n       ${why}`)
}

const [a, b] = [randomUUID(), randomUUID()]
const matchId = randomUUID()
let calls = 0
let voided = false

async function fakeQuery(sql) {
  calls += 1
  if (sql.includes('FROM match_events')) {
    return {
      rows: voided
        ? []
        : [{ match_id: matchId, id: randomUUID(), seq: 0, type: 'rally', payload: { actingPlayerId: a, outcome: 'winner', zone: 'open', detail: 'ace' } }],
    }
  }
  return {
    rows: voided
      ? []
      : [{
          id: matchId, team_a: [a], team_b: [b], first_server_team: 'A', first_server_player: a,
          point_target: 11, right_start_a: null, right_start_b: null, ended_at: '2026-09-01T10:00:00Z',
        }],
  }
}

const first = await getRallyRatings(fakeQuery)
check('the history is loaded and rated', first.get(a)?.points > 1500, 'A won the only rally.')
const callsAfterFirst = calls
await getRallyRatings(fakeQuery)
check('a second request uses the cache', calls === callsAfterFirst, 'No queries the second time.')

voided = true
invalidateRallyRatings()
const after = await getRallyRatings(fakeQuery)
check('after invalidation the history is loaded again', calls > callsAfterFirst, 'A change must be seen.')
check('and a voided match no longer counts', after.get(a) === undefined, 'The match was the only history.')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node server/scripts/check-rally-rating-store.mjs`
Expected: `Cannot find module '.../server/src/rally-rating-store.js'`.

- [ ] **Step 3: Write the store**

Create `server/src/rally-rating-store.js`:

```js
// ============================================================
// Loads the history the rally rating is replayed from, and keeps the
// result in memory until something changes it.
//
// Rebuilt from scratch rather than updated in place: at PaddlePad's
// size a full replay takes a fraction of a second, and a rebuild can
// never disagree with the history the way an incrementally patched
// number can after a void or an undo.
//
// Every route that can change a completed match, or whether it counts,
// calls invalidateRallyRatings(). A restart simply rebuilds on the first
// request.
// ============================================================

import { eventFromRow } from './pickleball.js'
import { rateHistory } from './rally-rating.js'

let cached = null

export function invalidateRallyRatings() {
  cached = null
}

export function getRallyRatings(query) {
  if (!cached) {
    const loading = loadRallyRatings(query)
    cached = loading
    // A failed load must not be cached, or one database hiccup would
    // break ratings until the next match finished.
    loading.catch(() => {
      if (cached === loading) cached = null
    })
  }
  return cached
}

async function loadRallyRatings(query) {
  // The same matches the export counts: completed, not voided, and not
  // in a voided session.
  const { rows: matches } = await query(
    `SELECT m.id, m.team_a, m.team_b, m.first_server_team, m.first_server_player,
            m.point_target, m.right_start_a, m.right_start_b, m.ended_at
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
      WHERE m.status = 'completed'
        AND m.ended_at IS NOT NULL
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL`,
  )
  if (matches.length === 0) return new Map()

  const { rows: events } = await query(
    `SELECT e.match_id, e.id, e.seq, e.type, e.payload
       FROM match_events e
       JOIN matches m ON m.id = e.match_id
       JOIN sessions s ON s.id = m.session_id
      WHERE m.status = 'completed'
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL
      ORDER BY e.match_id, e.seq`,
  )

  const eventsByMatch = new Map()
  for (const row of events) {
    if (!eventsByMatch.has(row.match_id)) eventsByMatch.set(row.match_id, [])
    eventsByMatch.get(row.match_id).push(eventFromRow(row))
  }

  return rateHistory(
    matches.map((m) => ({
      id: m.id,
      endedAt: m.ended_at,
      teamA: m.team_a,
      teamB: m.team_b,
      firstServer: { team: m.first_server_team, playerId: m.first_server_player },
      rightStart: { A: m.right_start_a, B: m.right_start_b },
      pointTarget: m.point_target,
      events: eventsByMatch.get(m.id) ?? [],
    })),
  )
}
```

- [ ] **Step 4: Run the check**

Run: `node server/scripts/check-rally-rating-store.mjs`
Expected: `4 passed, 0 failed`.

- [ ] **Step 5: Clear the cache from every route that changes what counts**

In `server/src/routes/matches.js`, add to the imports:

```js
import { invalidateRallyRatings } from '../rally-rating-store.js'
```

In `PUT /:id/log`, directly after the `await withTransaction(async (client) => { ... })` block closes, add:

```js
  // Events, completion and ending early all arrive here, so any of them
  // can change the rally rating.
  invalidateRallyRatings()
```

In `DELETE /:id`, directly before `res.status(204).end()` that follows `DELETE FROM matches`, add `invalidateRallyRatings()`.

In `POST /:id/void`, directly after `if (rows.length === 0) return res.status(404)...`, add `invalidateRallyRatings()`.

In `server/src/routes/sessions.js`, add the same import, then add `invalidateRallyRatings()` directly before `res.status(204).end()` in `DELETE /:id`, and directly after the `404` guard in `POST /:id/void`.

- [ ] **Step 6: Syntax-check the routes and rerun the checks**

Run: `node --check server/src/routes/matches.js && node --check server/src/routes/sessions.js && node server/scripts/check-rally-rating-store.mjs && node server/scripts/check-rally-rating.mjs`
Expected: no syntax errors; both checks `0 failed`.

- [ ] **Step 7: Register and commit**

In `server/package.json` scripts, after `"test:rally-rating"`, add:

```json
    "test:rally-rating-store": "node scripts/check-rally-rating-store.mjs",
```

```bash
git add server/src/rally-rating-store.js server/scripts/check-rally-rating-store.mjs server/src/routes/matches.js server/src/routes/sessions.js server/package.json
git commit -m "Load the rally rating once and rebuild it after any change

The store replays the same completed, non-voided matches the export
counts and keeps the result in memory. Pushing a match log, deleting or
voiding a match, and deleting or voiding a session all clear it."
```

---

### Task 4: Send it to players

**Files:**
- Modify: `server/src/routes/player.js` (`GET /me`, `GET /standing`)
- Modify: `server/scripts/smoke.mjs` (the "and so does the rating" block)

**Interfaces:**
- Consumes: `getRallyRatings` (Task 3), `rallyRatingFor` (Task 2).
- Produces: `GET /player/me` response gains `rallyRating: RallyRatingResponse`; `GET /player/standing` response becomes `{ standing: { ...existing, rallyRating: RallyRatingResponse (with movedMost) } }`.

- [ ] **Step 1: Add the smoke checks (run later against staging)**

In `server/scripts/smoke.mjs`, directly after the `check('and so does the rating', ...)` call, add:

```js
    check('/player/me carries the rally rating',
      ['rated', 'not_enough_matches'].includes(linkedMe.body.rallyRating?.state),
      JSON.stringify(linkedMe.body.rallyRating ?? null).slice(0, 120))
    check('and never another player\'s points',
      !JSON.stringify(linkedMe.body.rallyRating ?? {}).includes('byEnding'),
      'rallyRating is the shaped response, not the raw rating')
    const standingWithRally = await asPlayer('/player/standing', { bearer: linked.body.token })
    check('/player/standing carries the rally rating too',
      ['rated', 'not_enough_matches'].includes(standingWithRally.body.standing?.rallyRating?.state),
      JSON.stringify(standingWithRally.body.standing?.rallyRating ?? null).slice(0, 120))
```

- [ ] **Step 2: Wire the routes**

In `server/src/routes/player.js`, add imports:

```js
import { getRallyRatings } from '../rally-rating-store.js'
import { rallyRatingFor } from '../rally-rating.js'
```

In `GET /me`, after `const rating = await getRatingState(...)`, add:

```js
  // The player-facing rating, rally by rally. The ML snapshot above stays
  // for the group and playstyle steps.
  const rallyRating = rallyRatingFor(await getRallyRatings(query), req.player.id)
```

and add `rallyRating,` to the `res.json({ ... })` object directly after `rating,`.

Replace the body of `GET /standing` with:

```js
router.get('/standing', async (req, res) => {
  const [standing, ratings] = await Promise.all([
    getClubStanding(query, req.player.id),
    getRallyRatings(query),
  ])
  res.json({
    standing: {
      ...standing,
      rallyRating: rallyRatingFor(ratings, req.player.id, { withMovedMost: true }),
    },
  })
})
```

- [ ] **Step 3: Syntax-check**

Run: `node --check server/src/routes/player.js && node --check server/scripts/smoke.mjs`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/player.js server/scripts/smoke.mjs
git commit -m "Send players their rally rating

/player/me carries the player's own rallyRating beside the ML snapshot,
and /player/standing adds it with the endings that moved it most. The
smoke test checks both are present and carry nothing about anyone else."
```

- [ ] **Step 5: Deploy the API to staging and verify with a real player**

Run:

```bash
railway up --service api --environment staging --ci
```

Then claim a seeded staging player and read their rating (Ana Cruz's code was minted earlier in this project's session; any seeded player's code from `GET /players/:id/claim-code` works):

```bash
TOKEN=$(curl -s -X POST https://api-staging-8ac6.up.railway.app/auth/player/claim \
  -H 'content-type: application/json' -d '{"code":"2XVJ-RKGV-PRQQ"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s https://api-staging-8ac6.up.railway.app/player/me -H "authorization: Bearer $TOKEN" | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0)).rallyRating)'
curl -s https://api-staging-8ac6.up.railway.app/player/standing -H "authorization: Bearer $TOKEN" | node -pe 'JSON.stringify(JSON.parse(require("fs").readFileSync(0)).standing.rallyRating)'
```

Expected: `{"state":"rated","points":…,"recentChange":…,"trend":[…],"rallies":…,"matches":…,"winChanceVsStart":…}`, and the standing version with `"movedMost":null` (staging's current synthetic rallies carry no endings).

---

### Task 5: The prediction check

**Files:**
- Create: `server/scripts/rally-rating-prediction.mjs`
- Create: `ml/scripts/skill_score_prediction.py`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `rateHistory`, `expectedWin`, `START_POINTS`, `MIN_MATCHES` (Task 1), the staging API (`GET /sessions`, `GET /matches/session/:id`, `GET /matches/:id`, `GET /export/match-logs.csv`).
- Produces:
  - `server/scripts/rally-rating-prediction.mjs <API_URL>` with env `UMPIRE_TOKEN`: prints accuracy, 95% range and Brier score for the rally rating on the later 30% of matches, tunes `k` and `scale` on the earlier 70%, and writes `server/scripts/.rating-split.json` = `{ train: string[], test: string[], best: { k, scale } }`.
  - `ml/scripts/skill_score_prediction.py <API_URL> <split.json>` with env `UMPIRE_TOKEN`: prints the old skill score's accuracy, range and Brier on the same test matches.
  - Both print Spearman correlation against true ability when `server/scripts/.sim-pool-truth.json` exists (written in Task 6).

- [ ] **Step 1: Ignore generated files**

Append to `.gitignore`:

```
# Written by the rating scripts in server/scripts: which matches were used
# to build and to test, and the synthetic pool's hidden abilities.
server/scripts/.rating-split.json
server/scripts/.sim-pool-truth.json
```

- [ ] **Step 2: Write the rally-rating prediction script**

Create `server/scripts/rally-rating-prediction.mjs`:

```js
#!/usr/bin/env node
// ============================================================
// How well does the rally rating predict who wins?
//
//   UMPIRE_TOKEN=... node server/scripts/rally-rating-prediction.mjs https://api-staging-8ac6.up.railway.app
//
// Read-only. Matches are split by when they ended: the earlier 70% build
// the ratings, the later 30% are predicted, so no rating sees the result
// it predicts. k and scale are chosen using the earlier matches alone
// (the earlier 70% of THOSE build, the rest are predicted), then the
// winner is checked on the later matches.
//
// Writes server/scripts/.rating-split.json so ml/scripts/
// skill_score_prediction.py tests the old score on the very same matches.
// ============================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MIN_MATCHES, START_POINTS, expectedWin, rateHistory } from '../src/rally-rating.js'

const API = (process.argv[2] ?? '').replace(/\/$/, '')
const TOKEN = process.env.UMPIRE_TOKEN
if (!API || !TOKEN) {
  console.error('usage: UMPIRE_TOKEN=... node server/scripts/rally-rating-prediction.mjs <API_URL>')
  process.exit(2)
}
const here = dirname(fileURLToPath(import.meta.url))

async function get(path) {
  const response = await fetch(API + path, { headers: { authorization: `Bearer ${TOKEN}` } })
  if (!response.ok) throw new Error(`${path} -> ${response.status}`)
  return response.json()
}

const { sessions } = await get('/sessions')
const matches = []
for (const session of sessions.filter((s) => !s.voided_at)) {
  const { matches: listed } = await get(`/matches/session/${session.id}`)
  for (const summary of listed.filter((m) => m.status === 'completed' && !m.voidedAt && m.endedAt)) {
    const { match } = await get(`/matches/${summary.id}`)
    if (!match.winner) continue
    matches.push({ ...match, endedAt: match.endedAt })
  }
}
matches.sort((a, b) => new Date(a.endedAt) - new Date(b.endedAt) || a.id.localeCompare(b.id))

const cut = Math.floor(matches.length * 0.7)
const train = matches.slice(0, cut)
const test = matches.slice(cut)
console.log(`completed matches with a winner: ${matches.length} (build ${train.length}, predict ${test.length})`)

/** Accuracy, Brier score and count of the rated test matches. */
function evaluate(built, onMatches, scale) {
  let right = 0
  let total = 0
  let brier = 0
  for (const m of onMatches) {
    const side = (ids) => ids.map((id) => built.get(id))
    const a = side(m.teamA)
    const b = side(m.teamB)
    if ([...a, ...b].some((r) => !r || r.matches < MIN_MATCHES)) continue
    const mean = (rs) => rs.reduce((s, r) => s + r.rawPoints, 0) / rs.length
    // A match is a long run of rallies, so a small per-rally edge becomes
    // a large match edge; the per-rally chance still orders sides
    // correctly, which is what accuracy measures, and Brier uses it as
    // the side's chance of the match.
    const chanceA = expectedWin(mean(a), mean(b), scale)
    if (chanceA === 0.5) continue
    const aWon = m.winner === 'A'
    total += 1
    right += Number((chanceA > 0.5) === aWon)
    brier += (chanceA - Number(aWon)) ** 2
  }
  return { total, accuracy: total ? right / total : NaN, brier: total ? brier / total : NaN }
}

function wilson(p, n) {
  const z = 1.96
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n)
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n)
  return [centre - half, centre + half]
}

// Tune on the earlier matches only.
const innerCut = Math.floor(train.length * 0.7)
let best = null
for (const k of [2, 4, 8, 12, 16, 24]) {
  for (const scale of [100, 200, 400, 800]) {
    const result = evaluate(rateHistory(train.slice(0, innerCut), { k, scale }), train.slice(innerCut), scale)
    if (result.total === 0) continue
    if (!best || result.accuracy > best.accuracy || (result.accuracy === best.accuracy && result.brier < best.brier)) {
      best = { k, scale, ...result }
    }
  }
}
console.log(`tuned on earlier matches: k=${best.k}, scale=${best.scale} (inner accuracy ${(best.accuracy * 100).toFixed(1)}% of ${best.total})`)

const built = rateHistory(train, { k: best.k, scale: best.scale })
const result = evaluate(built, test, best.scale)
const [low, high] = wilson(result.accuracy, result.total)
console.log(
  `rally rating on later matches: ${(result.accuracy * 100).toFixed(1)}% of ${result.total}` +
  ` (95% range ${(low * 100).toFixed(0)}%-${(high * 100).toFixed(0)}%), Brier ${result.brier.toFixed(3)}`,
)

writeFileSync(
  join(here, '.rating-split.json'),
  JSON.stringify({ train: train.map((m) => m.id), test: test.map((m) => m.id), best: { k: best.k, scale: best.scale } }, null, 2),
)

const truthPath = join(here, '.sim-pool-truth.json')
if (existsSync(truthPath)) {
  const truth = JSON.parse(readFileSync(truthPath, 'utf8')).players
  const everything = rateHistory(matches, { k: best.k, scale: best.scale })
  const pairs = truth
    .map((p) => [p.ability, everything.get(p.id)])
    .filter(([, r]) => r && r.matches >= MIN_MATCHES)
    .map(([ability, r]) => [ability, r.rawPoints])
  const rank = (values) => {
    const order = values.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0])
    const ranks = new Array(values.length)
    order.forEach(([, i], r) => { ranks[i] = r })
    return ranks
  }
  const ra = rank(pairs.map((p) => p[0]))
  const rb = rank(pairs.map((p) => p[1]))
  const n = pairs.length
  const d2 = ra.reduce((s, r, i) => s + (r - rb[i]) ** 2, 0)
  console.log(`rally rating vs true ability (all matches, ${n} players): Spearman ${(1 - (6 * d2) / (n * (n * n - 1))).toFixed(2)}`)
}
console.log(`(starting points ${START_POINTS}; split written to server/scripts/.rating-split.json)`)
```

- [ ] **Step 3: Write the old-score comparison**

Create `ml/scripts/skill_score_prediction.py`:

```python
"""
The old skill score's accuracy on the same matches the rally rating was
tested on.

    UMPIRE_TOKEN=... .venv/bin/python scripts/skill_score_prediction.py \
        https://api-staging-8ac6.up.railway.app ../server/scripts/.rating-split.json

Read-only. Builds the pipeline's skill score from the split's "train"
matches only, then picks the side with the higher average score in each
"test" match. Uses the vendored pipeline functions unchanged.
"""

import io
import json
import math
import os
import sys
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pipeline.player_profiles import aggregate_player_profiles  # noqa: E402
from pipeline.skill_model import calculate_skill_score  # noqa: E402

MIN_MATCHES = 5

api = sys.argv[1].rstrip("/")
split = json.loads(Path(sys.argv[2]).read_text())
token = os.environ["UMPIRE_TOKEN"]

response = requests.get(f"{api}/export/match-logs.csv", headers={"authorization": f"Bearer {token}"}, timeout=60)
response.raise_for_status()
rows = pd.read_csv(io.StringIO(response.text))
# pandas' datetime parsing crashes on this machine's Python 3.14 build,
# and nothing here needs the timestamps as dates.
rows["ended_at"] = rows["ended_at"].astype(str)

train_rows = rows[rows["match_id"].isin(set(split["train"]))]
counts = train_rows.groupby("player_id")["match_id"].nunique()
eligible = counts[counts >= MIN_MATCHES].index
scored = calculate_skill_score(aggregate_player_profiles(train_rows[train_rows["player_id"].isin(eligible)]))
if "player_id" not in scored.columns:
    scored = scored.reset_index()
skill = dict(zip(scored["player_id"], scored["skill_score"]))

right = total = 0
brier = 0.0
for match_id in split["test"]:
    group = rows[rows["match_id"] == match_id]
    if group.empty:
        continue
    a = group[group["team"] == "A"]
    b = group[group["team"] == "B"]
    won = a["won"].iloc[0]
    if pd.isna(won) or won == "":
        continue
    values_a = [skill.get(p) for p in a["player_id"]]
    values_b = [skill.get(p) for p in b["player_id"]]
    if None in values_a or None in values_b:
        continue
    mean_a = sum(values_a) / len(values_a)
    mean_b = sum(values_b) / len(values_b)
    if mean_a == mean_b:
        continue
    a_won = int(float(won)) == 1
    total += 1
    right += int((mean_a > mean_b) == a_won)
    # The score is 0-100, not a probability; a logistic on the gap gives
    # Brier something comparable to the rally rating's chance.
    chance_a = 1 / (1 + math.exp(-(mean_a - mean_b) / 10))
    brier += (chance_a - (1 if a_won else 0)) ** 2

accuracy = right / total if total else float("nan")
z = 1.96
centre = (accuracy + z * z / (2 * total)) / (1 + z * z / total)
half = z * math.sqrt(accuracy * (1 - accuracy) / total + z * z / (4 * total * total)) / (1 + z * z / total)
print(f"old skill score on later matches: {accuracy:.1%} of {total} "
      f"(95% range {centre - half:.0%}-{centre + half:.0%}), Brier {brier / total:.3f}")

truth_path = Path(sys.argv[2]).with_name(".sim-pool-truth.json")
if truth_path.exists():
    truth = json.loads(truth_path.read_text())["players"]
    all_counts = rows.groupby("player_id")["match_id"].nunique()
    all_eligible = all_counts[all_counts >= MIN_MATCHES].index
    all_scored = calculate_skill_score(aggregate_player_profiles(rows[rows["player_id"].isin(all_eligible)]))
    if "player_id" not in all_scored.columns:
        all_scored = all_scored.reset_index()
    frame = pd.DataFrame(truth).merge(all_scored[["player_id", "skill_score"]], left_on="id", right_on="player_id")
    rho = frame[["ability", "skill_score"]].corr(method="spearman").iloc[0, 1]
    print(f"old skill score vs true ability (all matches, {len(frame)} players): Spearman {rho:.2f}")
```

- [ ] **Step 4: Run both on the current staging pool**

Run (from the repo root; `UMPIRE_TOKEN` is a staging umpire session token):

```bash
UMPIRE_TOKEN=$UMPIRE_TOKEN node server/scripts/rally-rating-prediction.mjs https://api-staging-8ac6.up.railway.app
cd ml && UMPIRE_TOKEN=$UMPIRE_TOKEN .venv/bin/python scripts/skill_score_prediction.py https://api-staging-8ac6.up.railway.app ../server/scripts/.rating-split.json
```

Expected: both print an accuracy line on the same number of later matches. The old score's line should land near the earlier check's 72%. Record both lines for the final report.

- [ ] **Step 5: Commit**

```bash
git add .gitignore server/scripts/rally-rating-prediction.mjs ml/scripts/skill_score_prediction.py
git commit -m "Measure how well each rating predicts who wins

Both scripts read staging without writing to it and test on the same
later matches: the rally rating (with k and scale chosen on earlier
matches only) and the pipeline's old skill score. When a synthetic
pool's true abilities are on disk, both also report how closely each
rating orders players by true ability."
```

---

### Task 6: Regenerate the synthetic pool, with true ability saved

**Files:**
- Create: `server/scripts/seed-sim-pool.mjs`

**Interfaces:**
- Consumes: the staging API (`GET/POST /sessions`, `POST /sessions/:id/void`, `PUT /sessions/:id/players`, `POST /players`, `POST /matches`, `PUT /matches/:id/log`), `deriveMatchState` and `currentServerPlayerId` from `server/src/pickleball.js`, `RALLY_ENDINGS` from `server/src/rally-endings.js`.
- Produces: a staging session "Simulated pool (synthetic)" with 50 players named "… (sim)", about 100 completed doubles matches whose rallies carry endings, the old "Seeded pool (synthetic)" session voided, and `server/scripts/.sim-pool-truth.json` = `{ players: [{ id, name, ability, netPlay, dropPreference }] }`.

- [ ] **Step 1: Write the seeder**

Create `server/scripts/seed-sim-pool.mjs`:

```js
#!/usr/bin/env node
// ============================================================
// A synthetic player pool with its true abilities written down.
//
//   UMPIRE_TOKEN=... node server/scripts/seed-sim-pool.mjs https://api-staging-8ac6.up.railway.app [players] [matchesPerPlayer]
//
// STAGING ONLY. Goes through the API with an umpire session -- no
// database credentials -- so every match passes the same validation as
// one scored courtside. Each player has a hidden ability and style; who
// ends each rally, whether it is a winner, and HOW it ended all follow
// from them, so a rating can be checked against the truth.
//
// Voids the older "Seeded pool (synthetic)" session so the two pools do
// not mix in ratings or the export, and writes the hidden abilities to
// server/scripts/.sim-pool-truth.json (never to the database).
// ============================================================

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentServerPlayerId, deriveMatchState } from '../src/pickleball.js'
import { RALLY_ENDINGS } from '../src/rally-endings.js'

const API = (process.argv[2] ?? '').replace(/\/$/, '')
const TOKEN = process.env.UMPIRE_TOKEN
if (!API || !TOKEN || !/staging|localhost|127\.0\.0\.1/.test(API)) {
  console.error('usage: UMPIRE_TOKEN=... node server/scripts/seed-sim-pool.mjs <STAGING_API_URL> [players] [matchesPerPlayer]')
  console.error('Refuses any API that is not staging or local.')
  process.exit(2)
}
const PLAYERS = Number(process.argv[3] ?? 50)
const PER_PLAYER = Number(process.argv[4] ?? 8)
const SESSION_NAME = 'Simulated pool (synthetic)'
const OLD_SESSION_NAME = 'Seeded pool (synthetic)'
const DEVICE = `sim-${randomUUID().slice(0, 8)}`
const here = dirname(fileURLToPath(import.meta.url))

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : {}
  if (!response.ok && response.status !== 409) throw new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 200)}`)
  return { status: response.status, data }
}

const rand = (lo, hi) => lo + Math.random() * (hi - lo)
const chance = (p) => Math.random() < p
const pick = (weighted) => {
  const total = weighted.reduce((s, [, w]) => s + w, 0)
  let roll = Math.random() * total
  for (const [value, w] of weighted) {
    roll -= w
    if (roll <= 0) return value
  }
  return weighted[weighted.length - 1][0]
}

// ---- Retire the older pool ----
const { data: listed } = await call('/sessions')
for (const old of listed.sessions.filter((s) => s.name === OLD_SESSION_NAME || s.name === SESSION_NAME)) {
  if (!old.voided_at) {
    await call(`/sessions/${old.id}/void`, { method: 'POST', body: { reason: 'Replaced by a regenerated synthetic pool' } })
    console.log(`voided session "${old.name}"`)
  }
}

// ---- Players ----
const FIRST = ['Ana', 'Ben', 'Cara', 'Dev', 'Elle', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jae', 'Kit', 'Lena', 'Mo',
  'Nia', 'Omar', 'Pia', 'Quin', 'Rey', 'Sam', 'Tara', 'Uma', 'Vic', 'Wes', 'Xena', 'Yuri', 'Zoe']
const LAST = ['Cruz', 'Reyes', 'Santos', 'Lim', 'Tan', 'Diaz', 'Uy', 'Chua', 'Bautista', 'Ramos']
const stamp = new Date().toISOString().slice(5, 10)
const people = []
for (let i = 0; i < PLAYERS; i += 1) {
  const name = `${FIRST[i % FIRST.length]} ${LAST[Math.floor(i / FIRST.length) % LAST.length]} ${stamp} (sim)`
  const { status, data } = await call('/players', { method: 'POST', body: { name } })
  const player = status === 409 ? data.player : data.player
  people.push({
    id: player.id,
    name: player.name,
    ability: rand(0.25, 0.85),
    netPlay: rand(0.15, 0.8),
    dropPreference: rand(0.2, 0.9),
  })
}

// ---- Session and roster ----
const sessionId = randomUUID()
await call('/sessions', { method: 'POST', body: { id: sessionId, name: SESSION_NAME } })
await call(`/sessions/${sessionId}/players`, { method: 'PUT', body: { playerIds: people.map((p) => p.id) } })

// ---- How a rally ends, from who ended it ----
const WINNERS = RALLY_ENDINGS.filter((e) => e.outcome === 'winner')
const FAULTS = RALLY_ENDINGS.filter((e) => e.outcome === 'error')

function endingFor(person, isServer) {
  const won = chance(person.ability)
  const atNet = chance(person.netPlay)
  if (won) {
    if (atNet) return WINNERS.find((e) => e.key === 'dink_winner')
    return pick([
      ...(isServer ? [[WINNERS.find((e) => e.key === 'ace'), 0.6]] : []),
      [WINNERS.find((e) => e.key === 'putaway'), 3],
      [WINNERS.find((e) => e.key === 'passing'), 2],
      [WINNERS.find((e) => e.key === 'lob'), 0.8],
      [WINNERS.find((e) => e.key === 'drop_winner'), 1.2],
      [WINNERS.find((e) => e.key === 'other_winner'), 0.4],
    ])
  }
  if (atNet) return pick([[FAULTS.find((e) => e.key === 'dink_error'), 3], [FAULTS.find((e) => e.key === 'kitchen'), 1]])
  // Weaker players make more of the self-inflicted faults.
  const careless = 1 - person.ability
  return pick([
    [FAULTS.find((e) => e.key === 'out'), 3],
    [FAULTS.find((e) => e.key === 'net'), 3],
    ...(isServer
      ? [[FAULTS.find((e) => e.key === 'service'), 1.2 * careless], [FAULTS.find((e) => e.key === 'foot_fault'), 0.3 * careless]]
      : []),
    [FAULTS.find((e) => e.key === 'two_bounce'), 0.6 * careless],
    [FAULTS.find((e) => e.key === 'net_touch'), 0.3],
    [FAULTS.find((e) => e.key === 'hit_by_ball'), 0.4],
    [FAULTS.find((e) => e.key === 'other_fault'), 0.2],
  ])
}

// ---- Matches ----
const rounds = Math.ceil((PLAYERS * PER_PLAYER) / (4 * Math.floor(PLAYERS / 4)))
const start = Date.now() - rounds * 12 * 90 * 60_000
let played = 0
let dropped = 0

for (let round = 0; round < rounds; round += 1) {
  const shuffled = [...people].sort(() => Math.random() - 0.5)
  for (let i = 0; i + 3 < shuffled.length; i += 4) {
    const [a1, a2, b1, b2] = shuffled.slice(i, i + 4)
    const four = [a1, a2, b1, b2]
    const match = {
      id: randomUUID(),
      sessionId,
      teamA: [a1.id, a2.id],
      teamB: [b1.id, b2.id],
      stacking: { A: false, B: false },
      firstServer: { team: 'A', playerId: a1.id },
      rightStart: { A: a1.id, B: b1.id },
      pointTarget: 11,
    }
    const startedAt = start + played * 90 * 60_000
    const events = []
    const weights = four.map((p) => p.ability ** 2)
    const totalWeight = weights.reduce((s, w) => s + w, 0)
    const actor = () => {
      let roll = Math.random() * totalWeight
      for (let j = 0; j < 4; j += 1) {
        roll -= weights[j]
        if (roll <= 0) return four[j]
      }
      return four[3]
    }

    let state = deriveMatchState({ ...match, events })
    for (let guard = 0; guard < 400 && !state.completed; guard += 1) {
      const serverId = currentServerPlayerId(state, match)
      const person = actor()
      const ending = endingFor(person, person.id === serverId)
      events.push({
        id: randomUUID(),
        seq: events.length,
        type: 'rally',
        at: startedAt + (events.length + 1) * 25_000,
        actingPlayerId: person.id,
        outcome: ending.outcome,
        zone: ending.zone,
        detail: ending.key,
      })
      state = deriveMatchState({ ...match, events })
    }
    if (!state.completed) {
      dropped += 1
      continue
    }

    await call('/matches', { method: 'POST', body: { ...match, startedAt } })
    await call(`/matches/${match.id}/log`, { method: 'PUT', body: { deviceId: DEVICE, events } })
    played += 1
  }
}

writeFileSync(
  join(here, '.sim-pool-truth.json'),
  JSON.stringify({ session: SESSION_NAME, players: people }, null, 2),
)
console.log(`Seeded ${people.length} players and ${played} completed matches in "${SESSION_NAME}".`)
if (dropped) console.log(`(${dropped} generated matches never resolved and were not sent.)`)
console.log('True abilities written to server/scripts/.sim-pool-truth.json')
```

- [ ] **Step 2: Run it against staging**

Run: `UMPIRE_TOKEN=$UMPIRE_TOKEN node server/scripts/seed-sim-pool.mjs https://api-staging-8ac6.up.railway.app`
Expected: `voided session "Seeded pool (synthetic)"`, then `Seeded 50 players and ~96 completed matches…`, and the truth file on disk.

- [ ] **Step 3: Confirm it landed**

Run:

```bash
curl -s https://api-staging-8ac6.up.railway.app/sessions -H "authorization: Bearer $UMPIRE_TOKEN" \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).sessions.filter(s=>/synthetic/.test(s.name)).map(s=>`${s.name} players=${s.player_count} matches=${s.match_count} voided=${!!s.voided_at}`).join("\n")'
```

Expected: "Simulated pool (synthetic)" with 50 players, ~96 matches, not voided; "Seeded pool (synthetic)" voided. The "Thesis" session is untouched.

- [ ] **Step 4: Run both prediction scripts again on the new pool**

Run the two commands from Task 5 Step 4.
Expected: accuracy lines on the new later matches, plus a `Spearman` line for each rating against true ability. Record all four lines.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/seed-sim-pool.mjs
git commit -m "Regenerate staging's synthetic pool with true abilities saved

Seeds through the API with an umpire session, so no database credentials
are needed and every match passes normal validation. Rallies carry
endings chosen from each player's hidden ability and style, the older
seeded session is voided, and the abilities are written to a local file
so ratings can be checked against the truth. Refuses non-staging APIs."
```

- [ ] **Step 6: Set the tuned constants**

If Task 6 Step 4's tuned `k`/`scale` differ from `DEFAULT_K = 8` / `DEFAULT_SCALE = 400`, update those two constants in `server/src/rally-rating.js` to the tuned values, and update the matching expectations in `server/scripts/check-rally-rating.mjs` only if a check hard-codes the old value (they use `DEFAULT_K`, so none should). Then run `node server/scripts/check-rally-rating.mjs` (expect `0 failed`) and commit:

```bash
git add server/src/rally-rating.js
git commit -m "Use the rally rating's tuned stake and scale

Chosen on the earlier matches of staging's regenerated synthetic pool
only, as the prediction check prints."
```

If they are unchanged, skip this step.

---

### Task 7: The rating card on the overview

**Files:**
- Create: `player/src/lib/endingWords.js`
- Create: `player/src/components/PointsTrend.jsx`
- Create: `player/src/components/RallyRating.jsx`
- Modify: `player/src/lib/PlayerData.jsx` (state and load)
- Modify: `player/src/screens/Overview.jsx` (replace `<SkillRating rating={rating} />`)
- Modify: `player/src/App.css` (append)

**Interfaces:**
- Consumes: `GET /player/me` → `rallyRating` (Task 4).
- Produces:
  - `usePlayerData().rallyRating: RallyRatingResponse | null`
  - `endingPhrase(key: string): string`
  - `<PointsTrend trend={number[]} />`
  - `<RallyRating rallyRating={RallyRatingResponse} />` (default export) and named `RallyPointsHeadline({ rallyRating })` for reuse in Task 8.

- [ ] **Step 1: Everyday words for endings**

Create `player/src/lib/endingWords.js`:

```js
// What the umpire app calls each rally ending, said the way a player
// would say it. The umpire app keeps the short technical labels.
const PHRASES = {
  ace: 'Serves they couldn’t return',
  putaway: 'Hard put-away shots',
  passing: 'Shots past your opponent',
  lob: 'Lobs over your opponent',
  drop_winner: 'Soft drops they couldn’t reach',
  dink_winner: 'Soft shots at the net',
  other_winner: 'Other winning shots',
  out: 'Hitting out',
  net: 'Hitting into the net',
  dink_error: 'Missed soft shots at the net',
  kitchen: 'Stepping into the no-volley zone',
  service: 'Missed serves',
  foot_fault: 'Stepping over the line on serve',
  two_bounce: 'Hitting before the bounce',
  net_touch: 'Touching the net',
  hit_by_ball: 'Getting hit by the ball',
  wrong_position: 'Wrong server or receiver',
  other_fault: 'Other mistakes',
}

export function endingPhrase(key) {
  return PHRASES[key] ?? 'Other rallies'
}
```

- [ ] **Step 2: Carry the rating in player data**

In `player/src/lib/PlayerData.jsx`, add to the initial state object, directly after `rating: null,`:

```js
    // The player-facing rally rating: points with anchors, or progress
    // towards five matches.
    rallyRating: null,
```

In the successful load, directly after `rating: me.rating ?? null,`, add:

```js
          rallyRating: me.rallyRating ?? null,
```

and in the error branch, directly after `rating: quiet ? s.rating : null,`, add:

```js
          rallyRating: quiet ? s.rallyRating : null,
```

- [ ] **Step 3: The trend line**

Create `player/src/components/PointsTrend.jsx`:

```jsx
// The player's own points after each recent match, as a line with no
// numbers on it. It only moves when they play, so the shape is honest;
// the exact value is already the headline above it.
const WIDTH = 300
const HEIGHT = 56
const MIN_SPAN = 20

function PointsTrend({ trend }) {
  if (!trend || trend.length < 2) return null
  const low = Math.min(...trend)
  const high = Math.max(...trend)
  const span = Math.max(high - low, MIN_SPAN)
  const floor = low - (span - (high - low)) / 2
  const step = WIDTH / (trend.length - 1)
  const y = (value) => HEIGHT - ((value - floor) / span) * HEIGHT
  const line = trend.map((value, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${y(value).toFixed(1)}`).join(' ')
  const first = trend[0]
  const last = trend[trend.length - 1]
  const direction = last > first ? 'up' : last < first ? 'down' : 'level'

  return (
    <svg
      className="points-trend"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Your points over your last ${trend.length} matches, from ${first} to ${last}: ${direction}.`}
    >
      <path className="points-trend-line" d={line} />
    </svg>
  )
}

export default PointsTrend
```

- [ ] **Step 4: The card**

Create `player/src/components/RallyRating.jsx`:

```jsx
// ============================================================
// The skill rating card: points, what they mean, and where they are
// heading -- and never a comparison with anyone else. PaddlePad will be
// a small group for a long time, and a place or percentile jumps every
// time one person joins or plays. Points only move when you do.
// ============================================================

import { Link } from '../lib/router'
import Meter from './Meter'
import PointsTrend from './PointsTrend'

const START = 1500

function changeLine(change) {
  if (change > 0) return `▲ +${change} over your last 5 matches`
  if (change < 0) return `▼ ${change} over your last 5 matches`
  return 'Level over your last 5 matches'
}

/** The points and their anchors, shared with the rating screen. */
export function RallyPointsHeadline({ rallyRating }) {
  return (
    <>
      <p className="points-figure">
        {rallyRating.points.toLocaleString()} <span className="points-unit">points</span>
      </p>
      <p className={`points-change ${rallyRating.recentChange > 0 ? 'is-up' : rallyRating.recentChange < 0 ? 'is-down' : ''}`}>
        {changeLine(rallyRating.recentChange)}
      </p>
      <p className="points-anchor">
        Everyone starts at {START.toLocaleString()}. You&rsquo;d win about{' '}
        <strong>{rallyRating.winChanceVsStart} of every 100</strong> rallies against a{' '}
        {START.toLocaleString()} player.
      </p>
      <PointsTrend trend={rallyRating.trend} />
      <p className="points-basis">
        Based on {rallyRating.rallies.toLocaleString()} rallies · {rallyRating.matches} matches
      </p>
    </>
  )
}

function RallyRating({ rallyRating }) {
  if (!rallyRating) return null

  if (rallyRating.state === 'not_enough_matches') {
    const left = rallyRating.need - rallyRating.have
    return (
      <section className="rating rating-progress" aria-label="Skill rating">
        <h2>Skill rating</h2>
        <Meter
          label={`${rallyRating.have} of ${rallyRating.need} matches`}
          value={rallyRating.have / rallyRating.need}
          caption={left === 1 ? 'One to go.' : `${left} to go.`}
        />
        <p className="muted-inline">
          A couple of matches can&rsquo;t tell a good day from a good player.
        </p>
      </section>
    )
  }

  return (
    <section className="rating rating-points" aria-label="Skill rating">
      <h2>Skill rating</h2>
      <RallyPointsHeadline rallyRating={rallyRating} />
      <Link className="rating-more" to="/rating">
        What&rsquo;s moving it &rarr;
      </Link>
    </section>
  )
}

export default RallyRating
```

- [ ] **Step 5: Put it on the overview**

In `player/src/screens/Overview.jsx`: replace `import SkillRating from '../components/SkillRating'` with `import RallyRating from '../components/RallyRating'`; change `const { summary, matches, inProgress, rating } = usePlayerData()` to `const { summary, matches, inProgress, rallyRating } = usePlayerData()`; replace `<SkillRating rating={rating} />` with `<RallyRating rallyRating={rallyRating} />`.

- [ ] **Step 6: Style it**

Append to `player/src/App.css`:

```css
/* ============ Rally rating ============ */

.points-figure {
  font-family: var(--display);
  font-size: clamp(3.4rem, 16vw, 4.4rem);
  font-weight: 900;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
}
.points-unit {
  font-family: var(--label);
  font-size: 1.2rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}
.points-change {
  font-family: var(--label);
  font-size: 1.05rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin-top: 0.3rem;
}
.points-change.is-up { color: var(--status-good); }
.points-change.is-down { color: var(--status-critical); }
.points-anchor {
  font-size: 0.98rem;
  line-height: 1.5;
  color: var(--text-secondary);
  margin-top: 0.8rem;
  max-width: 34ch;
}
.points-anchor strong { color: var(--text); }
.points-trend { display: block; width: 100%; height: 56px; margin-top: 0.9rem; overflow: visible; }
.points-trend-line {
  fill: none;
  stroke: var(--series-1);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
.points-basis { font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem; }
```

- [ ] **Step 7: Build**

Run: `cd player && ./node_modules/.bin/vite build`
Expected: `✓ built`.

- [ ] **Step 8: Commit**

```bash
git add player/src/lib/endingWords.js player/src/components/PointsTrend.jsx player/src/components/RallyRating.jsx player/src/lib/PlayerData.jsx player/src/screens/Overview.jsx player/src/App.css
git commit -m "Show the rally rating as points on the overview

The rating card shows the player's own points, their change over the
last five matches, what the points mean in rallies against a 1,500
player, a trend line of their own points and how many rallies it rests
on. Nothing compares them with anyone else."
```

---

### Task 8: The rating screen's first step

**Files:**
- Modify: `player/src/screens/Rating.jsx` (`Score`, `Rating`, the `Parts`/`Games` usage and imports)
- Modify: `player/src/App.css` (append)

**Interfaces:**
- Consumes: `fetchStanding()` → `standing.rallyRating` (Task 4, with `movedMost`), `RallyPointsHeadline` (Task 7), `endingPhrase` (Task 7), `usePlayerData().rallyRating`.
- Produces: `/rating` renders step 1 from the rally rating for any player with 5+ matches, and steps 2 and 3 only when the ML snapshot is rated, as before.

- [ ] **Step 1: Replace step 1**

In `player/src/screens/Rating.jsx`, add imports:

```jsx
import { RallyPointsHeadline } from '../components/RallyRating'
import { endingPhrase } from '../lib/endingWords'
```

Replace the whole `Score` function with:

```jsx
/** Step 1: the player's own rally points, and what is moving them. */
function Score({ rallyRating }) {
  const moved = rallyRating.movedMost
  return (
    <Step number={1} title="Your rating">
      <RallyPointsHeadline rallyRating={rallyRating} />

      <div className="moving">
        <h3 className="moving-head">What&rsquo;s moving it</h3>
        {moved ? (
          <ul className="moving-list">
            {moved.gained[0] && (
              <li className="is-gain">
                <strong>{endingPhrase(moved.gained[0].ending)}</strong> earned you the most.
              </li>
            )}
            {moved.gained[1] && (
              <li className="is-gain">Then {endingPhrase(moved.gained[1].ending).toLowerCase()}.</li>
            )}
            {moved.cost[0] && (
              <li className="is-cost">
                <strong>{endingPhrase(moved.cost[0].ending)}</strong> cost you the most.
              </li>
            )}
            {moved.cost[1] && (
              <li className="is-cost">Then {endingPhrase(moved.cost[1].ending).toLowerCase()}.</li>
            )}
          </ul>
        ) : (
          <p className="step-line">
            This appears after 20 rallies scored with how they ended — a few
            rallies can&rsquo;t show a habit.
          </p>
        )}
      </div>

      <More label="How are the points worked out?">
        <p>
          Every rally is a small contest. Win it with a shot and you gain points;
          lose it with a mistake and you give some away. Beating a stronger side
          earns more than beating a weaker one. Your partner shares a little of
          each rally you end, and you share a little of theirs.
        </p>
        <p>
          Your points only change when you play — never because someone else
          did.
        </p>
      </More>
    </Step>
  )
}
```

Delete the `Parts`, `Games` and `NextGroup` functions only if nothing else in the file references them after Step 2; `NextGroup` is used by `Group` and stays.

- [ ] **Step 2: Render step 1 independently of the ML snapshot**

In the `Rating` component, change `const { rating } = usePlayerData()` to `const { rating, rallyRating } = usePlayerData()`, and replace everything from `const rated = ...` to the end of the returned JSX with:

```jsx
  const mlRated = standing?.state === 'rated' && rating?.state === 'rated'
  const rally = standing?.rallyRating ?? rallyRating

  return (
    <div className="standing">
      <BackLink />
      <h1>Your rating</h1>

      {error && <p className="error">{error}</p>}
      {!standing && !error && <p className="muted-inline">Loading…</p>}

      {standing && rally?.state !== 'rated' && (
        <p className="muted-inline">
          Your rating appears after {rally?.need ?? 5} matches — the card on your
          overview shows how close you are.
        </p>
      )}

      {standing && rally?.state === 'rated' && <Score rallyRating={rally} />}

      {mlRated && (
        <>
          <Group standing={standing} />
          <Playstyle standing={standing} />
        </>
      )}
    </div>
  )
```

Remove the `Distribution` import and `useCountUp` import if no longer used (check with the build).

- [ ] **Step 3: Style it**

Append to `player/src/App.css`:

```css
.moving { margin-top: 1.2rem; padding-top: 1rem; border-top: 1px solid var(--border); }
.moving-head {
  font-family: var(--label);
  font-size: 1rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.5rem;
}
.moving-list { display: grid; gap: 0.35rem; }
.moving-list li { font-size: 0.98rem; line-height: 1.45; color: var(--text-secondary); padding-left: 1.1rem; position: relative; }
.moving-list li::before { position: absolute; left: 0; font-weight: 700; }
.moving-list li.is-gain::before { content: '▲'; color: var(--status-good); font-size: 0.75rem; top: 0.2rem; }
.moving-list li.is-cost::before { content: '▼'; color: var(--status-critical); font-size: 0.75rem; top: 0.2rem; }
.moving-list strong { color: var(--text); }
```

- [ ] **Step 4: Build**

Run: `cd player && ./node_modules/.bin/vite build`
Expected: `✓ built` with no unused-import errors.

- [ ] **Step 5: Commit**

```bash
git add player/src/screens/Rating.jsx player/src/App.css
git commit -m "Rebuild the rating screen's first step around rally points

Step 1 shows the player's own points with their anchors, the endings
that earned and cost them the most in everyday words, and how the
points are worked out. It no longer shows a place among other players
or the old score's breakdown; steps 2 and 3 still come from the nightly
K-Means run."
```

---

### Task 9: Deploy to staging and check it across many players

**Files:**
- No source changes unless a check fails.

**Interfaces:**
- Consumes: everything above.
- Produces: staging API and player app on this plan's commits; screenshots and the prediction results for the owner.

- [ ] **Step 1: Run every server check**

Run:

```bash
cd server && for t in check-rally-rating check-rally-rating-store check-rally-endings check-serving check-third-shot check-board check-playstyle check-rating-parts check-expectation; do printf "%s: " $t; node scripts/$t.mjs | tail -1; done
```

Expected: every line `N passed, 0 failed`.

- [ ] **Step 2: Deploy**

Run:

```bash
railway up --service api --environment staging --ci
railway up --service play --environment staging --ci
```

Expected: `Deploy complete` for both.

- [ ] **Step 3: Screenshot the card and step 1 across players**

Using the headless Helium walk-through already used in this project (claim a code, set `paddlepad.player.token` and `paddlepad.player` in localStorage, open `/` and `/rating`), capture at 390×844 in light and dark:

- a player under 5 matches (claim any new player's code with no matches, or one of the "(sim)" players' codes before they have 5),
- a "(sim)" player with a high true ability (from `.sim-pool-truth.json`) and one with a low one,
- a "(sim)" player whose `recentChange` is negative,
- "Jan Librando" (few rallies with endings: "What's moving it" should show its waiting sentence).

Expected: every card shows points, change, the anchor sentence and "Based on …"; no card or step 1 shows a percentile, a place or another player's figure; high-ability players have more points than low-ability ones.

- [ ] **Step 4: Report**

Tell the owner, in plain words: both prediction results before and after regenerating the pool (accuracy with range, and the Spearman lines), the tuned `k`/`scale`, what the screenshots show, and anything that did not match the spec.
