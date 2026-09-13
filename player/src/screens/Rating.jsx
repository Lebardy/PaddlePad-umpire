// ============================================================
// Your rating: your own points, then the two things the model did.
//
// This page used to show a score, a spread, and a "group" named in
// words of the app's own invention, with no hint of what the group was
// for -- while the playstyle, the interesting half, sat on the overview
// as a bare label. It read as unrelated to the pipeline it came from.
//
// So it now runs in order:
//
//   1  the player's rally points, and the endings moving them -- worked
//      out rally by rally in the API, and never compared with anyone
//   2  a first split into groups, by results
//   3  a second split inside each group, by how people play
//
// Step 1 used to be the pipeline's 0-100 score, placed among everyone
// rated. That score moved when other people played; points do not. It
// shows whenever the player has five matches, whether or not the
// nightly run has rated them. Steps 2 and 3 still need that run.
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
// Under the ladder, step 2 answers one more question: what separates me
// from the group above -- the four measurements the pipeline's score is
// a weighted sum of, against the rung up. See server/src/rating-parts.js.
//
// It never shows a ranking and never anyone else's score. Why is one
// tap away at the bottom.
// ============================================================

import { useEffect, useState } from 'react'
import { fetchStanding } from '../lib/api'
import { usePlayerData } from '../lib/PlayerData'
import { navigate } from '../lib/router'
import { endingPhrase } from '../lib/endingWords'
import { RallyPointsHeadline } from '../components/RallyRating'
import Icon from '../components/Icon'
import More from '../components/More'

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
  const { rating, rallyRating } = usePlayerData()
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
}

export default Rating
