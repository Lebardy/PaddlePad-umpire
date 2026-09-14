# Match Reward Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the winning side of a match a points reward, scaled by how unlikely the win was, so winning softens the cost of mistakes without hiding them.

**Architecture:** A new pure module (`server/src/game-chance.js`) turns a per-rally win chance into the chance of winning a game under the real serving rules. The rally replay (`rateHistory` in `server/src/rally-rating.js`) applies `MATCH_REWARD × (result − chance)` to each side after a match's last rally, records it in the ledger and in each player's per-match facts, and `rallyMatchFor` sends the player's share as `result`. The player app shows it as a row on the rating screen and a split line in the match header. The reward's size is chosen by the owner from a table printed by a staging script.

**Tech Stack:** Node 20+ ES modules and Express 5 (server), React 18 + Vite (player app).

**Spec:** `docs/superpowers/specs/2026-09-14-match-reward-design.md`

## Global Constraints

- A player only ever receives their own numbers. No percentiles, places or comparisons with other players.
- Player-app words are everyday words.
- Never compare raw counts across singles and doubles.
- Points only move between players: the average across everyone stays at 1,500.
- The rating is recomputed from the whole history; no migration.
- The ML pipeline, its K-Means clustering and the nightly job do not change.
- Checks are standalone scripts in `server/scripts/check-*.mjs` printing `N passed, M failed` and exiting non-zero on failure; there is no test framework.
- Commit messages end with the last line of the body: no `Co-Authored-By` trailer.
- Work on branch `match-screen`. Deploy to staging only (`railway up --service <api|play> --environment staging --ci`) until the owner asks for production.
- Staging umpire login for scripts: `server/.env.smoke` (git-ignored) holds `SMOKE_EMAIL` and `SMOKE_PASSWORD`. Get a token with:
  `export UMPIRE_TOKEN=$(node --env-file=server/.env.smoke -e 'fetch("https://api-staging-8ac6.up.railway.app/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:process.env.SMOKE_EMAIL,password:process.env.SMOKE_PASSWORD})}).then(r=>r.json()).then(b=>process.stdout.write(b.token))')`
  (in fish: `set -x UMPIRE_TOKEN (node ... )`).

---

### Task 1: The chance of winning a game

**Files:**
- Create: `server/src/game-chance.js`
- Create: `server/scripts/check-game-chance.mjs`

**Interfaces:**
- Consumes: `deriveMatchState(match)` from `server/src/pickleball.js` (check only).
- Produces: `export function gameWinChance(rallyChance: number, { doubles: boolean, target?: number = 11, firstServer?: 'A'|'B' = 'A' }): number` — team A's chance of winning the game; `NaN` for a non-finite `rallyChance`.

- [ ] **Step 1: Write the check**

Create `server/scripts/check-game-chance.mjs`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node server/scripts/check-game-chance.mjs`
Expected: crashes with `Cannot find module '.../server/src/game-chance.js'`.

- [ ] **Step 3: Write the module**

Create `server/src/game-chance.js`:

```js
// ============================================================
// The chance of winning a game, from the chance of winning a rally.
//
// Only the serving side scores, so a small edge per rally grows over a
// game in a way that depends on the serving rules in pickleball.js:
// singles passes the serve on a lost rally; doubles gives each side a
// server 1 and a server 2, except the very first service of the game,
// which has one; first to the target with a two-point lead.
//
// Pure and exact (to floating point): no simulation. Used by the rally
// rating's match reward. See
// docs/superpowers/specs/2026-09-14-match-reward-design.md.
// ============================================================

/**
 * Team A's chance of winning a game when A wins any one rally with
 * `rallyChance`. `firstServer` is 'A' or 'B'. NaN in, NaN out.
 */
export function gameWinChance(rallyChance, { doubles, target = 11, firstServer = 'A' }) {
  if (!Number.isFinite(rallyChance)) return NaN
  const p = Math.min(1, Math.max(0, rallyChance))
  const deuce = target - 1

  // Once both sides reach target - 1 only the lead matters, so those
  // scores fold onto three: level, A one ahead, B one ahead.
  const fold = (a, b) => (a < deuce || b < deuce ? [a, b] : [deuce + Math.max(a - b, 0), deuce + Math.max(b - a, 0)])
  const winner = (a, b) => (Math.max(a, b) >= target && Math.abs(a - b) >= 2 ? (a > b ? 1 : 0) : null)

  // Serve states: [servingA, server number, first service of the game].
  const serves = [[true, 1, false], [false, 1, false]]
  if (doubles) serves.push([true, 2, false], [false, 2, false])
  serves.push([firstServer === 'A', doubles ? 2 : 1, true])
  const S = serves.length
  const size = target + 1
  const chance = new Float64Array(size * size * S).fill(0.5)
  const slot = (a, b, s) => (a * size + b) * S + s
  const serveIndex = (servingA, server, first) =>
    serves.findIndex(([x, y, z]) => x === servingA && y === server && z === first)

  const valueAt = (a, b, s) => {
    const done = winner(a, b)
    if (done !== null) return done
    const [fa, fb] = fold(a, b)
    return chance[slot(fa, fb, s)]
  }
  const update = (a, b, s) => {
    const [servingA, server, first] = serves[s]
    const scored = servingA ? valueAt(a + 1, b, s) : valueAt(a, b + 1, s)
    let sidedOut
    if (!doubles || first) sidedOut = valueAt(a, b, serveIndex(!servingA, 1, false))
    else if (server === 1) sidedOut = valueAt(a, b, serveIndex(servingA, 2, false))
    else sidedOut = valueAt(a, b, serveIndex(!servingA, 1, false))
    const next = servingA ? p * scored + (1 - p) * sidedOut : (1 - p) * scored + p * sidedOut
    const moved = Math.abs(next - chance[slot(a, b, s)])
    chance[slot(a, b, s)] = next
    return moved
  }
  // A block is every serve state at one score; the three folded deuce
  // scores form one block, because play cycles between them. Blocks are
  // settled from the end of the game backwards, so everything a block
  // leads to is already final and only its own loop needs iterating.
  const settle = (scores) => {
    for (let i = 0; i < 100000; i += 1) {
      let moved = 0
      for (const [a, b] of scores) for (let s = 0; s < S; s += 1) moved = Math.max(moved, update(a, b, s))
      if (moved < 1e-15) return
    }
  }
  settle([[deuce, deuce], [deuce + 1, deuce], [deuce, deuce + 1]])
  for (let sum = 2 * deuce - 1; sum >= 0; sum -= 1) {
    for (let a = Math.min(sum, target); a >= Math.max(0, sum - target); a -= 1) {
      const b = sum - a
      if (winner(a, b) !== null || (a >= deuce && b >= deuce)) continue
      settle([[a, b]])
    }
  }
  return chance[slot(0, 0, S - 1)]
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node server/scripts/check-game-chance.mjs`
Expected: `11 passed, 0 failed` (takes a few seconds: it plays 80,000 games through the real engine).

- [ ] **Step 5: Commit**

```bash
git add server/src/game-chance.js server/scripts/check-game-chance.mjs
git commit -m "Work out the chance of winning a game from a rally chance

Only the serving side scores, so a per-rally edge grows over a game in
a way that depends on the serving rules. gameWinChance solves it
exactly, score by score from the end of the game backwards, and the
check compares it with the real scoring engine playing 80,000 games."
```

---

### Task 2: The match reward in the replay

**Files:**
- Modify: `server/src/rally-rating.js`
- Modify: `server/scripts/check-rally-rating.mjs`
- Modify: `server/scripts/smoke.mjs`

**Interfaces:**
- Consumes: `gameWinChance` (Task 1); `DEFAULT_POINT_TARGET` and `deriveMatchState(match).winner` from `server/src/pickleball.js`.
- Produces:
  - `export const MATCH_REWARD = 16` (provisional; Task 3 sets it).
  - `rateHistory(matches, { matchReward })` — `matchReward` defaults to `MATCH_REWARD`; `0` gives exactly the ratings from before this plan.
  - Each rating's `ledger.match_result: { matches: number, points: number }` (absent when no rewarded match).
  - Each `matchFacts[matchId].result: number | null` — this player's exact share.
  - `rallyMatchFor(...)` returns `{ change, endings, expectation, result, untagged }`; `result` is whole points, or `null` when unrated or no winner.
  - `LEDGER_KINDS` includes `'match_result'`; the rating-screen breakdown row for it is `{ kind: 'match_result', matches, points }` (no `rallies`).

- [ ] **Step 1: Write the failing checks**

In `server/scripts/check-rally-rating.mjs`:

(a) Add `MATCH_REWARD,` to the import list from `'../src/rally-rating.js'`, directly before `MIN_MATCHES,`.

(b) After the line `import { RALLY_ENDINGS, rallyEnding } from '../src/rally-endings.js'` add:

```js
import { gameWinChance } from '../src/game-chance.js'
```

(c) Replace

```js
    sent.breakdown.every((row) => Number.isInteger(row.points) && Number.isInteger(row.rallies) && row.rallies > 0), true,
```

with

```js
    sent.breakdown.every((row) => Number.isInteger(row.points) && Number.isInteger(row.rallies ?? row.matches) && (row.rallies ?? row.matches) > 0), true,
```

(d) Replace

```js
    Object.keys(sixth).sort(), ['change', 'endings', 'expectation', 'untagged'],
```

with

```js
    Object.keys(sixth).sort(), ['change', 'endings', 'expectation', 'result', 'untagged'],
```

(e) Insert this section directly before the final `console.log(`\n${pass} passed, ${fail} failed`)`:

```js
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
    'Points only move between players, so the average stays at 1,500.')
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
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node server/scripts/check-rally-rating.mjs`
Expected: crashes with `does not provide an export named 'MATCH_REWARD'`.

- [ ] **Step 3: Add the reward to the replay**

In `server/src/rally-rating.js`:

(a) Replace `import { deriveMatchState } from './pickleball.js'` with:

```js
import { DEFAULT_POINT_TARGET, deriveMatchState } from './pickleball.js'
import { gameWinChance } from './game-chance.js'
```

(b) Directly after `export const RECENT_MATCHES = 5` add:

```js
// The most a side can gain by winning a match, reached only by beating a
// side they had no chance against: the side's reward is MATCH_REWARD
// times (1 - their chance of winning the game), and the losers give up
// the same. Provisional until it is chosen from
// server/scripts/match-reward-sizes.mjs; see the comment written here.
export const MATCH_REWARD = 16
```

(c) In `rateHistory`, directly after `const actorShare = options.actorShare ?? ACTOR_SHARE` add:

```js
  const matchReward = options.matchReward ?? MATCH_REWARD
```

(d) In the `matchFacts[match.id]` object literal, directly after `untagged: 0,` add:

```js
        // This player's share of the match reward; null when none.
        result: null,
```

(e) Replace `const { foldedEvents } = deriveMatchState(match)` with:

```js
    const { foldedEvents, winner } = deriveMatchState(match)
```

(f) Directly before the end-of-match loop (`for (const id of everyone) {` whose first line is `player(id).matches += 1`), add:

```js
    // The match reward, after every rally. Worked out from each side's
    // average points BEFORE the match, like the expectation words, and
    // shared equally within a side: winning is a team result, so the
    // three-quarters share for whoever ended a rally does not apply.
    if (matchReward > 0 && winner) {
      const chanceA = gameWinChance(expectedWin(averageA, averageB, scale), {
        doubles: match.teamA.length === 2,
        target: match.pointTarget ?? DEFAULT_POINT_TARGET,
        firstServer: match.firstServer.team,
      })
      const sideA = matchReward * (winner === 'A' ? 1 - chanceA : -chanceA)
      for (const id of everyone) {
        const share = onA.has(id) ? sideA / match.teamA.length : -sideA / match.teamB.length
        const p = player(id)
        p.points += share
        const entry = (p.ledger.match_result ??= { matches: 0, points: 0 })
        entry.matches += 1
        entry.points += share
        p.matchFacts[match.id].result = share
      }
    }

```

(g) In `wholeBreakdown`, replace

```js
    .filter(([, entry]) => entry.rallies > 0)
    .map(([key, entry]) => ({
      ...(LEDGER_KINDS.includes(key) ? { kind: key } : { kind: 'ending', ending: key }),
      rallies: entry.rallies,
```

with

```js
    .filter(([, entry]) => (entry.rallies ?? entry.matches) > 0)
    .map(([key, entry]) => ({
      ...(LEDGER_KINDS.includes(key) ? { kind: key } : { kind: 'ending', ending: key }),
      // Counted in matches for the match reward, in rallies for the rest.
      ...(key === 'match_result' ? { matches: entry.matches } : { rallies: entry.rallies }),
```

(h) Replace `export const LEDGER_KINDS = ['untagged', 'partner', 'opponent_winner', 'opponent_error']` with:

```js
export const LEDGER_KINDS = ['untagged', 'partner', 'opponent_winner', 'opponent_error', 'match_result']
```

(i) In `rallyMatchFor`, directly after the line `change: rated ? Math.round(facts.after) - Math.round(facts.before) : null,` add:

```js
    // This player's share of the match reward; null before they are
    // rated, and when the match had no winner.
    result: rated && facts.result !== null ? Math.round(facts.result) : null,
```

- [ ] **Step 4: Update the smoke test's agreed keys**

In `server/scripts/smoke.mjs`, replace

```js
        JSON.stringify(Object.keys(m.rally).sort()) === JSON.stringify(['change', 'endings', 'expectation', 'untagged']) &&
```

with

```js
        JSON.stringify(Object.keys(m.rally).sort()) === JSON.stringify(['change', 'endings', 'expectation', 'result', 'untagged']) &&
```

- [ ] **Step 5: Run every server check**

Run:

```bash
cd server && for f in src/*.js src/routes/*.js scripts/smoke.mjs; do node --check $f || echo "BAD $f"; done
for t in scripts/check-*.mjs; do case $t in *partner*) continue;; esac; printf "%s: " $t; node $t | tail -1; done
```

Expected: no `BAD` lines; `check-rally-rating.mjs: 72 passed, 0 failed`, `check-game-chance.mjs: 11 passed, 0 failed`, every other check `N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add server/src/rally-rating.js server/scripts/check-rally-rating.mjs server/scripts/smoke.mjs
git commit -m "Reward winning a match in the rally rating

After a match's last rally the winning side gains MATCH_REWARD times
one minus their chance of winning the game, worked out from everyone's
points before the match, and the losing side gives up the same. The
share is recorded in the ledger and sent with each match as result."
```

---

### Task 3: Choose the reward's size with the owner

**Files:**
- Create: `server/scripts/match-reward-sizes.mjs`
- Modify: `server/src/rally-rating.js` (`MATCH_REWARD` and its comment; possibly `EVEN_WITHIN` / `CLEAR_BEYOND`)

**Interfaces:**
- Consumes: `rateHistory(matches, { matchReward })` (Task 2), `gameWinChance` (Task 1), `server/scripts/.sim-pool-truth.json`, `server/scripts/expectation-bands.mjs`.
- Produces: the final `MATCH_REWARD`.

- [ ] **Step 1: Write the script**

Create `server/scripts/match-reward-sizes.mjs`:

```js
#!/usr/bin/env node
// ============================================================
// How big should the match reward be?
//
//   UMPIRE_TOKEN=... node server/scripts/match-reward-sizes.mjs https://api-staging-8ac6.up.railway.app
//
// Read-only. Replays staging's completed matches at several reward
// sizes and prints, for each, what it would do:
//
//   winners down  how many players on a winning side still ended the
//                 match with fewer (rounded) points, and the worst case
//   messy winner  a simulation of level doubles matches the side won,
//                 where one partner makes most of the mistakes: each
//                 partner's average change
//   true order    how closely the ratings rank the synthetic players by
//                 their hidden ability (Spearman, -1 to 1; 1 is perfect)
//   picks winner  built on the earlier 70% of matches, how often the
//                 favourite won the later 30% (everyone on court rated)
//
// The owner chooses the size; nothing here writes anything.
// ============================================================

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gameWinChance } from '../src/game-chance.js'
import { DEFAULT_POINT_TARGET, deriveMatchState } from '../src/pickleball.js'
import { rallyEnding } from '../src/rally-endings.js'
import { MIN_MATCHES, START_POINTS, expectedWin, rateHistory } from '../src/rally-rating.js'

const SIZES = [0, 8, 16, 24, 32, 48]

const API = (process.argv[2] ?? '').replace(/\/$/, '')
const TOKEN = process.env.UMPIRE_TOKEN
if (!API || !TOKEN) {
  console.error('usage: UMPIRE_TOKEN=... node server/scripts/match-reward-sizes.mjs <API_URL>')
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
    if (match.winner) matches.push(match)
  }
}
matches.sort((a, b) => new Date(a.endedAt) - new Date(b.endedAt) || a.id.localeCompare(b.id))
console.log(`completed matches with a winner: ${matches.length}`)

function winnersDown(matchReward) {
  const ratings = rateHistory(matches, { matchReward })
  let total = 0
  let down = 0
  let worst = 0
  for (const match of matches) {
    for (const id of match.winner === 'A' ? match.teamA : match.teamB) {
      const facts = ratings.get(id).matchFacts[match.id]
      const change = Math.round(facts.after) - Math.round(facts.before)
      total += 1
      if (change < 0) down += 1
      worst = Math.min(worst, change)
    }
  }
  return `${down}/${total}, worst ${worst}`
}

// A small seeded generator, so every size sees the same simulated matches.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const MESSY = [[4, 'A2', 'putaway'], [5, 'A1', 'out'], [1, 'A1', 'putaway'], [2, 'B1', 'putaway'], [2, 'B2', 'putaway'], [3, 'B1', 'net'], [3, 'B2', 'out']]
function simulatedMatch(random) {
  const match = {
    id: randomUUID(), endedAt: '2026-09-01T10:00:00Z', teamA: ['A1', 'A2'], teamB: ['B1', 'B2'],
    firstServer: { team: 'A', playerId: 'A1' }, rightStart: { A: 'A1', B: 'B1' }, pointTarget: 11, events: [],
  }
  const weight = MESSY.reduce((sum, [w]) => sum + w, 0)
  while (!deriveMatchState(match).completed) {
    let pick = random() * weight
    const [, player, key] = MESSY.find(([w]) => (pick -= w) < 0) ?? MESSY.at(-1)
    const ending = rallyEnding(key)
    match.events.push({ type: 'rally', id: randomUUID(), actingPlayerId: player, outcome: ending.outcome, zone: ending.zone, detail: ending.key })
  }
  return match
}
const random = seeded(20260914)
const simulated = Array.from({ length: 400 }, () => simulatedMatch(random)).filter((m) => deriveMatchState(m).winner === 'A')

function messyWinner(matchReward) {
  let messy = 0
  let carrier = 0
  for (const match of simulated) {
    const ratings = rateHistory([match], { matchReward })
    messy += ratings.get('A1').rawPoints - START_POINTS
    carrier += ratings.get('A2').rawPoints - START_POINTS
  }
  const signed = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
  return `${signed(messy / simulated.length)} / ${signed(carrier / simulated.length)}`
}

const truthPath = join(here, '.sim-pool-truth.json')
const truth = existsSync(truthPath) ? JSON.parse(readFileSync(truthPath, 'utf8')).players : null
function trueOrder(matchReward) {
  if (!truth) return 'no truth file'
  const ratings = rateHistory(matches, { matchReward })
  const pairs = truth.map((p) => [p.ability, ratings.get(p.id)]).filter(([, r]) => r && r.matches >= MIN_MATCHES)
  const rank = (values) => {
    const ranks = new Array(values.length)
    values.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]).forEach(([, i], r) => { ranks[i] = r })
    return ranks
  }
  const ra = rank(pairs.map(([ability]) => ability))
  const rb = rank(pairs.map(([, r]) => r.rawPoints))
  const n = pairs.length
  const d2 = ra.reduce((sum, r, i) => sum + (r - rb[i]) ** 2, 0)
  return `${(1 - (6 * d2) / (n * (n * n - 1))).toFixed(3)} (${n})`
}

const cut = Math.floor(matches.length * 0.7)
function picksWinner(matchReward) {
  const built = rateHistory(matches.slice(0, cut), { matchReward })
  let right = 0
  let total = 0
  for (const match of matches.slice(cut)) {
    const everyone = [...match.teamA, ...match.teamB].map((id) => built.get(id))
    if (everyone.some((r) => !r || r.matches < MIN_MATCHES)) continue
    const mean = (ids) => ids.reduce((sum, id) => sum + built.get(id).rawPoints, 0) / ids.length
    const chanceA = gameWinChance(expectedWin(mean(match.teamA), mean(match.teamB)), {
      doubles: match.teamA.length === 2,
      target: match.pointTarget ?? DEFAULT_POINT_TARGET,
      firstServer: match.firstServer.team,
    })
    total += 1
    if ((chanceA > 0.5) === (match.winner === 'A')) right += 1
  }
  return total ? `${right}/${total} (${Math.round((right / total) * 100)}%)` : '0/0'
}

console.log(`simulated messy wins: ${simulated.length} (messy partner / carrying partner)\n`)
console.log('size | winners down     | messy winner    | true order   | picks winner')
for (const size of SIZES) {
  console.log(`${String(size).padStart(4)} | ${winnersDown(size).padEnd(16)} | ${messyWinner(size).padEnd(15)} | ${trueOrder(size).padEnd(12)} | ${picksWinner(size)}`)
}
```

- [ ] **Step 2: Run it on staging**

Run (with `UMPIRE_TOKEN` set as in Global Constraints): `node server/scripts/match-reward-sizes.mjs https://api-staging-8ac6.up.railway.app`
Expected: a counts line, a simulated-wins line, and a six-row table. A run on 2026-09-14 over 136 matches gave:

```
size | winners down     | messy winner    | true order   | picks winner
   0 | 46/263, worst -13 | -1.3 / +11.5    | 0.839 (50)   | 19/24 (79%)
   8 | 36/263, worst -13 | +0.7 / +13.5    | 0.823 (50)   | 19/24 (79%)
  16 | 32/263, worst -15 | +2.7 / +15.5    | 0.802 (50)   | 19/24 (79%)
  24 | 32/263, worst -17 | +4.7 / +17.5    | 0.779 (50)   | 19/24 (79%)
  32 | 36/263, worst -19 | +6.7 / +19.5    | 0.750 (50)   | 17/24 (71%)
  48 | 47/263, worst -23 | +10.7 / +23.5   | 0.689 (50)   | 17/24 (71%)
```

- [ ] **Step 3: STOP and ask the owner to choose a size**

Show the owner the table in plain words: for each size, how many winners still went down, what the messy partner and the carrying partner end on, how well the ratings still rank the players, and how often they pick the winner. Say that "true order" is measured against a synthetic pool whose hidden abilities only drive rallies, so it naturally favours a rating that ignores match results. Do not continue until the owner names a size.

- [ ] **Step 4: Set the constant**

Replace `MATCH_REWARD` and its comment in `server/src/rally-rating.js` with the chosen size and the printed row, in this form (numbers from Step 2's output for the chosen size):

```js
// The most a side can gain by winning a match, reached only by beating a
// side they had no chance against: the side's reward is MATCH_REWARD
// times (1 - their chance of winning the game), and the losers give up
// the same. Chosen by the owner on 2026-09-14 from
// server/scripts/match-reward-sizes.mjs over staging's <N> matches: at
// this size <down>/<total> winners still lost points (<down at 0> with
// no reward), the simulated messy partner averaged <messy> and the
// carrying partner <carrier>, ranking against true ability was <order>
// (<order at 0> with none), and the favourite won <picks>.
export const MATCH_REWARD = <chosen size>
```

- [ ] **Step 5: Rerun the expectation bands**

The reward moves everyone's points, so the band edges may move too.

Run: `node server/scripts/expectation-bands.mjs https://api-staging-8ac6.up.railway.app`

If the `recommended:` pair differs from `EVEN_WITHIN = 0.015`, `CLEAR_BEYOND = 0.02`, replace those two constants and update the counts in their comment from the new output (keep the comment's form). If it is the same pair, update only the counts in the comment.

- [ ] **Step 6: Run the checks**

Run: `node server/scripts/check-expectation.mjs && node server/scripts/check-rally-rating.mjs && node server/scripts/check-game-chance.mjs`
Expected: `10 passed, 0 failed`, `72 passed, 0 failed`, `11 passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add server/scripts/match-reward-sizes.mjs server/src/rally-rating.js
git commit -m "Choose the match reward's size from staging's matches

The sizes script replays staging at six reward sizes and prints how
many winners still lose points, what a simulated messy winner ends on,
how well the ratings rank the synthetic players and how often they pick
the winner. The owner's choice and its row are recorded beside the
constant, and the expectation bands are rerun on the new points."
```

---

### Task 4: The rating screen row

**Files:**
- Modify: `player/src/screens/Rating.jsx`

**Interfaces:**
- Consumes: `rallyRating.breakdown` rows, now including `{ kind: 'match_result', matches, points }` (Task 2).
- Produces: nothing for later tasks.

- [ ] **Step 1: Name the row**

In `player/src/screens/Rating.jsx`, in `LEDGER_WORDS`, directly after `opponent_error: 'Mistakes by your opponents',` add:

```jsx
  match_result: 'Winning and losing matches',
```

- [ ] **Step 2: Count it in matches**

Directly after the `signed` function, add:

```jsx
// A row's count: matches for the match reward, rallies for the rest.
function countWords(row) {
  if (row.matches !== undefined) return `${row.matches} ${row.matches === 1 ? 'match' : 'matches'}`
  return `${row.rallies} ${row.rallies === 1 ? 'rally' : 'rallies'}`
}
```

Replace

```jsx
                        <span className="part-theirs">{row.rallies} {row.rallies === 1 ? 'rally' : 'rallies'} · </span>
```

with

```jsx
                        <span className="part-theirs">{countWords(row)} · </span>
```

Replace

```jsx
                      label={`${label}: ${signed(row.points)} points over ${row.rallies} rallies`}
```

with

```jsx
                      label={`${label}: ${signed(row.points)} points over ${countWords(row)}`}
```

- [ ] **Step 3: Fix the sentence that called every row a kind of rally**

Replace

```jsx
                {rows.length} kinds of rally add up to <strong>{signed(total)}</strong>.
```

with

```jsx
                Altogether that comes to <strong>{signed(total)}</strong>.
```

- [ ] **Step 4: Explain the reward**

In the `More label="How are the points worked out?"` block, directly after the paragraph that ends `earns more than beating a weaker one.` (its closing `</p>`), add:

```jsx
        <p>
          Winning the match counts too. The winning side gains points and the
          losing side gives the same number up, shared equally between partners.
          Beating a side you were expected to lose to earns much more than
          beating one you were expected to beat.
        </p>
```

- [ ] **Step 5: Build**

Run: `cd player && ./node_modules/.bin/vite build`
Expected: `✓ built`, and `grep -n "kinds of rally" src/screens/Rating.jsx` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add player/src/screens/Rating.jsx
git commit -m "Show the match reward on the rating screen

The list of where a player's points came from gains a Winning and
losing matches row counted in matches, the summary no longer calls
every row a kind of rally, and the explainer says how the reward works."
```

---

### Task 5: The split in the match header

**Files:**
- Modify: `player/src/screens/MatchDetail.jsx` (`MatchPoints` and its use)
- Modify: `player/src/App.css` (the Match points block)

**Interfaces:**
- Consumes: `match.rally.result` (Task 2) and `match.won`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Show the split**

In `player/src/screens/MatchDetail.jsx`, replace the whole `MatchPoints` doc comment and function (from `/**\n * This match's change in the player's rally points` to its closing `}`) with:

```jsx
function signed(value) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'
}

/**
 * This match's change in the player's rally points, once they are rated,
 * and under it how much came from the rallies and how much from the
 * result. The rallies figure is the change minus the reward, so the two
 * always add up to the line above even after rounding. Their own numbers
 * only; null (not rated yet) shows nothing.
 */
function MatchPoints({ rally, won }) {
  if (!rally || rally.change === null) return null
  const { change, result } = rally
  const unit = Math.abs(change) === 1 ? 'point' : 'points'
  return (
    <>
      <p className={`match-points ${change > 0 ? 'is-up' : change < 0 ? 'is-down' : ''}`}>
        {change > 0 && `▲ +${change} ${unit} in this match`}
        {change < 0 && `▼ −${Math.abs(change)} ${unit} in this match`}
        {change === 0 && 'No change in points'}
      </p>
      {result !== null && (
        <p className="match-points-split">
          Rallies {signed(change - result)} · {won ? 'Winning' : 'Losing'} the match {signed(result)}
        </p>
      )}
    </>
  )
}
```

Replace `        <MatchPoints rally={match.rally} />` with:

```jsx
        <MatchPoints rally={match.rally} won={match.won} />
```

- [ ] **Step 2: Style it**

In `player/src/App.css`, replace

```css
.match-points + .expectation { margin-top: 0.5rem; }
```

with

```css
.match-points-split {
  margin-top: 0.2rem;
  font-size: 0.9rem;
  color: var(--board-muted);
  font-variant-numeric: tabular-nums;
}
.match-points + .expectation,
.match-points-split + .expectation { margin-top: 0.5rem; }
```

- [ ] **Step 3: Build**

Run: `cd player && ./node_modules/.bin/vite build`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add player/src/screens/MatchDetail.jsx player/src/App.css
git commit -m "Split a match's points into rallies and the result

Under the points line the match header now says how much came from the
rallies and how much from winning or losing the match, adding up
exactly to the change above."
```

---

### Task 6: Deploy to staging and check it across many matches

**Files:**
- No source changes unless a check fails.

**Interfaces:**
- Consumes: everything above.
- Produces: staging API and player app on this branch; screenshots for the owner.

- [ ] **Step 1: Deploy and smoke test**

Run from the repo root:

```bash
railway up --service api --environment staging --ci
railway up --service play --environment staging --ci
cd server && railway run --service api --environment staging -- sh -c 'SMOKE_INTERNAL_KEY="$INTERNAL_API_KEY" node --env-file=.env.smoke scripts/smoke.mjs https://api-staging-8ac6.up.railway.app' | grep -E "FAIL|passed, "
```

Expected: `Deploy complete` twice, then `N passed, 0 failed`.

- [ ] **Step 2: Read the data**

For Dev Reyes 09-13 (sim), Cara Reyes 09-13 (sim) and at least three other sim players (claim each through `GET /players/:id/claim-code` then `POST /auth/player/claim`; staging allows ten claims a minute), read `GET /player/matches` and `GET /player/standing`. Confirm:

- every `rally` has exactly the keys `change, endings, expectation, result, untagged`;
- for rated players, `result` is a whole number on every match with a winner and `null` otherwise;
- the sign of `result` matches `won` (a win is never negative, a loss never positive);
- `standing.rallyRating.breakdown` has one `match_result` row with `matches` equal to the number of rewarded matches, and the rows add up to `points − 1500`.

Also count how many winning player-matches still show a negative `change`, and name the worst.

- [ ] **Step 3: Screenshot**

Using the headless Helium walk-through (claim a code, set `paddlepad.player.token`, `paddlepad.player`, `paddlepad.player.setupDismissed` and `paddlepad.player.theme` in localStorage, open the page), capture at 390×844 in light and dark:

- the match screen for a messy win (a win whose rallies figure is negative);
- a clean win;
- an upset (`rally.expectation.upset` true and `won` true);
- a loss;
- the rating screen with "What's moving it" opened, for a rated sim player.

Expected: no page errors; every header split adds up to the points line; the rating screen shows "Winning and losing matches" with a count in matches.

- [ ] **Step 4: Report**

Tell the owner, in plain words: the size they chose and what it did to Dev's 11–9 win, how many winners still lose points on staging, what each screenshot shows, and anything that did not match the spec.
