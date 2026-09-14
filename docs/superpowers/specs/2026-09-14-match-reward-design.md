# Match reward: design

Date: 2026-09-14
Status: agreed with the project owner in chat, awaiting spec review

## Why

The rally rating never looks at who won the match. It adds up rallies one at a
time, and every mistake a player ends a rally with costs them three quarters of
their side's loss. So a player can be on the winning side and still go down.

- On staging, Dev Reyes 09-13 (sim) won his third match 11–9 and lost 1 point.
- In a simulation of level doubles matches their side won, the partner who made
  most of the mistakes (about 2 winning shots, 7 mistakes) ended on −1.3 points
  while the partner who carried them ended on +11.4.

The owner finds that too punishing. Mistakes should still cost points, but
winning the match should count for something, and count for more when the win
was less likely.

## Constraints

- A player only ever receives their own numbers. No percentiles, places or
  comparisons with other players.
- Player-app words are everyday words.
- Never compare raw counts across singles and doubles.
- Points only move between players: the average across everyone stays at 1,500.
- The rating is recomputed from the whole history, so the change applies to
  every past match on the next replay with no migration.
- The ML pipeline, its K-Means clustering and the nightly job do not change.
- Checks are standalone scripts in `server/scripts/check-*.mjs`. Deploy to
  staging only until the owner asks for production.

## Decisions

| Question | Decision |
|---|---|
| What should change | Winning should soften the loss from mistakes; a messy winner may still lose points (option B) |
| How big the reward is | Scaled: bigger for beating a stronger side, smaller for beating a weaker one |
| How "how likely to win" is worked out | From the rally chance, turned into the chance of winning the game under the real scoring rules (approach 1) |
| The reward's size | Chosen by the owner from a table of measured effects, not guessed |

## Part 1: The rule

### The chance of winning the game

The rating already gives each side a chance of winning a single rally,
`expectedWin(ownAverage, otherAverage, scale)`, from the players' points. A small
per-rally edge grows over a game. For example, measured by simulation:

| Rally chance | Singles game chance | Doubles game chance |
|---|---|---|
| 50% | 53% (first server's edge) | 50% |
| 52% | 64% | 60% |
| 55% | 77% | 75% |
| 60% | 92% | 91% |

A new pure function works this out exactly rather than by simulation:

`gameWinChance(rallyChance, { doubles, target, firstServer })` returns team A's
chance of winning the game, where `rallyChance` is team A's chance of winning any
one rally and `firstServer` is `'A'` or `'B'`.

It follows the rules in `server/src/pickleball.js`:

- Only the serving side scores.
- Singles: losing a rally on serve passes the serve.
- Doubles: the first service of the game has one server; after that each side
  has server 1 then server 2 before the serve passes. Which player serves does
  not matter, because the model gives a side the same rally chance whoever is
  serving.
- First to `target` (11, 15 or 21) with a two-point lead.

How it is computed: the chance of winning from each position (score, serving
side, server number, first-service flag). Within one score the serve can pass
around without anyone scoring, so the positions at one score are solved together
as a small set of equations. Once both sides have reached `target − 1`, only the
difference in score matters (level, one ahead, one behind), which keeps the
number of positions finite however long the game goes on.

### The reward

After the last counted rally of a match with a winner:

1. `chanceA = gameWinChance(expectedWin(averageA, averageB, scale), ...)`, using
   each side's average points from **before** the match. These are the same
   averages the match screen's expectation words already use.
2. The winning side's total is `MATCH_REWARD × (1 − their chance)`. The losing
   side's total is minus the same amount.
3. Each side's total is split equally between its players, the same as a rally's
   stake is shared out across a side. That keeps singles and doubles on the same
   footing.

Example with `MATCH_REWARD = 16`, doubles:

| Your side's chance before the match | You win | You lose |
|---|---|---|
| 25% | +6 each | −2 each |
| 50% | +4 each | −4 each |
| 75% | +2 each | −6 each |

No reward when the match has no winner (a match stopped early). Players with
fewer than five matches get it too, as they get rally points.

`MATCH_REWARD` is a named constant in `server/src/rally-rating.js`. `rateHistory`
accepts `options.matchReward` so scripts can try other sizes, and
`matchReward: 0` must give exactly today's ratings.

## Part 2: Choosing the size

A new read-only script, `server/scripts/match-reward-sizes.mjs`, run against
staging with an umpire token. For each size in 0, 8, 16, 24, 32 and 48 it prints:

- **Winners who still lost points:** on staging, how many player-matches on the
  winning side ended with a negative change, and the worst one.
- **The messy winner:** the earlier simulation (level doubles, one partner making
  most of the mistakes, matches their side won), showing each partner's average
  change.
- **True order:** how closely the ratings rank staging's synthetic players in
  the order of their hidden abilities (`server/scripts/.sim-pool-truth.json`),
  as a correlation between −1 and 1.
- **Picking winners:** how often the rating, built on the earlier 70% of
  matches, points at the winner of the later 30%. This is the same split and
  method as `server/scripts/rally-rating-prediction.mjs`.

The owner chooses a size from that table. The chosen value and the numbers behind
it are written beside the constant, the way the expectation bands were.

Adding the reward moves everyone's points, so the expectation bands script is
rerun afterwards and the band edges updated if its recommendation changes.

## Part 3: What the player sees

### Rating screen (`player/src/screens/Rating.jsx`)

- The "Where your points came from" list gains one row, **"Winning and losing
  matches"**, with a count in matches ("9 matches · +14") instead of rallies.
  The list still adds up exactly to the total.
- The sentence "N kinds of rally add up to" becomes "These add up to", since one
  row is not a kind of rally.
- "How are the points worked out?" gains one paragraph: winning a match adds
  points and losing one takes some away, more for beating a stronger side and
  less for beating a weaker one.

Server side, the ledger gains a `match_result` entry `{ matches, points }` and
`LEDGER_KINDS` includes it. The breakdown row for it carries `matches` rather
than `rallies`.

### Match screen (`player/src/screens/MatchDetail.jsx`)

- `rally` gains `result`: this player's reward from the match result, in whole
  points. It is `null` until the player is rated, as `change` is, and `null` when
  the match had no winner.
- Under the points line, when `result` is not null, the header shows the split:
  *"Rallies −1 · Winning the match +4"* (or *"Losing the match −3"*). The rallies
  figure is `change − result`, so the two always add up to the line above even
  after rounding.
- The rally endings list and its sentences are unchanged.

## Privacy

`result` is the player's own number. It does reveal how likely their side was to
win, and so the gap between their side's average and the other side's. That
cannot be turned into a partner's points without also knowing the opponents'
points, which players never see. The per-ending points already sent carry the
same kind of information, rally by rally, so this adds no new kind of exposure.

## Checks

- **New `server/scripts/check-game-chance.mjs`:**
  - a level doubles game is 50%;
  - the chance for B is one minus the chance for A;
  - a higher rally chance never gives a lower game chance;
  - a longer game (to 15 or 21) turns the same edge into a bigger chance;
  - the singles first server's edge is above 50%;
  - the exact answers agree with a brute-force simulation of the same rules to
    within one percentage point.
- **`server/scripts/check-rally-rating.mjs`**, new section:
  - the reward sums to zero across a match;
  - partners get equal shares;
  - the ledger, including `match_result`, still adds up to points − 1,500;
  - no winner gives no reward;
  - the reward uses the averages from before the match;
  - `matchReward: 0` reproduces the old ratings;
  - `rallyMatchFor` sends `result` only when rated.
- **Existing checks** whose expected numbers change because of the reward are
  updated, or pinned to `matchReward: 0` where the check is about rallies alone.
- **Smoke test:** the rally section's agreed keys become `change`, `endings`,
  `expectation`, `result`, `untagged`.
- **Staging:** screenshots of the rating screen and match screen for a messy win,
  a clean win, an upset and a loss, in light and dark.

## Out of scope

- Changing the ending weights or the three-quarters share for the player who
  ended a rally.
- Expressing the expectation words on the game chance instead of the rally
  chance.
- Production deploy.
