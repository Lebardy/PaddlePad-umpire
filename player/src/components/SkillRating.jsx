// ============================================================
// The ML pipeline's skill score, or an honest account of why there
// isn't one yet.
//
// The dashed "Skill rating -- not enough matches across the club yet"
// box that used to sit on the overview was deleted for two reasons: a
// panel apologising for a missing feature is the loudest way an app
// says it is unfinished, and that one blamed a club concept the player
// could neither see nor influence.
//
// This is not that box coming back. The difference is that every state
// here is about something real and, until the last one, about something
// the player themselves controls. "Two more matches" is progress. "Not
// enough players in the club" is an excuse, and it is only shown once it
// is both true and the only thing left standing between them and a
// score.
// ============================================================

import Meter from './Meter'
import RatingHistory from './RatingHistory'

/**
 * Why five matches, said in the app's own voice.
 *
 * The technical reason is that with fewer, the pipeline's seven
 * consistency features are measuring arithmetic rather than the player
 * -- at one match there is no spread at all, which reads to the model as
 * flawless consistency and is rewarded. None of that is the player's
 * problem, so what they get is the shape of it: a few matches is not
 * enough to tell a good day from a good player.
 */
function NotEnoughMatches({ have, need }) {
  const left = need - have
  return (
    <section className="rating rating-progress" aria-label="Skill rating">
      <h2>Skill rating</h2>
      <Meter
        label={`${have} of ${need} matches`}
        value={have / need}
        caption={left === 1 ? 'One to go.' : `${left} to go.`}
      />
      <p className="muted-inline">
        A couple of matches can&rsquo;t tell a good day from a good player.
      </p>
    </section>
  )
}

/**
 * The player has done their part and is now waiting on the pool.
 *
 * Shown only at this point, and phrased as a count rather than a vague
 * "not yet", because a specific number is a status and a vague one is a
 * brush-off.
 */
function NotEnoughPlayers({ have, need }) {
  return (
    <section className="rating rating-progress" aria-label="Skill rating">
      <h2>Skill rating</h2>
      <Meter label={`${have} of about ${need} players`} value={have / need} caption="" />
      <p className="muted-inline">
        You&rsquo;ve played enough — a rating needs a bigger group to
        compare you against.
      </p>
    </section>
  )
}

/** Qualified since the last run; the next one will include them. */
function Pending() {
  return (
    <section className="rating rating-progress" aria-label="Skill rating">
      <h2>Skill rating</h2>
      <p className="muted-inline">
        You&rsquo;ve played enough — your rating appears tomorrow.
      </p>
    </section>
  )
}

/**
 * The score itself, never without its date and its pool.
 *
 * Those two facts are not decoration. The score is entirely relative to
 * whoever else is playing, so it can move because other people played
 * while this player did nothing. A bare number would make that movement
 * look like a judgement about them; the caption is what makes it
 * legible instead.
 *
 * The Beginner/Intermediate/Professional tier the pipeline also
 * produces is deliberately not shown. Those cutoffs are absolute (40,
 * 75) but the score is relative, so in a small group the top player is
 * labelled "Professional" no matter how they actually play, and telling
 * someone that would be a straightforwardly false claim about them.
 */
function Rated({ rating }) {
  const when = new Date(rating.computedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })

  return (
    <section className="rating rating-scored" aria-label="Skill rating">
      <div className="section-head">
        <h2>Skill rating</h2>
        <span className="chip chip-quiet">{when}</span>
      </div>

      <div className="rating-score">
        <span className="rating-number">{rating.skillScore}</span>
        <span className="rating-outof">/ 100</span>
      </div>

      {rating.playstyleArchetype && (
        <p className="rating-archetype">{rating.playstyleArchetype}</p>
      )}

      <p className="muted-inline">
        Compared with {rating.poolSize} players, from{' '}
        {rating.fromMatches} of your matches.
      </p>

      <RatingHistory history={rating.history} />
    </section>
  )
}

function SkillRating({ rating }) {
  // An older server, or a request that failed quietly, sends nothing.
  // Rendering an empty slot would be the apology box again, so this
  // renders nothing at all.
  if (!rating) return null

  switch (rating.state) {
    case 'rated':
      return <Rated rating={rating} />
    case 'not_enough_matches':
      return <NotEnoughMatches have={rating.have} need={rating.need} />
    case 'not_enough_players':
      return <NotEnoughPlayers have={rating.have} need={rating.need} />
    case 'pending':
      return <Pending />
    default:
      return null
  }
}

export default SkillRating
