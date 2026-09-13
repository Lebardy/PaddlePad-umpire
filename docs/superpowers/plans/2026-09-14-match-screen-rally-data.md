# Match Screen from Rally Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the player app match screen's old-score lines with this match's rally-points change, a rally-points expectation in words only, and how the rallies the player ended actually ended.

**Architecture:** The existing rally-rating replay (`server/src/rally-rating.js`) records per-player facts for every match it counts. A pure function turns one player's facts for one match into a small `rally` object, which `getPlayerMatches` attaches to each match in `GET /player/matches`. The old-score expectation (`expectation.js`) and "played like a" score are removed; `MatchDetail.jsx` renders the new fields.

**Tech Stack:** Node 20+ ES modules and Express 5 (server), React 18 + Vite (player app).

**Spec:** `docs/superpowers/specs/2026-09-14-match-screen-rally-data-design.md`

## Global Constraints

- A player only ever receives their own numbers. No field may carry another player's points, or a side average from which a partner's points could be worked out.
- Player-app words are everyday court words ("the kitchen", "winning shots", "mistakes"); ending names come from `player/src/lib/endingWords.js`.
- Never compare raw counts across singles and doubles. Everything here is about one match at a time.
- No percentiles, places or comparisons with other players.
- The ML pipeline, its K-Means clustering and the nightly job do not change.
- Points change is hidden until the player is rated (5+ counted matches, `MIN_MATCHES`); once rated, every earlier match shows its change.
- Checks are standalone scripts in `server/scripts/check-*.mjs` printing `N passed, M failed` and exiting non-zero on failure; there is no test framework.
- Commit messages end with the last line of the body: no `Co-Authored-By` trailer.
- Work on branch `match-screen`. Deploy to staging only (`railway up --service <api|play> --environment staging --ci`) until the owner asks for production.

---

### Task 1: Expectation bands from a rally chance

**Files:**
- Modify: `server/src/rally-rating.js` (add constants and one function near `expectedWin`)
- Modify: `server/scripts/check-expectation.mjs` (rewrite for the new function)

**Interfaces:**
- Consumes: `expectedWin(ratingFor, ratingAgainst, scale)` already in `rally-rating.js`.
- Produces:
  - `export const EVEN_WITHIN: number` and `export const CLEAR_BEYOND: number` — distances of a per-rally win chance from 0.5.
  - `export function expectationFromChance(chance: number, won: boolean | null): null | { expected: 'win'|'loss'|'even', margin: 'clear'|'slight'|null, upset: boolean }`

- [ ] **Step 1: Rewrite the check**

Replace the whole of `server/scripts/check-expectation.mjs` with:

```js
#!/usr/bin/env node
// ============================================================
// What was expected of a match, from rally points.
//
//   node server/scripts/check-expectation.mjs
//
// The replay gives each side's chance of winning a rally before the
// match. This checks how that chance becomes words: even, a slight
// favourite or a clear one, and when the result was an upset. Pure, so
// no database and no network.
// ============================================================

import { CLEAR_BEYOND, EVEN_WITHIN, expectationFromChance } from '../src/rally-rating.js'

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

const clearly = 0.5 + CLEAR_BEYOND + 0.001
const slightly = 0.5 + (EVEN_WITHIN + CLEAR_BEYOND) / 2
const barely = 0.5 + EVEN_WITHIN / 2

section('which side was favoured')
{
  check('a clear favourite who won',
    expectationFromChance(clearly, true), { expected: 'win', margin: 'clear', upset: false },
    `more than ${CLEAR_BEYOND} above an even chance is clear`)
  check('a clear underdog who won is an upset',
    expectationFromChance(1 - clearly, true), { expected: 'loss', margin: 'clear', upset: true },
    'the result went against a named favourite')
  check('a slight favourite who lost is a slip',
    expectationFromChance(slightly, false), { expected: 'win', margin: 'slight', upset: true },
    'upset is symmetric; the app calls this one a slip')
  check('a slight underdog who lost as expected',
    expectationFromChance(1 - slightly, false), { expected: 'loss', margin: 'slight', upset: false },
    'losing the one you were expected to lose is not an upset')
}

section('level is said as level')
{
  check('inside the even band nobody is favourite',
    expectationFromChance(barely, false), { expected: 'even', margin: null, upset: false },
    `within ${EVEN_WITHIN} of an even chance, naming a favourite would be false precision`)
  // A hair past each edge rather than exactly on it: 0.5 + 0.1 is
  // 0.09999999999999998 away from 0.5 in floating point.
  check('just past the even edge counts as a lean',
    expectationFromChance(0.5 + EVEN_WITHIN + 1e-9, true).expected, 'win',
    'the even band ends at its edge')
  check('just past the clear edge counts as clear',
    expectationFromChance(0.5 + CLEAR_BEYOND + 1e-9, true).margin, 'clear',
    'the clear band starts at its edge')
}

section('when nothing can be said')
{
  check('no chance, no expectation',
    expectationFromChance(Number.NaN, true), null, 'the page shows nothing rather than a hedge')
  check('a match with no winner is never an upset',
    expectationFromChance(1 - clearly, null), { expected: 'loss', margin: 'clear', upset: false },
    'there is no result to have gone against the expectation')
  check('the bands are in order',
    EVEN_WITHIN > 0 && CLEAR_BEYOND > EVEN_WITHIN && CLEAR_BEYOND < 0.5, true,
    'even sits inside slight, which sits inside clear')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node server/scripts/check-expectation.mjs`
Expected: crashes with `does not provide an export named 'CLEAR_BEYOND'`.

- [ ] **Step 3: Add the bands and the function**

In `server/src/rally-rating.js`, directly after the `expectedWin` function, add:

```js
// Where a side's chance of winning a rally, before a match, stops being
// "evenly matched" and becomes a slight or a clear favourite. Distances
// from an even 0.5. Provisional until Task 3 sets them from staging's
// matches; see the comment that task writes here.
export const EVEN_WITHIN = 0.01
export const CLEAR_BEYOND = 0.03

/**
 * What was expected of a match, in words, from the per-rally chance the
 * player's side had against the other before it started.
 *
 * Never a number: in doubles a side's points are two people, one of them
 * the reader, so any figure would hand over their partner's points.
 */
export function expectationFromChance(chance, won) {
  if (!Number.isFinite(chance)) return null
  const lean = chance - 0.5
  // No favourite, so no upset is possible.
  if (Math.abs(lean) < EVEN_WITHIN) return { expected: 'even', margin: null, upset: false }
  const expected = lean > 0 ? 'win' : 'loss'
  return {
    expected,
    margin: Math.abs(lean) >= CLEAR_BEYOND ? 'clear' : 'slight',
    // A match with no winner cannot have gone against expectation.
    upset: won === null || won === undefined ? false : (expected === 'win') !== won,
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node server/scripts/check-expectation.mjs`
Expected: `10 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add server/src/rally-rating.js server/scripts/check-expectation.mjs
git commit -m "Say what was expected of a match from a rally chance

Adds the even, slight and clear bands on a side's pre-match chance of
winning a rally, in words only, with the same upset rule as before. The
band edges are provisional until they are set from staging's matches."
```

---

### Task 2: Per-match facts in the replay, and what one match sends

**Files:**
- Modify: `server/src/rally-rating.js` (`rateHistory`, new `rallyMatchFor`, import `rallyEnding`)
- Modify: `server/scripts/check-rally-rating.mjs` (append a section)

**Interfaces:**
- Consumes: `expectationFromChance`, `EVEN_WITHIN`, `CLEAR_BEYOND` (Task 1); `rallyEnding(key)` from `server/src/rally-endings.js` returning `{ key, outcome, zone, ... } | undefined`.
- Produces:
  - Each rating from `rateHistory` gains `matchFacts: { [matchId]: { before: number, after: number, yourSide: number, theirSide: number, established: boolean, endings: { [ending]: { rallies: number, points: number } }, untagged: number } }`.
  - `export function rallyMatchFor(ratings: Map, playerId: string, matchId: string, won: boolean | null): null | { change: number | null, expectation: null | { expected, margin, upset }, endings: Array<{ ending: string, outcome: 'winner'|'error'|null, rallies: number, points: number | null }>, untagged: number }`

- [ ] **Step 1: Append the failing checks**

In `server/scripts/check-rally-rating.mjs`, add `rallyMatchFor,` to the import list from `'../src/rally-rating.js'` (after `rallyRatingFor,`), then insert this section directly before the final `console.log(`\n${pass} passed, ${fail} failed`)`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node server/scripts/check-rally-rating.mjs`
Expected: crashes with `does not provide an export named 'rallyMatchFor'`.

- [ ] **Step 3: Record the facts in the replay**

In `server/src/rally-rating.js`:

(a) Change the import line `import { RALLY_ENDINGS } from './rally-endings.js'` to:

```js
import { RALLY_ENDINGS, rallyEnding } from './rally-endings.js'
```

(b) In `rateHistory`'s `player()` initialiser, directly after `playedIn: [],` add:

```js
        // What each counted match did, keyed by match id: points either
        // side of it, each side's average points before it, whether
        // everyone on court was established, and the rallies this player
        // ended in it. Feeds the match screen through rallyMatchFor.
        matchFacts: {},
```

(c) Directly after `everyone.forEach(player)` in the match loop, add:

```js
    const onA = new Set(match.teamA)
    const averageA = average(match.teamA)
    const averageB = average(match.teamB)
    // Counted BEFORE this match is added to anyone's total.
    const established = everyone.every((id) => player(id).matches >= MIN_MATCHES)
    for (const id of everyone) {
      player(id).matchFacts[match.id] = {
        before: player(id).points,
        after: null,
        yourSide: onA.has(id) ? averageA : averageB,
        theirSide: onA.has(id) ? averageB : averageA,
        established,
        endings: {},
        untagged: 0,
      }
    }
```

(d) Inside the `for (const [id, change] of changes)` loop, directly after `entry.points += change`, add:

```js
        if (id === event.actingPlayerId) {
          const facts = p.matchFacts[match.id]
          if (event.detail) {
            const ended = (facts.endings[event.detail] ??= { rallies: 0, points: 0 })
            ended.rallies += 1
            ended.points += change
          } else {
            facts.untagged += 1
          }
        }
```

(e) In the end-of-match loop (`for (const id of everyone) { player(id).matches += 1 ...`), add as its last line:

```js
      player(id).matchFacts[match.id].after = player(id).points
```

(f) In the object pushed into `ratings`, directly after `ledger: p.ledger,` add:

```js
      matchFacts: p.matchFacts,
```

- [ ] **Step 4: Add `rallyMatchFor`**

Append to the end of `server/src/rally-rating.js`:

```js
/**
 * What the match screen is sent about one of this player's matches.
 *
 * Their own facts only. The side averages choose the expectation's words
 * and never leave here, so nobody's points -- a partner's included -- can
 * be worked out from what is sent. Points (the change, and each ending's
 * share) wait for the player to be rated, as they do on the overview.
 */
export function rallyMatchFor(ratings, playerId, matchId, won) {
  const rating = ratings?.get(playerId)
  const facts = rating?.matchFacts?.[matchId]
  if (!facts) return null
  const rated = rating.matches >= MIN_MATCHES
  return {
    change: rated ? Math.round(facts.after) - Math.round(facts.before) : null,
    expectation: facts.established
      ? expectationFromChance(expectedWin(facts.yourSide, facts.theirSide), won)
      : null,
    endings: Object.entries(facts.endings)
      .map(([ending, entry]) => ({
        ending,
        outcome: rallyEnding(ending)?.outcome ?? null,
        rallies: entry.rallies,
        points: rated ? Math.round(entry.points) : null,
      }))
      .sort((a, b) => b.rallies - a.rallies || a.ending.localeCompare(b.ending)),
    untagged: facts.untagged,
  }
}
```

- [ ] **Step 5: Run the checks**

Run: `node server/scripts/check-rally-rating.mjs && node server/scripts/check-rally-rating-store.mjs && node server/scripts/check-expectation.mjs`
Expected: `57 passed, 0 failed`, `4 passed, 0 failed`, `10 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add server/src/rally-rating.js server/scripts/check-rally-rating.mjs
git commit -m "Record what each match did in the rally replay

For every player in every counted match the replay now keeps their
points either side of it, each side's average points beforehand,
whether everyone on court had five matches, and the rallies they ended
in it. rallyMatchFor turns one player's facts for one match into what
the match screen needs, in words and their own numbers only."
```

---

### Task 3: Set the expectation bands from staging's matches

**Files:**
- Create: `server/scripts/expectation-bands.mjs`
- Modify: `server/src/rally-rating.js` (the two constants and their comment)

**Interfaces:**
- Consumes: `rateHistory`, `expectedWin`, `MIN_MATCHES` (Task 2), `EVEN_WITHIN`, `CLEAR_BEYOND` (Task 1); the umpire API `GET /sessions`, `GET /matches/session/:id`, `GET /matches/:id`.
- Produces: final values of `EVEN_WITHIN` and `CLEAR_BEYOND`.

- [ ] **Step 1: Write the script**

Create `server/scripts/expectation-bands.mjs`:

```js
#!/usr/bin/env node
// ============================================================
// Where "evenly matched" ends and a favourite begins.
//
//   UMPIRE_TOKEN=... node server/scripts/expectation-bands.mjs https://api-staging-8ac6.up.railway.app
//
// Read-only. Replays every completed match with a winner and, for each
// match where everyone on court already had five matches, takes team
// A's pre-match chance of winning a rally. Then tries candidate band
// edges and prints how often the favourite actually won in each band,
// recommending the pair that calls the most matches "clear" while clear
// favourites win at least three times in four and slight favourites
// more than half the time.
// ============================================================

import { MIN_MATCHES, expectedWin, rateHistory } from '../src/rally-rating.js'

const API = (process.argv[2] ?? '').replace(/\/$/, '')
const TOKEN = process.env.UMPIRE_TOKEN
if (!API || !TOKEN) {
  console.error('usage: UMPIRE_TOKEN=... node server/scripts/expectation-bands.mjs <API_URL>')
  process.exit(2)
}

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

const ratings = rateHistory(matches)
const called = []
for (const match of matches) {
  const facts = ratings.get(match.teamA[0])?.matchFacts?.[match.id]
  if (!facts?.established) continue
  called.push({ chance: expectedWin(facts.yourSide, facts.theirSide), aWon: match.winner === 'A' })
}
console.log(`matches with a winner: ${matches.length}; with everyone established: ${called.length}`)

function bands(evenWithin, clearBeyond) {
  const out = { even: [0, 0], slight: [0, 0], clear: [0, 0] }
  for (const { chance, aWon } of called) {
    const lean = Math.abs(chance - 0.5)
    const band = lean < evenWithin ? 'even' : lean >= clearBeyond ? 'clear' : 'slight'
    const favouriteWon = band === 'even' ? aWon : (chance > 0.5) === aWon
    out[band][0] += 1
    out[band][1] += favouriteWon ? 1 : 0
  }
  return out
}

const rate = ([n, won]) => (n ? `${won}/${n} (${Math.round((won / n) * 100)}%)` : '0/0')
let best = null
console.log('\neven<  clear>=  | even (A won)  | slight fav won | clear fav won')
for (const evenWithin of [0.005, 0.01, 0.015, 0.02, 0.025, 0.03]) {
  for (const clearBeyond of [0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.1]) {
    if (clearBeyond <= evenWithin) continue
    const b = bands(evenWithin, clearBeyond)
    console.log(`${evenWithin.toFixed(3)}  ${clearBeyond.toFixed(2)}    | ${rate(b.even).padEnd(13)} | ${rate(b.slight).padEnd(14)} | ${rate(b.clear)}`)
    const clearOk = b.clear[0] >= 5 && b.clear[1] / b.clear[0] >= 0.75
    const slightOk = b.slight[0] === 0 || b.slight[1] / b.slight[0] > 0.5
    if (clearOk && slightOk && (!best || b.clear[0] > best.b.clear[0])) best = { evenWithin, clearBeyond, b }
  }
}

if (best) {
  console.log(`\nrecommended: EVEN_WITHIN = ${best.evenWithin}, CLEAR_BEYOND = ${best.clearBeyond}`)
  console.log(`  even ${rate(best.b.even)} A won, slight favourites ${rate(best.b.slight)}, clear favourites ${rate(best.b.clear)}`)
} else {
  console.log('\nno pair meets the targets (clear favourites winning 3 in 4 over 5+ matches, slight more than half)')
}
```

- [ ] **Step 2: Run it on staging**

Run: `UMPIRE_TOKEN=$UMPIRE_TOKEN node server/scripts/expectation-bands.mjs https://api-staging-8ac6.up.railway.app`
Expected: the counts line, a table of candidate pairs, and either a `recommended:` line or `no pair meets the targets`.

- [ ] **Step 3: Set the constants**

If a pair was recommended, replace the two constants and their comment in `server/src/rally-rating.js` with the recommended values and the printed counts, in this form (numbers from the script's output):

```js
// Where a side's chance of winning a rally, before a match, stops being
// "evenly matched" and becomes a slight or a clear favourite. Distances
// from an even 0.5. Set from staging's synthetic pool with
// server/scripts/expectation-bands.mjs on 2026-09-14: of <N> matches
// where everyone on court had five matches, clear favourites won
// <won>/<n>, slight favourites <won>/<n>, and team A won <won>/<n> of the
// even ones. Rerun once real matches exist.
export const EVEN_WITHIN = <recommended EVEN_WITHIN>
export const CLEAR_BEYOND = <recommended CLEAR_BEYOND>
```

If no pair met the targets, keep `0.01` / `0.03`, write the full table's best row into the comment instead, and tell the owner the synthetic pool could not support "clear" claims.

Then run: `node server/scripts/check-expectation.mjs && node server/scripts/check-rally-rating.mjs`
Expected: `10 passed, 0 failed` and `57 passed, 0 failed`.

- [ ] **Step 4: Commit**

```bash
git add server/scripts/expectation-bands.mjs server/src/rally-rating.js
git commit -m "Set the expectation bands from staging's matches

The band script replays staging's completed matches, keeps the ones
where everyone on court had five matches, and reports how often each
kind of favourite won at each candidate edge. The chosen edges and the
counts behind them are recorded beside the constants."
```

---

### Task 4: Send the rally section in the match list, remove the old score

**Files:**
- Modify: `server/src/player-stats.js` (`getPlayerMatches`)
- Modify: `server/src/routes/player.js` (`GET /player/matches`)
- Delete: `server/src/expectation.js`
- Modify: `server/scripts/smoke.mjs` (two checks)

**Interfaces:**
- Consumes: `rallyMatchFor(ratings, playerId, matchId, won)` (Task 2); `getRallyRatings(query)` from `server/src/rally-rating-store.js` (already imported in `routes/player.js`).
- Produces: `getPlayerMatches(query, playerId, ratings = null)`; each match in `GET /player/matches` carries `rally` (shape from Task 2, or `null`) and no longer carries `expectation` or `ratedAs`.

- [ ] **Step 1: Add the smoke checks**

In `server/scripts/smoke.mjs`, directly after the `/player/standing carries the rally rating too` check, add:

```js
    const listWithRally = await asPlayer('/player/matches', { bearer: linked.body.token })
    const listed = listWithRally.body.matches ?? []
    check('/player/matches carries a rally section with only the agreed fields',
      listed.length > 0 && listed.every((m) => m.rally === null || (
        JSON.stringify(Object.keys(m.rally).sort()) === JSON.stringify(['change', 'endings', 'expectation', 'untagged']) &&
        m.rally.endings.every((e) => JSON.stringify(Object.keys(e).sort()) === JSON.stringify(['ending', 'outcome', 'points', 'rallies'])))),
      JSON.stringify(listed[0]?.rally ?? null).slice(0, 160))
    check('the match list no longer carries the old score',
      listed.every((m) => !('ratedAs' in m) && !('expectation' in m)),
      JSON.stringify(Object.keys(listed[0] ?? {})))
```

- [ ] **Step 2: Rewire `getPlayerMatches`**

In `server/src/player-stats.js`:

(a) Replace `import { expectationFor, sideRating } from './expectation.js'` with:

```js
import { rallyMatchFor } from './rally-rating.js'
```

(b) Change the signature and its doc comment ending to:

```js
 * `ratings`, when given, is the cached rally rating (getRallyRatings):
 * each match then carries `rally`, what that match did to this player's
 * points -- see rallyMatchFor. Callers that only need totals (the
 * profile summary, the monthly board) leave it out.
 */
export async function getPlayerMatches(query, playerId, ratings = null) {
```

(c) Delete the whole block from the comment `// What the model expected of each match BEFORE it was played, and` down to and including the `const scoredGame = new Map(...)` statement that ends with `)`.

(d) In the object returned for each row, replace everything from the comment `// A verdict in words and nothing else -- see expectation.js for` through the `ratedAs: ...` line with:

```js
      // What this match did to this player's rally points, the
      // expectation in words, and how the rallies they ended ended.
      // Null when the caller passed no ratings, or the replay did not
      // count this match.
      rally: ratings
        ? rallyMatchFor(ratings, playerId, row.id, row.winner === null ? null : row.winner === team)
        : null,
```

- [ ] **Step 3: Pass the ratings from the route**

In `server/src/routes/player.js`, replace the `/matches` route with:

```js
router.get('/matches', async (req, res) => {
  const ratings = await getRallyRatings(query)
  res.json({ matches: await getPlayerMatches(query, req.player.id, ratings) })
})
```

- [ ] **Step 4: Delete the old expectation module and confirm nothing uses it**

Run:

```bash
git rm server/src/expectation.js
grep -rn "expectation.js\|expectationFor\|sideRating\|scoresByRun\|scoredGame\|ratedAs" server/src server/scripts
```

Expected: no output.

- [ ] **Step 5: Syntax-check and run every server check**

Run:

```bash
cd server && for f in src/*.js src/routes/*.js scripts/smoke.mjs; do node --check $f || echo "BAD $f"; done
for t in scripts/check-*.mjs; do case $t in *partner*) continue;; esac; printf "%s: " $t; node $t | tail -1; done
```

Expected: no `BAD` lines; every check `N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add server/src/player-stats.js server/src/routes/player.js server/scripts/smoke.mjs
git commit -m "Send each match's rally section and drop the old score

GET /player/matches now attaches what each match did to the player's
rally points, the expectation in words and how the rallies they ended
ended. The old-score expectation, the played-like score and the
queries behind them are gone, with expectation.js."
```

- [ ] **Step 7: Deploy the API to staging and run the smoke test**

Run from the repo root:

```bash
railway up --service api --environment staging --ci
cd server && railway run --service api --environment staging -- sh -c 'SMOKE_INTERNAL_KEY="$INTERNAL_API_KEY" node scripts/smoke.mjs https://api-staging-8ac6.up.railway.app' | grep -E "FAIL|passed, "
```

(`SMOKE_EMAIL` / `SMOKE_PASSWORD` must be set to a staging umpire.)
Expected: `Deploy complete`, then `N passed, 0 failed` including the two new checks.

---

### Task 5: The match header

**Files:**
- Modify: `player/src/screens/MatchDetail.jsx` (`Expectation` component and header)
- Modify: `player/src/App.css` (append)

**Interfaces:**
- Consumes: `match.rally` from `usePlayerData().matches` (Task 4).
- Produces: `MatchPoints({ rally })` and a rewritten `Expectation({ match })` rendered inside `<header className="match-board">`.

- [ ] **Step 1: Replace the `Expectation` component**

In `player/src/screens/MatchDetail.jsx`, replace the whole doc comment and `Expectation` function (from `/**\n * What the model expected before this match` to the closing `}` of the function) with:

```jsx
/**
 * This match's change in the player's rally points, once they are rated.
 * Their own number only; null (not rated yet) shows nothing.
 */
function MatchPoints({ rally }) {
  if (!rally || rally.change === null) return null
  const { change } = rally
  return (
    <p className={`match-points ${change > 0 ? 'is-up' : change < 0 ? 'is-down' : ''}`}>
      {change > 0 && `▲ +${change} points in this match`}
      {change < 0 && `▼ −${Math.abs(change)} points in this match`}
      {change === 0 && 'No change in points'}
    </p>
  )
}

/**
 * Who was favoured before this match, from rally points, in words only.
 *
 * The server sends a verdict and never a figure: in doubles a side's
 * points are two people, one of them the reader, so a number would hand
 * over their partner's points. Absent when anyone on court had fewer than
 * five matches beforehand -- a missing line is better than a guess.
 */
function Expectation({ match }) {
  const what = match.rally?.expectation
  if (!what) return null

  const said = {
    even: 'Evenly matched.',
    win: what.margin === 'clear' ? 'You were expected to win comfortably.' : 'You were slight favourites.',
    loss: what.margin === 'clear' ? 'You were expected to lose.' : 'You were slight underdogs.',
  }[what.expected]

  return (
    <p className="expectation">
      {what.upset && (
        <span className="expectation-upset">{what.expected === 'loss' ? 'Upset' : 'Slip'}</span>
      )}
      <span>{said}</span>
    </p>
  )
}
```

- [ ] **Step 2: Put the points line in the header**

In the same file, directly before `<Expectation match={match} />`, add:

```jsx
        <MatchPoints rally={match.rally} />
```

and update the comment above `<Expectation match={match} />` to:

```jsx
        {/* Nothing at all when anyone on court had fewer than five
            matches beforehand. A missing line is better than a hedged one. */}
```

- [ ] **Step 3: Style it**

Append to `player/src/App.css`:

```css
/* ============ Match points ============ */

.match-points {
  margin-top: 0.8rem;
  font-family: var(--label);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
  color: var(--board-muted);
}
.match-points.is-up { color: var(--status-good); }
.match-points.is-down { color: var(--status-critical); }
.match-points + .expectation { margin-top: 0.5rem; }
```

- [ ] **Step 4: Build**

Run: `cd player && ./node_modules/.bin/vite build`
Expected: `✓ built`, and `grep -n "ratedAs\|played this one like" src/screens/MatchDetail.jsx` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add player/src/screens/MatchDetail.jsx player/src/App.css
git commit -m "Show a match's points change and a rally-points expectation

The match header now says what the match did to the player's rally
points once they are rated, and who was favoured beforehand in words
from rally points. The old score's played-like line is gone."
```

---

### Task 6: How your rallies ended

**Files:**
- Create: `player/src/components/RallyEndings.jsx`
- Modify: `player/src/screens/MatchDetail.jsx` (`detail-stats` section)
- Modify: `player/src/App.css` (append)

**Interfaces:**
- Consumes: `match.rally.endings: Array<{ ending, outcome, rallies, points }>` and `match.rally.untagged` (Task 4); `endingPhrase(key)` from `player/src/lib/endingWords.js`.
- Produces: `<RallyEndings rally={match.rally} />` (default export), rendering nothing when there are no endings.

- [ ] **Step 1: Write the component**

Create `player/src/components/RallyEndings.jsx`:

```jsx
// ============================================================
// How the rallies this player ended actually ended, in one match.
//
// Two short lists -- won with a shot, lost with a mistake -- in everyday
// words, largest first, each with a bar scaled to its own list. Under
// them, one sentence per list naming the ending that moved the player's
// points most; before they are rated (no points yet) it names the most
// frequent ending instead, so no points appear early.
//
// Only rallies this player ended themselves: a partner's shots describe
// the partner. Renders nothing when no rally they ended carried an ending,
// so the match screen can fall back to the older away/at-the-net bar.
// ============================================================

import { endingPhrase } from '../lib/endingWords'

function EndingList({ title, rows, className }) {
  if (rows.length === 0) return null
  const most = Math.max(...rows.map((row) => row.rallies))
  return (
    <div className={`endings-group ${className}`}>
      <h3 className="endings-head">{title}</h3>
      <ul className="endings-list">
        {rows.map((row) => (
          <li key={row.ending} className="endings-row">
            <span className="endings-name">{endingPhrase(row.ending)}</span>
            <span className="endings-track" aria-hidden="true">
              <span className="endings-fill" style={{ width: `${Math.round((row.rallies / most) * 100)}%` }} />
            </span>
            <span className="endings-count">{row.rallies}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function mostMoved(rows, sign) {
  const moved = rows.filter((row) => row.points !== null && Math.sign(row.points) === sign)
  if (moved.length === 0) return null
  return moved.reduce((best, row) => (Math.abs(row.points) > Math.abs(best.points) ? row : best))
}

function RallyEndings({ rally }) {
  const endings = rally?.endings ?? []
  if (endings.length === 0) return null

  const won = endings.filter((row) => row.outcome === 'winner')
  const lost = endings.filter((row) => row.outcome === 'error')
  const rated = endings.some((row) => row.points !== null)

  const earned = rated ? mostMoved(won, 1) : won[0]
  const cost = rated ? mostMoved(lost, -1) : lost[0]

  return (
    <div className="endings">
      <EndingList title="Won with a shot" rows={won} className="is-won" />
      <EndingList title="Lost with a mistake" rows={lost} className="is-lost" />

      {(earned || cost) && (
        <p className="endings-note">
          {cost && (rated
            ? <><strong>{endingPhrase(cost.ending)}</strong> cost you the most points in this match ({`−${Math.abs(cost.points)}`}).{' '}</>
            : <><strong>{endingPhrase(cost.ending)}</strong> was your most common mistake.{' '}</>)}
          {earned && (rated
            ? <><strong>{endingPhrase(earned.ending)}</strong> earned you the most (+{earned.points}).</>
            : <><strong>{endingPhrase(earned.ending)}</strong> was your most common winning shot.</>)}
        </p>
      )}

      {rally.untagged > 0 && (
        <p className="endings-untagged">
          {rally.untagged === 1
            ? '1 of your rallies had no ending recorded.'
            : `${rally.untagged} of your rallies had no ending recorded.`}
        </p>
      )}
    </div>
  )
}

export default RallyEndings
```

- [ ] **Step 2: Use it in the match screen**

In `player/src/screens/MatchDetail.jsx`:

(a) Add the import after `import Meter from '../components/Meter'`:

```jsx
import RallyEndings from '../components/RallyEndings'
```

(b) Replace the `<section className="detail-stats" ...>` opening through the end of the `winners > 0 ? (...) : (...)` block (the `StackedBar` and its `No winning shots in this match.` fallback) with:

```jsx
      <section className="detail-stats" aria-label="Your shots in this match">
        <h2>{hasEndings ? 'How your rallies ended' : 'Your shots'}</h2>

        {hasEndings ? (
          <RallyEndings rally={match.rally} />
        ) : winners > 0 ? (
          // A match scored before rallies recorded how they ended: the
          // older split is all there is to show.
          <StackedBar
            total={winners}
            segments={[
              { label: 'Away from the net', value: stats.clean_winners ?? 0, className: 'seg-1' },
              { label: 'At the net (dinks)', value: stats.dink_winners ?? 0, className: 'seg-2' },
            ]}
          />
        ) : (
          <p className="muted-inline">No winning shots in this match.</p>
        )}
```

(c) Directly after `const turn = turningPoint(match.progression ?? [])`, add:

```jsx
  const hasEndings = (match.rally?.endings?.length ?? 0) > 0
```

- [ ] **Step 3: Style it**

Append to `player/src/App.css`:

```css
/* ============ How your rallies ended ============ */

.endings { display: grid; gap: 1.1rem; }
.endings-head {
  font-family: var(--label);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 0.45rem;
}
.endings-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.35rem; }
.endings-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 2rem;
  align-items: center;
  gap: 0.6rem;
}
.endings-name { font-size: 0.92rem; line-height: 1.3; }
.endings-track { height: 0.6rem; background: var(--surface-sunken); border-radius: 1px; overflow: hidden; }
.endings-fill { display: block; height: 100%; }
.is-won .endings-fill { background: var(--status-good); }
.is-lost .endings-fill { background: var(--status-critical); }
.endings-count { font-size: 0.92rem; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
.endings-note { font-size: 0.95rem; line-height: 1.5; color: var(--text-secondary); }
.endings-note strong { color: var(--text); }
.endings-untagged { font-size: 0.85rem; color: var(--text-muted); }
```

- [ ] **Step 4: Build**

Run: `cd player && ./node_modules/.bin/vite build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add player/src/components/RallyEndings.jsx player/src/screens/MatchDetail.jsx player/src/App.css
git commit -m "Show how the rallies a player ended actually ended

The match screen's shots section lists the winning shots and the
mistakes that ended the player's rallies, in everyday words with bars,
names the one that moved their points most in each direction, and says
how many rallies had no ending recorded. Matches scored before endings
keep the away-from and at-the-net bar."
```

---

### Task 7: Deploy to staging and check it across many matches

**Files:**
- No source changes unless a check fails.

**Interfaces:**
- Consumes: everything above.
- Produces: staging API and player app on this branch; screenshots for the owner.

- [ ] **Step 1: Deploy the player app**

Run: `railway up --service play --environment staging --ci`
Expected: `Deploy complete`. (The API was deployed in Task 4.)

- [ ] **Step 2: Screenshot the match screen across matches**

Using the headless Helium walk-through already used for the rating screen (claim a code, set `paddlepad.player.token`, `paddlepad.player`, `paddlepad.player.setupDismissed` and `paddlepad.player.theme` in localStorage, open `/matches/<id>`), capture at 390×844 in light and dark:

- Dev Reyes (sim), a match from his last three (rated, doubles, endings recorded, an expectation line);
- a sim player's first or second match (everyone on court a newcomer: no expectation line, but points change because the player is rated today);
- Jan Librando's match (not rated: no points line, endings without points, "most common" sentences);
- if any staging match has no endings recorded (e.g. one from the older "Seeded pool" session in a player's history), that match: the away-from / at-the-net bar;
- a singles match, if staging has one: the expectation compares the two players and there is no partner line;
- a match whose `rally.expectation.upset` is true, if staging has one: the Upset or Slip badge.

Also read `match.rally` for each via `GET /player/matches` and confirm: `change` matches the header, every `endings[].outcome` is `winner` or `error`, and no key other than the four agreed ones appears.

Expected: no page errors; no "played this one like"; every header line and list matches the data.

- [ ] **Step 3: Report**

Tell the owner, in plain words: the chosen band edges and how often favourites won on staging, what each screenshot shows, and anything that did not match the spec.
