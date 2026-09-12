# Ideas: more of the ML pipeline, in the player app

Notes from a conversation, not a backlog. It is written down because
working it out again from scratch would cost more than reading it.

**Ideas 1, 2, 3, 4 and 6 have since landed.** What that took, and the
things this document had wrong, is at the bottom.

## The framing

The ML pipeline (`~/skul/PaddlePad`) computes **ten numbers per player**.
Five describe how someone plays — winning shots, mistakes, mistakes at
the net, how often their third-shot drop lands, and how aggressively they
play. Five more describe how much each of those **swings from game to
game**.

The player app shows three things: a score, a tier, and a playstyle word.

So roughly nine-tenths of what the model knows never reaches the person
it is about. Most of what follows is opening that box rather than
computing anything new, which is why the list is longer than the work.

## The ideas

**1. What is actually moving your rating.** *(landed)* Take the two
features where a player sits furthest from the average of others at
their level — one
good, one bad — and say them plainly: *"Your drops land more often than
most players around you. Your unforced mistakes are the thing holding
the number down."* A score nobody can act on is a horoscope. This turns
it into a coaching note. Needs the pipeline to send the per-feature
comparison alongside the score.

**2. Your ceiling and your floor.** *(landed)* Half the model is about consistency —
the five "how much do you swing" numbers — and none of it is visible.
*"On your best day you play like a 74, on your worst like a 41"* is a
genuinely interesting sentence, and it is the half most rating systems
cannot say at all because they only ever store one number.

**3. What separates you from the next group up.** *(landed)* The
clustering already knows where each skill group sits. Compare a player's
ten numbers against
the group above and name the biggest gap: *"It isn't your winners — it's
that your third-shot drop lands 40% of the time and theirs lands 65%."*
This is the most useful thing a skill model can tell an amateur, and it
is mostly arithmetic over numbers that already exist.

**4. Was that an upset?** *(landed)* With scores for all four players, the model can
say what it expected before the match started, so a finished match can
carry *"you were expected to lose this one"*. Beating someone stronger
should feel different from beating someone weaker; today a win is a win.

**5. Drop or drive — which actually works for you.** This app records the
third shot separately from how the rally ended, which is unusual. So it
can answer: *"When you drop, you go on to win the rally 58% of the time.
When you drive, 41%."* No model needed — this one is pure event log.

**6. Playstyle, with its reasons.** *(landed)* The archetype is
currently a bare label. Two lines of evidence under it — *"you dink more
than most, and
you take fewer risks off the bounce"* — is the difference between a label
people believe and one they shrug at.

**7. Partner fit, done fairly.** The People screen already counts wins
with each partner. The model's version weights them by who the pair was
up against, so a 50% record against strong opponents stops looking worse
than 70% against weak ones. Note the privacy line the app draws: using
other players' scores to adjust *your* number is fine, showing them is
not.

## Where each one lands

**Not a fifth tab.** The app has four (Overview, Matches, People, You), a
phone's bottom bar frays at five, and a tab is a promise of frequent
return traffic that a "why is my rating this" page will never earn. The
ideas split along homes that already exist:

| Idea | Home |
| --- | --- |
| 1, 2, 3, 6 — depth on the rating | A new drill-down page, reached by tapping the rating card on Overview |
| 4 — was that an upset | Match detail; it is a fact about one game, not about a player |
| 7 — partner fit | People, where the partner records already are |
| 5 — drop or drive | The orphan. No obvious existing home, and the only one needing no ML |

That shape is one new screen plus three small additions to screens that
exist — which is also why none of it has to happen at once. The rating
page can land alone and the rest can follow whenever.

## Three things not to forget

**A small pool makes all of this wobbly.** Percentiles and clusters need
bodies. The five-match gate exists for exactly this reason, and anything
new here needs its own honest version of it rather than quietly showing a
number computed from four people.

**These numbers move when other people play.** The skill score is
relative to the pool, so anything derived from it inherits that, and
needs the same "as of 24 August, against 46 players" framing the ratings
already carry. A player who drops four points without touching a paddle
deserves an explanation that exists.

**Singles and doubles counts are not comparable.** A raw per-player count
means something different in a format with half the players on court.
Anything per-format stays per-format, or becomes a ratio.

## What 1 and 3 turned out to be

This document said they shared "a single pipeline change: send the
per-feature comparison, not just the final score", and guessed the work
was mostly arithmetic over ten numbers that already existed. Both halves
of that were wrong, and in a useful direction.

**The rating is not made of ten numbers. It is made of four.** The
skill score is a weighted sum of drop shots landing (25%), winning shots
(30%), mistakes away from the net (20%) and mistakes at the net (25%),
and nothing else. The other six features decide which GROUP and which
PLAYSTYLE a player lands in; they never move the number. So "what is
moving your rating" is not a correlation or a ranking of z-scores — it
is the score's own arithmetic, split back into its four terms, and the
four add up to the rating exactly.

**Three of those four were not being stored.** `evidence` holds the
playstyle features, which overlap the scoring features in exactly one
place (drop efficiency). So the pipeline change was real, just a
different one: publish the four parts with each player's own value and
the points it contributed, in a `score_parts` column of its own. The
pipeline now refuses to publish a run whose four parts do not add up to
the score it is publishing — if the scoring ever gains a fifth term and
the breakdown does not, the app would otherwise go on confidently
explaining a number it no longer describes.

Everything else followed from having the four numbers: idea 1 is those
four against the average of the player's own group, idea 3 is the same
four against the group one rung up the ladder. Same privacy line as the
playstyle proof — averages only, and a group of fewer than three is
never averaged at all.

**The one thing left rough.** Groups are named on the page by the range
of ratings they cover, and those ranges overlap: staging currently shows
"Ratings 28–49" and "Ratings 37–91". The clustering groups on ten
features, not on the score, so a player rated 40 can honestly be in
either. The ladder's order is still right — it sorts by lowest rating
and, checked against the group averages, agrees with them — but "what
separates you from Ratings 37–91" reads oddly to someone rated 45. The
naming, not the comparison, is what needs rethinking.

## What 2 and 4 turned out to be

**Idea 2 is better than the document imagined, and the reason is a
coincidence of arithmetic.** Min-max scaling and a weighted sum are both
affine, which means the average of a player's per-game scores is exactly
their rating — not close to it, equal to it. So the page does not say
"on your best day you play like a 74". It says: your rating IS the
average of these nine games, here they are. The pipeline refuses to
publish a run where that stops being true, which also catches the
per-match arithmetic drifting away from the pipeline's own.

Best-and-worst turned out to be the wrong headline. The median gap
between a player's best and worst game on the staging pool is **40
points** — a best game is one game, and one game is mostly luck. The
middle half is the honest answer to "how well do I play", with the
extremes shown beside it, named as extremes.

Two surprises worth keeping. Single games regularly score **outside
0–100**: the scale's ceiling is the best player's season average, so a
strong player's good game beats it — the top player had three games over
100 and a best of 113, and the weakest had one at −6. The strip is drawn
over each player's own range rather than a fixed 0–100 for exactly that
reason, and the page explains the overflow rather than hiding it.

**Idea 4 needed checking before it was worth building, and it survived
the check.** Over every completed match with a rating run before it —
60 of them — the higher-rated side won 68%, and it graded properly:
near-level matches were a coin flip, gaps over 10 points won 8 or 9
times in 10. So the claim has something behind it.

Two rules shape it. The expectation is read from the newest run that
finished BEFORE the match, never the current one, which has already seen
the result. And no figure about anybody leaves the server: in doubles a
team average is two people, one of them the reader, so publishing a gap
would hand over their partner's rating by subtraction. A verdict in
words gives the player the thing worth having and nobody else's number.

Half the staging matches get no verdict at all, because somebody on
court was unrated at the time. They show nothing rather than a hedge.

## Still not started

Ideas **5** (drop or drive) and **7** (partner fit). Idea 5 is the only
one left that needs no model at all — it reads straight from the event
log, so it is the one that would work the moment real matches exist.
