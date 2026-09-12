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
 * What to call a group: the scores it covers.
 *
 * Not "Middle of three" or "Higher scores", both of which were read
 * twice before they made sense -- middle of WHAT, higher THAN what. A
 * group is a band of ratings, so the band is its name and there is
 * nothing left to interpret. The word is "rating" throughout, because
 * that is what the app calls this number everywhere else; "score" here
 * and "rating" in the title was the same thing under two names. The model's own label for it is inside
 * "Why groups?", for anyone who wants it.
 */
function groupName(group) {
  return `Ratings ${group.lowest}–${group.highest}`
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
    </Step>
  )
}

/** Step 2: the first split, and what it is for. */
function Group({ standing }) {
  const groups = standing.groups ?? []
  const mine = groups.findIndex((group) => group.name === standing.band?.name)

  return (
    <Step
      number={2}
      title="Your group"
      value={mine === -1 ? 'Not grouped yet' : groupName(groups[mine])}
    >
      {groups.length > 0 && (
        <ol className="ladder" aria-label="The groups, lowest ratings first">
          {groups.map((group, i) => (
            <li key={group.name} className={i === mine ? 'is-you' : undefined}>
              <span className="ladder-name">
                {i === mine && <Icon name="chevron" size={13} />}
                {groupName(group)}
              </span>
              <span className="ladder-size">
                {group.size} {group.size === 1 ? 'player' : 'players'}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="step-line">
        Everyone rated is split into a few groups by results first, and
        these are the ratings each group covers.
      </p>

      <More label="Why groups?">
        <p>
          So that a playstyle means something. Styles are worked out
          <em> within</em> a group, so &ldquo;steady&rdquo; means steady for
          players at this level rather than steady compared with everyone. It
          is also why the name below starts with your group&rsquo;s own word.
        </p>
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
