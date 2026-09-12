// ============================================================
// Your rating: the three things the model actually did.
//
// This page used to show a score, a spread, and a "group" named in
// words of the app's own invention, with no hint of what the group was
// for -- while the playstyle, the interesting half, sat on the overview
// as a bare label. It read as unrelated to the pipeline it came from.
//
// So it now follows the pipeline, in order:
//
//   1  a skill score, 0-100, measured against everyone rated
//   2  a first split into groups, by results
//   3  a second split inside each group, by how people play
//
// Step 2 exists FOR step 3: playstyles are clustered within a group, so
// a style means "compared with players at a similar level". That is why
// the archetype name begins with the group's own word. Saying so is the
// difference between a label and an explanation.
//
// Step 3 also has to be checkable, so it shows, for each word in the
// name, this player's own number, their group's average, and the
// average of the other style in their group -- the players the
// clustering separated them from. Nobody's individual numbers but their
// own; see server/src/playstyle.js.
//
// Steps 1 and 2 each answer one more question, from the same arithmetic:
//
//   under the score   what is moving MY number -- the four measurements
//                     it is a weighted sum of, against the average of
//                     players at my level
//   under the ladder  what separates me from the group above -- the
//                     same four, against the rung up
//
// Neither is a guess about what correlates with a rating. The score IS
// those four parts added up, and the pipeline refuses to publish a run
// where they do not add up to it. See server/src/rating-parts.js.
//
// It never shows a ranking and never anyone else's score. Why is one
// tap away at the bottom.
// ============================================================

import { useEffect, useState } from 'react'
import { fetchStanding } from '../lib/api'
import { usePlayerData } from '../lib/PlayerData'
import { useCountUp } from '../lib/motion'
import { navigate } from '../lib/router'
import Distribution from '../components/Distribution'
import Icon from '../components/Icon'
import More from '../components/More'

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

/**
 * Each measurement in everyday words, with how to read its number.
 *
 * The feature names belong to the model; a player should never meet
 * `winner_rate_std`. "Swing" is how the spread features are said here:
 * they measure how much something moves from game to game.
 */
const MEASURES = {
  aggression_mean: { label: 'going for winners', as: 'percent', better: 'neither' },
  drop_efficiency_mean: { label: 'drop shots landing', as: 'percent', better: 'higher' },
  error_to_winner_ratio: { label: 'mistakes per winning shot', as: 'ratio', better: 'lower' },
  aggression_std: { label: 'aggression swing', as: 'swing', better: 'neither' },
  drop_efficiency_std: { label: 'drop success swing', as: 'swing', better: 'neither' },
  winner_rate_std: { label: 'scoring swing', as: 'swing', better: 'neither' },
  general_error_rate_std: { label: 'mistake swing', as: 'swing', better: 'neither' },
  dink_error_rate_std: { label: 'net mistake swing', as: 'swing', better: 'neither' },
  drop_usage_rate: { label: 'third shots that are drops', as: 'percent', better: 'neither' },
  drop_preference_rate_mean: { label: 'drops rather than drives', as: 'percent', better: 'neither' },
  drop_preference_rate_std: { label: 'drop choice swing', as: 'swing', better: 'neither' },
  net_game_preference_rate_mean: { label: 'points won at the net', as: 'percent', better: 'neither' },
  net_game_preference_rate_std: { label: 'net play swing', as: 'swing', better: 'neither' },
}

// Said only where there IS a direction. Most of these measurements are
// style rather than quality -- the model works playstyles out
// separately from the rating, so "steady" is not a better way to play
// than "streaky" -- and a row that announced "neither is better" said
// nothing while taking up the space of something that did.
const DIRECTION = {
  higher: 'higher is better',
  lower: 'lower is better',
}

/**
 * How this player compares, in words, because the bars alone say "not
 * the same" without saying how much.
 */
function compare(you, them) {
  if (!Number.isFinite(you) || !Number.isFinite(them) || them === 0) return null
  const ratio = you / them
  if (ratio < 0.45) return 'much less than'
  if (ratio < 0.8) return 'less than'
  if (ratio > 2.2) return 'much more than'
  if (ratio > 1.25) return 'more than'
  return 'about the same as'
}

function showValue(value, as) {
  if (value === null || value === undefined) return '—'
  if (as === 'percent') return `${Math.round(value * 100)}%`
  if (as === 'ratio') return value.toFixed(2)
  return `±${value.toFixed(2)}`
}

/**
 * One of the four measurements behind the rating, in its own units.
 *
 * Two of them are per-MINUTE rates, which are real and unreadable at
 * that scale: "0.28 winning shots a minute" is not a number anyone
 * holds in their head. Ten minutes is roughly a game, which is a length
 * people already think in, so that is what they are shown in.
 */
function partValue(value, unit) {
  if (value === null || value === undefined) return '—'
  if (unit === 'proportion') return `${Math.round(value * 100)}%`
  if (unit === 'per_minute') return `${(value * 10).toFixed(1)} per 10 min`
  return value.toFixed(2)
}

/**
 * Which part gains the most on a comparison group, and which loses the
 * most to it.
 *
 * Measured in POINTS rather than in the measurements themselves, which
 * is what makes the two comparable at all: a drop rate and a mistake
 * rate are different quantities pointing in opposite directions, but
 * the points each contributed to the score are the same currency, and
 * already carry the direction (the model subtracts mistakes rather than
 * adding them). So "6 points more" and "5 points less" can be read
 * beside each other without anybody being misled.
 *
 * Either can be null: a player above their group on all four parts has
 * nothing dragging the number down, and saying otherwise would be
 * false. Those cases are said differently rather than forced.
 */
function gainsAndLosses(parts, which) {
  let best = null
  let worst = null
  for (const part of parts) {
    const them = part[which]
    if (!them || !Number.isFinite(them.points)) continue
    const diff = part.you.points - them.points
    if (diff > 0 && (!best || diff > best.diff)) best = { part, diff }
    if (diff < 0 && (!worst || diff < worst.diff)) worst = { part, diff }
  }
  return { best, worst }
}

/**
 * Points read as whole numbers where they are whole.
 *
 * Only the next-group section still shows points. There they sit inside
 * a sentence that says what they are -- "that one part is 9 points of
 * the difference" -- rather than standing alone as a label, which is
 * what made "19.9 of 30" unreadable at a glance.
 */
function points(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * What to call a group: where it sits relative to the reader.
 *
 * FOUR namings were tried before this one, and every one of them was a
 * number. Keeping why each failed, because between them they rule out
 * the whole family.
 *
 * "Middle of three" and "Higher scores" were read twice before they
 * made sense -- middle of WHAT, higher THAN what.
 *
 * "Ratings 28-49" beside "Ratings 37-91" overlapped, so a player rated
 * 45 found their own number inside the name of a group they were not
 * in. The overlap is real rather than a slip: groups are not slices of
 * the rating scale, because the clustering sorts on ten measurements
 * while the rating is a sum of four of them.
 *
 * "Around 43" cannot overlap, but a rating describes position poorly.
 * skill_score is min-max scaled and players are not spread evenly along
 * it -- on the pool this was written against, 26 of 46 sat between 40
 * and 59.
 *
 * "70th percentile" fixed that and broke two other things. It needs a
 * line of explanation before it means anything, and it sits beside the
 * rating in step 1 looking like the same unit while being a different
 * one: nine of those 46 players were 20+ points from their own group's
 * percentile, one rated 37 while personally at the 7th in a group
 * called "70th". Worse, a percentile exaggerates where it matters most
 * -- 27 of 45 neighbouring pairs were under one rating point apart, and
 * in the crowded middle a single rating point moved a player 6.5
 * percentile places. It manufactures gaps between players the model
 * considers tied.
 *
 * So: no number. A rung says where it sits beside YOURS, which is the
 * only thing a reader needs from it and the only version that needs no
 * legend. It also survives the clustering changing its mind about how
 * many groups there are -- 2 at 46 players, 3 at 12, and up to 5 -- at
 * which point the pipeline's own labels degrade to "Performance Group
 * 4" and mean nothing to anybody.
 *
 * The percentile is not lost; it moves into "Why groups?" with the
 * model's own label, where a reader who wants it will look.
 */
const STEPS = ['', 'A step', 'Two steps', 'Three steps', 'Four steps']

function labelFor(index, mine) {
  // No reference point, so "a step up" has nothing to be a step from.
  if (mine === -1) return `Group ${index + 1}`
  if (index === mine) return 'Your group'
  const distance = Math.abs(index - mine)
  const direction = index > mine ? 'up' : 'down'
  const size = STEPS[distance] ?? `${distance} steps`
  return `${size} ${direction}`
}

function Step({ number, title, value, children }) {
  return (
    <section className="step rise" style={{ '--i': number }} aria-label={title}>
      <div className="step-head">
        <span className="step-n" aria-hidden="true">{number}</span>
        <h2>{title}</h2>
      </div>
      {value && <p className="step-value">{value}</p>}
      {children}
    </section>
  )
}

function BackLink() {
  return (
    <button
      type="button"
      className="back-link"
      onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))}
    >
      &larr; Back
    </button>
  )
}

/**
 * What the number is made of, under the number.
 *
 * A rating nobody can act on is a horoscope. These four are the whole
 * of it -- the score is their sum, not a model of them -- so naming the
 * one earning the most and the one costing the most turns a verdict
 * into something to work on.
 *
 * The bar is the share of that part's own points earned, and the tick
 * is the average for players at this level. Both matter: the bar says
 * how much is left on the table, the tick says whether that is unusual.
 */
function Parts({ parts }) {
  const { best, worst } = gainsAndLosses(parts.parts, 'group')
  const compared = parts.groupAveraged

  // Every bar is drawn against the biggest gap of the four, so the four
  // rows can be read against each other: the longest arm is the thing
  // most worth doing something about.
  const widest = Math.max(
    ...parts.parts.map((part) =>
      part.group ? Math.abs(part.you.points - part.group.points) : 0),
    0.0001,
  )

  return (
    <div className="parts">
      <p className="step-line">
        Four things are added up to make it, and nothing else is.
      </p>

      <ul className="parts-list" aria-label="What the rating is made of">
        {parts.parts.map((part) => {
          // How far this part sits from the player's level, in POINTS
          // -- which is the only unit the four can be compared in, and
          // which already carries the direction: the model subtracts
          // mistakes rather than adding them, so "ahead" is ahead on
          // every row, including the ones where fewer is better. The
          // number itself is never shown; it only sets the bar.
          const diff = part.group ? part.you.points - part.group.points : null
          const reach = diff === null ? 0 : Math.min(1, Math.abs(diff) / widest)

          return (
            <li key={part.key} className="part">
              <div className="part-head">
                <span className="part-label">{part.label}</span>
                <span className="part-values">
                  {partValue(part.you.value, part.unit)}
                  {part.group && (
                    <span className="part-theirs">
                      {' '}· level {partValue(part.group.value, part.unit)}
                    </span>
                  )}
                </span>
              </div>

              {diff !== null && (
                <span
                  className="part-scale"
                  role="img"
                  aria-label={
                    diff === 0
                      ? 'level with players at your level'
                      : `${diff > 0 ? 'ahead of' : 'behind'} players at your level`
                  }
                >
                  <span className="part-axis" />
                  <span
                    className={`part-arm ${diff < 0 ? 'is-behind' : 'is-ahead'}`}
                    style={{ width: `${reach * 50}%` }}
                  />
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {compared && (
        <p className="step-line">
          {best
            ? `You gain most on players at your level in ${best.part.label}.`
            : 'No part of your rating is ahead of the average for your level yet.'}
          {' '}
          {worst
            ? `You lose most in ${worst.part.label}.`
            : 'Every part of it is at or above that average.'}
        </p>
      )}

      <More label="How much does each one count?">
        <p>
          Not equally. Out of the 100, winning shots are worth 30, drop shots
          landing 25, mistakes at the net 25, and mistakes away from the net
          20. That split is the model&rsquo;s, not the app&rsquo;s — and it is
          why the bars above are drawn from how much each gap moves your
          rating rather than from the measurements themselves.
        </p>
        <p>
          Full marks on one of them means <em>best of everyone rated</em>,
          not perfect — each part is measured from the highest and lowest in
          the pool. So these move when other people play, the same way the
          rating does.
        </p>
        {!compared && (
          <p>
            Your group is too small to average without describing one
            person, so there is nothing to compare yours against yet. It
            needs three rated players.
          </p>
        )}
        <p>
          A mistake at the net and a mistake anywhere else are counted
          separately, and never both.
        </p>
      </More>
    </div>
  )
}

/**
 * The games the rating is the average of.
 *
 * Half the model is about how much someone swings between games, and
 * none of it ever reached the player, because the model says it as
 * "your winner rate varies by 1.20". Said as scored games it needs no
 * translating: a 43 beside a 94 is the same fact, legible.
 *
 * The headline is the MIDDLE HALF rather than best and worst. On the
 * pool this was built against the gap between a player's best and
 * worst game had a median of 40 points -- a best game is one game, and
 * one game is mostly luck. The extremes are still shown, named as what
 * they are.
 */
function Games({ games }) {
  // Held inside 0-100, for the reader's sake rather than the model's.
  //
  // A single game is scored against everyone's season AVERAGE, so a
  // good player's good game genuinely beats the top of the scale --
  // the strongest player on the pool this was built against had three
  // games over 100 and a best of 113, and the weakest had one at -6.
  // Those are real numbers, and "you played like a 112" still reads as
  // a bug to anyone holding a rating out of 100. So the ends are
  // clipped and the tap below says what was clipped and why.
  //
  // The scores themselves are stored uncapped, because the claim this
  // whole section rests on -- that a rating IS the average of these --
  // only holds on the real ones. Nothing here recomputes it.
  const shown = (score) => Math.max(0, Math.min(100, score))

  // The strip still spans this player's own games rather than a fixed
  // 0-100: it answers "how much do you swing", not "where do you sit",
  // which the bars higher up the page already answer.
  const low = Math.min(shown(games.worst), shown(games.rating))
  const high = Math.max(shown(games.best), shown(games.rating))
  const span = high - low || 1
  const place = (score) => ((shown(score) - low) / span) * 100

  return (
    <div className="games">
      <h3 className="games-head">The games behind it</h3>
      <p className="step-line">
        Your rating is the average of your {games.count} games — not a summary
        of them, the middle. Most land between{' '}
        <strong>{Math.round(shown(games.lower))}</strong> and{' '}
        <strong>{Math.round(shown(games.upper))}</strong>.
      </p>

      <div className="games-strip" role="img"
           aria-label={`${games.count} games, from ${Math.round(shown(games.worst))} to ${Math.round(shown(games.best))}, averaging ${Math.round(shown(games.average))}`}>
        {/* The middle half, drawn as the band the dots mostly sit in. */}
        <span
          className="games-band"
          style={{
            left: `${place(games.lower)}%`,
            width: `${place(games.upper) - place(games.lower)}%`,
          }}
        />
        {games.games.map((game) => (
          <span
            key={game.matchId}
            className="games-dot"
            style={{ left: `${place(game.score)}%` }}
          />
        ))}
        <span className="games-mark" style={{ left: `${place(games.rating)}%` }} />
      </div>
      <ul className="games-scale" aria-hidden="true">
        <li>{Math.round(shown(games.worst))}</li>
        <li>{Math.round(shown(games.best))}</li>
      </ul>

      <p className="games-ends">
        Worst <strong>{Math.round(shown(games.worst))}</strong>
        <span className="games-sep">·</span>
        Rating <strong>{Math.round(shown(games.rating))}</strong>
        <span className="games-sep">·</span>
        Best <strong>{Math.round(shown(games.best))}</strong>
      </p>

      <More label="Why is the spread so wide?">
        <p>
          Because one game is a small sample. A short game where three shots
          fall your way scores very differently from a long one where they
          don&rsquo;t, and neither is a fair picture of how you play. The
          average of all of them is, which is what your rating is.
        </p>
        <p>
          It is also the half of the model nothing else shows. Five of the ten
          things it measures are about how much you swing between games rather
          than how well you play — this is that, in a form you can read.
        </p>
        {games.outsideScale > 0 && (
          <p>
            {games.outsideScale === 1
              ? 'One of these games ran past the end of the scale and is shown'
              : `${games.outsideScale} of these games ran past the ends of the scale and are shown`}{' '}
            at 0 or 100. The scale is built from everyone&rsquo;s{' '}
            <em>average</em>, so one exceptional game can be better than the
            best average there is — there is simply nowhere left on the scale
            to put it.
          </p>
        )}
      </More>
    </div>
  )
}

/**
 * What separates this player from the rung above -- idea 3, and the
 * most useful thing a skill model can tell an amateur.
 *
 * The biggest gap by itself, because four gaps is a table and one gap
 * is a thing to go and practise. The rest sit behind the tap for
 * anyone who wants to check that the biggest really is the biggest.
 */
function NextGroup({ parts }) {
  const { worst } = gainsAndLosses(parts.parts, 'above')
  if (!worst) return null

  return (
    <div className="next-group">
      <h3 className="next-head">What separates you from the next group up</h3>
      <p className="step-line">
        The biggest single gap is <strong>{worst.part.label}</strong>: theirs
        averages {partValue(worst.part.above.value, worst.part.unit)}, yours is{' '}
        {partValue(worst.part.you.value, worst.part.unit)}. That one part is{' '}
        {points(Math.abs(worst.diff))} points of the difference.
      </p>

      <More label="The other three">
        <ul className="proof-figures">
          {parts.parts
            .filter((part) => part.key !== worst.part.key && part.above)
            .map((part) => {
              const diff = part.you.points - part.above.points
              return (
                <li key={part.key}>
                  <strong>{part.label}</strong>: theirs{' '}
                  {partValue(part.above.value, part.unit)}, yours{' '}
                  {partValue(part.you.value, part.unit)} —{' '}
                  {diff >= 0
                    ? `${points(diff)} points ahead of them`
                    : `${points(Math.abs(diff))} points behind`}
                  .
                </li>
              )
            })}
        </ul>
        <p>
          Averages of that group, never anyone&rsquo;s own numbers. A group
          of fewer than three is never averaged at all.
        </p>
      </More>
    </div>
  )
}

/** Step 1: the score, and where it sits among everyone rated. */
function Score({ rating, standing }) {
  const shown = useCountUp(rating.skillScore)
  const others = standing.poolSize - 1

  return (
    <Step
      number={1}
      title="Your rating"
      value={
        <span aria-label={`${rating.skillScore} out of 100`}>
          {shown}
          <span className="step-outof"> / 100</span>
        </span>
      }
    >
      <ul className="ichips" aria-label="What this rests on">
        <li className="ichip">
          <Icon name="people" size={15} />
          <span>{standing.poolSize} rated</span>
        </li>
        <li className="ichip">
          <Icon name="calendar" size={15} />
          <span>{formatDate(standing.computedAt)}</span>
        </li>
      </ul>

      {standing.distribution && <Distribution buckets={standing.distribution} />}

      <p className="step-line">
        {others === 0
          ? 'You are the only rated player so far.'
          : `Your rating is higher than ${standing.below} of the ${others} other rated players.`}
      </p>

      {/* Null for a run published before the pipeline sent the
          breakdown. Nothing is said about it: the score above is still
          true, and an apology for a missing panel is worse than the
          panel simply not being there. */}
      {standing.parts && <Parts parts={standing.parts} />}

      {/* Null for an older run, or for a player with too few games for
          a spread to describe a habit rather than a fortnight. */}
      {standing.games && <Games games={standing.games} />}
    </Step>
  )
}

/** Step 2: the first split, and what it is for. */
function Group({ standing }) {
  const groups = standing.groups ?? []
  const mine = groups.findIndex((group) => group.name === standing.band?.name)
  const above = mine === -1 ? null : (groups[mine + 1] ?? null)

  return (
    <Step
      number={2}
      title="Your group"
      value={
        mine === -1
          ? 'Not grouped yet'
          : `${groups[mine].size} ${groups[mine].size === 1 ? 'player' : 'players'} at your level`
      }
    >
      {groups.length > 0 && (
        <ol className="ladder" aria-label="The groups, lowest ratings first">
          {groups.map((group, i) => (
            <li key={group.name} className={i === mine ? 'is-you' : undefined}>
              <span className="ladder-name">
                {i === mine && <Icon name="chevron" size={13} />}
                {labelFor(i, mine)}
              </span>
              <span className="ladder-size">
                {group.size} {group.size === 1 ? 'player' : 'players'}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="step-line">
        Everyone rated is split into a few groups first. Which one you land in
        is worked out from ten measurements, not just your rating — so your own
        number can sit some way from the rest of your group.
      </p>

      {/* The rung above, named from the ladder rather than from
          anything the server sends -- so it keeps working whatever
          number of groups the clustering settles on. Nothing at all
          when there is no group above, which is a fact worth reading
          on its own. */}
      {standing.parts && above && <NextGroup parts={standing.parts} />}
      {standing.parts && mine !== -1 && !above && (
        <p className="step-line">There is no group above yours.</p>
      )}

      <More label="Why groups?">
        <p>
          So that a playstyle means something. Styles are worked out
          <em> within</em> a group, so &ldquo;steady&rdquo; means steady for
          players at this level rather than steady compared with everyone. It
          is also why the name below starts with your group&rsquo;s own word.
        </p>
        {/* The numbers the rungs used to be named after. Real, and
            worth having, but they made a reader decode a label before
            it meant anything -- so they live down here now, where
            somebody who wants them will look. */}
        {mine !== -1 && Number.isFinite(groups[mine].percentile) && (
          <p>
            Your group&rsquo;s middle sits higher than{' '}
            <strong>{groups[mine].percentile}%</strong> of everyone rated, and
            covers ratings {groups[mine].lowest}–{groups[mine].highest}. Those
            ranges overlap between groups, which is the same thing said another
            way: the rating is not what decides the group.
          </p>
        )}
        {standing.band?.name && (
          <p>
            The model&rsquo;s own name for your group is{' '}
            <strong>{standing.band.name}</strong>.
          </p>
        )}
      </More>
    </Step>
  )
}

/** Step 3: the second split, with the numbers that chose its words. */
function Playstyle({ standing }) {
  const { playstyleArchetype: name, playstyle: proof, band } = standing

  if (!name) {
    return (
      <Step number={3} title="Your playstyle" value="Not worked out yet">
        <p className="step-line">
          A group needs at least three rated players before the styles inside it
          are worked out. Yours has {band?.size ?? 1}.
        </p>
      </Step>
    )
  }

  if (!proof) {
    return (
      <Step number={3} title="Your playstyle" value={name}>
        <p className="step-line">
          This name comes from where your style sits against your group&rsquo;s
          average. The measurements behind it weren&rsquo;t recorded for this
          run, so there is nothing to show beside it yet.
        </p>
      </Step>
    )
  }

  return (
    <Step number={3} title="Your playstyle" value={name}>
      <p className="step-line">
        One of {proof.styleSize} in this style
        {band?.size ? `, out of ${band.size} in your group` : ''}.
      </p>

      <ul className="proof" aria-label="Why this name">
        {proof.rows.map((row) => {
          const measure = MEASURES[row.feature] ?? {
            label: row.feature, as: 'swing', better: 'neither',
          }
          const bars = [
            { who: 'you', value: row.you, mine: true },
            { who: 'your group', value: row.group },
            ...(proof.other ? [{ who: 'the other style', value: row.other }] : []),
          ]
          // Bars are drawn against the biggest of the three, so a row is
          // read by comparing its own bars and nothing else.
          const widest = Math.max(...bars.map((b) => Math.abs(b.value ?? 0)), 0.0001)
          const verdict = compare(row.you, row.group)
          const versus = proof.other ? compare(row.you, row.other) : null

          return (
            <li key={row.feature} className="proof-row">
              <div className="proof-head">
                <span className="proof-word">{row.label}</span>
                <span className="proof-measure">{measure.label}</span>
                {DIRECTION[measure.better] && (
                  <span className="proof-better">{DIRECTION[measure.better]}</span>
                )}
              </div>

              <ul className="proof-bars">
                {bars.map((bar) => (
                  <li key={bar.who} className={bar.mine ? 'is-you' : undefined}>
                    <span className="proof-who">{bar.who}</span>
                    <span className="proof-track">
                      <span
                        className="proof-fill"
                        style={{ width: `${Math.round((Math.abs(bar.value ?? 0) / widest) * 100)}%` }}
                      />
                    </span>
                    {/* A percentage means something on its own, so it is
                        shown. A spread of a per-minute rate does not, so
                        the bars carry it and the figures live behind the
                        tap below. */}
                    <span className="proof-number">
                      {measure.as === 'percent' ? showValue(bar.value, 'percent') : ''}
                    </span>
                  </li>
                ))}
              </ul>

              {verdict && (
                <p className="proof-verdict">
                  Yours is {verdict} your group&rsquo;s
                  {versus ? `, and ${versus} the other style's` : ''}.
                </p>
              )}
            </li>
          )
        })}
      </ul>

      <More label="How this was worked out">
        <p>
          Inside your group, players are grouped again by how they play. The
          words in your name are the measurements where your style sits
          furthest from your group&rsquo;s average
          {proof.other
            ? ' — and the last column is the other style in your group, the players you were separated from.'
            : '.'}
        </p>
        <p>
          Averages only, never anyone&rsquo;s own numbers but yours. A style with
          fewer than three players is never averaged at all.
        </p>
        <ul className="proof-figures">
          {proof.rows.map((row) => {
            const measure = MEASURES[row.feature] ?? { label: row.feature, as: 'swing' }
            return (
              <li key={row.feature}>
                <strong>{measure.label}</strong>
                {measure.as === 'swing' ? ' (how much it moves between games)' : ''}: you{' '}
                {showValue(row.you, measure.as)}, your group{' '}
                {showValue(row.group, measure.as)}
                {proof.other ? `, the other style ${showValue(row.other, measure.as)}` : ''}.
              </li>
            )
          })}
        </ul>
      </More>
    </Step>
  )
}

function Rating() {
  const { rating } = usePlayerData()
  const [standing, setStanding] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchStanding({ signal: controller.signal })
      .then(setStanding)
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err.message)
      })
    return () => controller.abort()
  }, [])

  const rated = standing?.state === 'rated' && rating?.state === 'rated'

  return (
    <div className="standing">
      <BackLink />
      <h1>Your rating</h1>

      {error && <p className="error">{error}</p>}
      {!standing && !error && <p className="muted-inline">Loading…</p>}

      {/* The overview's rating card already explains, in the player's
          own terms, why there is no rating yet. Saying it again here
          would be worse and would drift. */}
      {standing && !rated && (
        <p className="muted-inline">
          There is no rating to compare yet — the card on your overview says
          what it is waiting for.
        </p>
      )}

      {rated && (
        <>
          <Score rating={rating} standing={standing} />
          <Group standing={standing} />
          <Playstyle standing={standing} />

          <More label="Why is there no ranking?">
            <p>
              Your rating is measured against whoever has played, so it can move
              when new people join — even if you haven&rsquo;t played at all. A
              place on a list would claim more than the number can. Where you
              sit, and the group you are in, is what it can honestly tell you.
            </p>
          </More>
        </>
      )}
    </div>
  )
}

export default Rating
