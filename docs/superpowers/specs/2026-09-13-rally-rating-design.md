# Rally rating: design

Date: 2026-09-13
Status: agreed with the project owner, awaiting spec review

## Why

The player-facing skill rating today is the ML pipeline's `skill_score`: four
measurements (drop success, winners per minute, mistakes per minute, dink
mistakes per minute), each min-max scaled across the pool and combined with
hand-picked weights. A read-only check on staging (build from the earlier 80
matches, predict the later 35) found:

- it picked 72% of 25 predictable winners (Wilson 95% range 52%-86%), better
  than a coin flip but on too few matches to trust much;
- it never looks at who won or against whom;
- mistakes per minute, 20% of the score, has no relationship with winning
  (Spearman -0.02 against win rate), most likely because busy players make
  more of everything;
- min-max scaling lets one unusual player squash everyone else, and per-minute
  counts are skewed by doubles.

The umpire app now records how every rally ended (18 endings in
`server/src/rally-endings.js`) and which player ended it. That is enough to
rate players rally by rally.

## Constraints

- **The thesis pipeline does not change.** The thesis is "PaddlePad:
  Unsupervised Feature Extraction and K-Means Clustering in Pickleball Player
  Matches". The nightly ML job, its K-Means clustering, and the old
  `skill_score` stay exactly as they are. The old score keeps its two internal
  jobs there: naming which skill cluster is higher-performance
  (`interpret_skill_clusters`) and residualising playstyle features before the
  second K-Means (`residualize_playstyle_features`).
- **No percentiles, and no comparison with other players on the rating.**
  PaddlePad will have a small population for a long time; percentiles and
  places jump when one person joins or plays.
- **Everyday words** in the player app; the umpire app keeps technical labels.
- **Privacy:** a player sees only their own points. Nothing lets anyone work
  out another player's points.

## Decisions

1. The new rating is a separate, player-facing number. The ML job keeps
   producing skill groups and playstyles from the old score.
2. It uses both how people played and results, through rallies.
3. One rating covers singles and doubles.
4. It is calculated rally by rally (Elo-style), not by a nightly model.
5. Players see raw points with anchors, not a percentile.

## Part 1: The rating model

### Points

- Every player starts at **1,500** points.
- Only **completed, non-voided** matches count, taken in the order they ended
  (`ended_at`, ties broken by match id).
- Within a match, events are replayed with the existing scoring engine rules:
  only `rally` events count, and folding stops at game point, exactly as
  `deriveMatchState` does. `thirdShot` and `serverCorrection` events do not
  move points.

### One rally

For each counted rally with acting player `p`:

1. `pSide` is p's team, `other` the opposing team.
2. The rally's **winning side** is `pSide` if the outcome is `winner`, otherwise
   `other`.
3. Side strength is the mean points of that side's players *before* the rally.
4. Expected chance the winning side wins the rally:
   `E = 1 / (1 + 10^((R_losers - R_winners) / S))`, with scale `S`.
5. Rally stake: `D = K * weight(ending) * (1 - E)`.
   Beating a stronger side (low `E`) moves more; beating a weaker side less.
6. Points move from the losing side to the winning side, `D` in total:
   - On **p's side**, p takes **3/4** of the side's share and p's partner
     **1/4**. In singles p takes all of it.
   - On the **other side**, the share is split **evenly** between its players.

The total change sums to zero across the four (or two) players, so the pool's
average stays at 1,500.

`K` (points at stake) and `S` (scale) are tuned on staging's earlier matches
only (see Part 4); starting values `K = 8`, `S = 400`.

### Ending weights

`weight(ending)` comes from the rally's `detail`. A rally without a detail
(recorded before endings existed) has weight **1**.

| Weight | Winning shots | Faults |
|---|---|---|
| 1.25 | — | `service`, `foot_fault`, `kitchen`, `two_bounce` |
| 1 | `ace`, `putaway`, `passing`, `lob`, `drop_winner`, `dink_winner` | `out`, `net`, `dink_error` |
| 0.75 | `other_winner` | `other_fault` |
| 0.5 | — | `hit_by_ball`, `net_touch`, `wrong_position` |

These are a first guess: staging's synthetic matches predate endings, so there
is no data to fit them. They are revisited once real matches carry endings.

### Rated or not

A player **is rated** once they have **5 counted matches** (the same floor the
pipeline uses). Below that, the app shows progress towards 5.

### Output per player

- `points` (rounded to the nearest whole point)
- `matches`, `rallies` counted
- `trend`: points after each of their last 10 counted matches, oldest first
- `recentChange`: points now minus points 5 matches ago (or since their first
  match, if fewer)
- `byEnding`: net points gained or lost per ending key, as the player who ended
  the rally only (partner and opponent shares are excluded, so this answers
  "what did *my* shots do")

## Part 2: Where it runs

In the API server, not the ML job.

- **`server/src/rally-rating.js`**: pure functions, no database.
  - `rateHistory(matches)`: takes completed, non-voided matches (`teamA`,
    `teamB`, `firstServer`, `rightStart`, `pointTarget`, `events`, `endedAt`,
    `id`) and returns `Map<playerId, PlayerRating>` as above.
  - `rallyWinChance(points, against = 1500, S)`: for the card's sentence.
  - Constants: `START_POINTS`, `K`, `S`, `ACTOR_SHARE = 0.75`, `ENDING_WEIGHTS`,
    `MIN_MATCHES = 5`. `ENDING_WEIGHTS` is keyed by `RALLY_ENDINGS` keys, and a
    check fails if any ending lacks a weight.
- **Loading and cache**: `server/src/rally-rating-store.js` loads completed,
  non-voided matches and their events (the same query shape as
  `buildMatchLogRows` in `export.js`), calls `rateHistory`, and keeps the
  result in memory. It is invalidated by every route that can change a
  completed match or whether it counts: `PUT /matches/:id/log` (events,
  completion and ending early all arrive through it), `POST /matches/:id/void`,
  `DELETE /matches/:id`, `POST /sessions/:id/void` and `DELETE /sessions/:id`. A server restart simply rebuilds on
  the first request. Nothing is stored in the database.
- **API**:
  - `GET /player/me` gains `rallyRating`: either
    `{ state: 'rated', points, recentChange, trend, rallies, matches,
    winChanceVsStart }` or `{ state: 'not_enough_matches', have, need }`.
    The existing `rating` field (ML snapshot) stays for steps 2 and 3.
  - `GET /player/standing` gains `rallyRating` with the same shape plus
    `movedMost: { gained: [{ ending, points }], cost: [{ ending, points }] }`
    (top two of each, from `byEnding`).
  - No response includes another player's points.
- **Unchanged**: the nightly ML job, `rating_runs`/`player_ratings`, the export,
  `expectation.js` (the match page's "what the rating expected" line keeps
  using the ML snapshot; switching it is a later decision).

## Part 3: What players see

### Overview rating card

```
SKILL RATING

  1,540 points
  ▲ +38 over your last 5 matches

  Everyone starts at 1,500.
  You'd win about 54 of every 100
  rallies against a 1,500 player.

  [trend line of your own points, no axis numbers]

  Based on 214 rallies · 9 matches
```

- `recentChange` of 0 reads "Level over your last 5 matches"; negative uses ▼.
- The "54 of every 100" sentence is `rallyWinChance(points)`, rounded.
- Not rated: "3 of 5 matches" progress, as today.
- No comparison with other players anywhere on the card.

### Rating screen, step 1 ("Your rating")

- The same points, change, anchor sentence, trend and "Based on…" line.
- **What's moving it**: the two endings that earned the most and the two that
  cost the most, from `movedMost`, in everyday words (see below). Hidden when
  the player has fewer than 20 rallies with a detail, because older rallies
  have no ending to name.
- Removed from step 1: the distribution chart, "higher than N of the M other
  rated players", "Four things are added up to make it" (`Parts`) and "The
  games behind it" (`Games`).

Steps 2 ("Your group") and 3 ("Your playstyle") are unchanged.

### Player-app words for endings

| Key | Player app |
|---|---|
| `ace` | Serves they couldn't return |
| `putaway` | Hard put-away shots |
| `passing` | Shots past your opponent |
| `lob` | Lobs over your opponent |
| `drop_winner` | Soft drops they couldn't reach |
| `dink_winner` | Soft shots at the net |
| `other_winner` | Other winning shots |
| `out` | Hitting out |
| `net` | Hitting into the net |
| `dink_error` | Missed soft shots at the net |
| `kitchen` | Stepping into the no-volley zone |
| `service` | Missed serves |
| `foot_fault` | Stepping over the line on serve |
| `two_bounce` | Hitting before the bounce |
| `net_touch` | Touching the net |
| `hit_by_ball` | Getting hit by the ball |
| `wrong_position` | Wrong server or receiver |
| `other_fault` | Other mistakes |

Sentence shapes: "{gained[0]} earned you the most." and
"{cost[0]} cost you the most."

## Part 4: Testing

1. **Rule checks** — `server/scripts/check-rally-rating.mjs` (pure, no
   database): start at 1,500; winner gains, fault loses; 3/4 and 1/4 split on
   the acting side, even split on the other; singles all to one player;
   weights applied, and every ending has one; an upset moves more than an
   expected win; voided and unfinished matches and rallies after game point
   ignored; rallies without a detail weigh 1; third shots ignored; total
   change per rally is zero; replay is deterministic regardless of input
   order; `byEnding`, `trend` and `recentChange` correct on a hand-built
   history; the 5-match floor.
2. **Prediction bar** — the existing check (earlier 80 matches build, later 35
   predict), extended with the rally rating. `K` and `S` are chosen on the
   earlier matches only (a small grid, picking the best at predicting the
   last matches within the earlier set). The rally rating must predict at
   least as well as the current skill score's 72% on the same test matches.
   Report accuracy with its 95% range, and the Brier score (how close each
   predicted chance was to what happened) for both.
3. **Known true skill** — regenerate staging's synthetic pool so each seeded
   player's hidden ability is recorded and every rally carries an ending
   chosen consistently with ability and style. Report how closely each rating
   orders players by true ability (Spearman), for the rally rating and the old
   score. Staging only; real sessions (for example "Thesis") are untouched.
   The seeding goes through the API with an umpire session rather than a
   direct database connection, and the hidden abilities are written to a local
   file next to the script, not to the database.
4. **Player app** — screenshots of the card and step 1 across staging players:
   not yet rated, rising, falling, level, few rallies with endings, many; phone
   width, light and dark.
5. **Staging only** until the owner has reviewed it.
6. **What it would change in the thesis pipeline** — measurement only: run
   the unchanged pipeline on staging's match logs twice, once with the old
   `skill_score` and once with rally points in its place, and count how many
   players' skill group name and playstyle would differ. The owner decides
   afterwards whether the pipeline should ever use the rally rating; nothing
   is switched by this project.

## Out of scope

- Any change to the ML pipeline, K-Means, or the old `skill_score`.
- The match page's expectation line.
- Showing per-match rating changes.
- Separate singles and doubles ratings.
- Fitting ending weights from data (revisit after real matches with endings).
