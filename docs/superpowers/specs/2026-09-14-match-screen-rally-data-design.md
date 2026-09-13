# Match screen from rally data: design

Date: 2026-09-14
Status: agreed with the project owner section by section, awaiting spec review

## Why

The player app's match screen still speaks in the old 0–100 skill score, which
players no longer see anywhere else:

- "You played this one like a 72" comes from the nightly pipeline's per-game
  scores.
- "You were expected to win / slight underdogs" reads the old score from the
  newest nightly run before the match.
- "Your shots" splits winning shots only into away from the net and at the net,
  although every rally now records exactly how it ended.

The rally rating already replays every match rally by rally. This design uses
that replay to tell a player, for one match, what it did to their points, how
the rallies they ended actually ended, and who was favoured beforehand.

## Constraints

- A player only ever receives their own numbers. No field may carry another
  player's points, or a side average from which a partner's points could be
  worked out.
- Player-app words are everyday court words ("the kitchen", "winning shots",
  "mistakes"); ending names come from `player/src/lib/endingWords.js`.
- Never compare raw counts across singles and doubles. Everything here is about
  one match at a time.
- No percentiles, places or comparisons with other players.
- The ML pipeline, its K-Means clustering and the nightly job do not change.
- Checks are standalone scripts in `server/scripts/check-*.mjs`; there is no test
  framework. Deploy to staging to verify before production.

## Decisions

| Question | Decision |
|---|---|
| What the screen should add | All three: points from this match, how your rallies ended, and an expectation based on rally points |
| Points change before 5 matches | Hidden until the player is rated, matching the overview card; once rated, every earlier match shows its change |
| Where the numbers are worked out | During the API's existing rally-rating replay, sent inside the match list the app already downloads (approach A) |

## Part 1: What the player sees

Top to bottom on `player/src/screens/MatchDetail.jsx`:

### 1. Header (changed)

Result, score, opponents, partner, date and session stay. The two old-score
lines are removed and replaced by:

- **Points line**: "▲ +8 points in this match" (good colour) or "▼ −5 points in
  this match" (critical colour); "No change in points" for 0. Only when the
  player is rated today.
- **Expectation line**, words only:

  | expected | margin | Sentence |
  |---|---|---|
  | even | – | Evenly matched. |
  | win | slight | You were slight favourites. |
  | win | clear | You were expected to win comfortably. |
  | loss | slight | You were slight underdogs. |
  | loss | clear | You were expected to lose. |

  In singles "favourites/underdogs" read the same; no partner is implied.
  The existing badge stays: **Upset** when an expected loss was won, **Slip**
  when an expected win was lost; never for "even" or a match with no winner.
  The line is absent unless every player on court had 5+ counted matches before
  this match.

### 2. How it went, 3. Point by point

Unchanged.

### 4. How your rallies ended (replaces the away-from / at-the-net bar)

Only rallies this player ended themselves, in two short lists:

- **Won with a shot**: each winning ending with its count, largest first.
- **Lost with a mistake**: each fault with its count, largest first.

Each row: the everyday ending name, a small bar scaled to the largest count in
that list, and the count. Under both lists, one sentence naming the ending that
moved this player's points most in each direction when there is one:
"**Hitting into the net** cost you the most points in this match (−6)." and/or
"**Hard put-away shots** earned you the most (+5)." Points are only mentioned
when the player is rated (same rule as the points line); otherwise the sentence
names the most frequent ending instead, without points.

If some rallies the player ended had no ending recorded: "3 of your rallies had
no ending recorded." If none had one, this section shows today's away-from / at
the net bar instead, unchanged.

The drop-shot meters and the totals chips below stay as they are.

## Part 2: Where the numbers come from

### In the replay (`server/src/rally-rating.js`)

`rateHistory` already walks every counted match in order. For each player in
each match it additionally records, keyed by match id:

- `before`, `after`: the player's raw points either side of the match.
- `endings`: for rallies this player ended with a recorded ending,
  `{ [ending]: { rallies, points } }`, where points is this player's own change
  from those rallies.
- `untagged`: how many rallies this player ended with no ending recorded.
- Expectation inputs: the average raw points of the player's side and of the
  other side before the match's first rally, and whether every player on court
  had at least `MIN_MATCHES` counted matches before this match.

### What the match list sends (`getPlayerMatches`, `GET /player/matches`)

The route loads the cached ratings (`getRallyRatings`) alongside the matches and
attaches, per match, a `rally` object built by a pure function
`rallyMatchFor(ratings, playerId, matchId, won)` in `rally-rating.js`:

```
rally: {
  change: number | null,          // round(after) - round(before); null unless rated today
  expectation: null | {           // null when anyone on court was a newcomer
    expected: 'win' | 'loss' | 'even',
    margin: 'clear' | 'slight' | null,
    upset: boolean,
  },
  endings: [{ ending, outcome: 'winner' | 'error', rallies, points }],
                                  // points: rounded, or null on every row unless rated today
  untagged: number,
}
```

`rally` is `null` for a match the replay did not count.

`outcome` comes from `RALLY_ENDINGS`. `expectation.upset` is true only when
`expected` is not `even` and the match has a winner that went the other way.
`expectation.js` has no other users (only `getPlayerMatches` and the match
screen), so removing it breaks nothing else. Nothing about any other player's points
leaves the server: the side averages are used only to choose the words.

### The expectation bands

The replay's per-rally chance for the player's side,
`expectedWin(yourSideAverage, theirSideAverage)`, is compared with 0.5. Two
constants in `rally-rating.js`, `EVEN_WITHIN` and `CLEAR_BEYOND`, split it into
even / slight / clear. They are set from a one-off script over staging's
completed matches that prints, per band, how many matches fell in it and how
often the favoured side won, aiming for: "clear" favourites win about 4 in 5,
"slight" favourites win more than half, and "even" is close to a coin flip. The
chosen values and the counts behind them are written in a comment beside the
constants, to be retuned once real matches exist.

### Removed

- `expectation` and `ratedAs` from each match in `getPlayerMatches`, with the
  queries they needed (`scoresByRun`, prior-run lookup, `game_scores`).
- `server/src/expectation.js` and its old-score bands, replaced by the bands
  above; `check-expectation.mjs` is rewritten for the new function.
- The `Expectation` component's "You played this one like a…" line.

## Part 3: Edge cases

| Situation | Behaviour |
|---|---|
| Singles | Same rules; expectation compares the two players. |
| No endings recorded in the match | Points change still shows; section 4 falls back to the away-from / at-the-net bar. |
| Some rallies untagged | Lists show the tagged ones, plus "N of your rallies had no ending recorded." |
| Anyone on court had under 5 matches before | No expectation line. |
| Player not rated today | No points change and no points in section 4; lists and counts still show. |
| Match ended with no winner | Change shows; no Upset/Slip badge. |
| Voided match or session | Not in the list, not in the replay. |
| Match edited or voided later | The rally-rating cache is already cleared on every such change. |

## Part 4: Testing

1. `server/scripts/check-rally-rating.mjs`, new section: per-match `after -
   before` values add up to each player's total; each match's own-ending points
   add up to that player's change from the rallies they ended; side averages are
   the points before the match's first rally (a second match's averages reflect
   the first); a newcomer on court makes the expectation null; `change` is null
   for an unrated player; upset is true only against a non-even expectation with
   a result.
2. The one-off band script, run on staging; its output recorded in the commit
   message and the constants' comment.
3. `server/scripts/check-expectation.mjs` rewritten for the rally bands.
4. `server/scripts/smoke.mjs`: `/player/matches` entries carry `rally` with only
   the fields above; no numeric field other than `change`, counts and the
   player's own ending points.
5. Staging screenshots at phone size, light and dark: a doubles match with
   endings, a singles match if one exists, a match with no endings, an upset if
   one exists, and an unrated player (Jan Librando). No page errors.

## Out of scope

- The overview's match list rows (a points change beside each result) — a
  separate request.
- Any change to how points are calculated.
- The umpire app.
