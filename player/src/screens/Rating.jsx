// ============================================================
// Your rating, and where it puts you in the club.
//
// This is the page behind the rating card on the overview, and it is
// the answer to a request for a leaderboard that deliberately is not
// one. It says where a player sits and which group they are in. It
// never says who is above them, and it never shows anyone else's score.
//
// That is a design choice about competition, but it is also forced by
// the model. The skill score is measured against whoever has played:
// in a club of four, the best of them scores 100 however good they are,
// and anyone's number can move because somebody else played. A ranked
// list would publish those numbers as though they meant more than they
// do. A position in a spread, with a date and the size of the pool
// attached, is the strongest honest thing this score can say.
//
// Fetched on arrival rather than with the rest of the player's data:
// the overview loads on every launch and should not pay for a page most
// visits never open.
// ============================================================

import { useEffect, useState } from 'react'
import { fetchStanding } from '../lib/api'
import { usePlayerData } from '../lib/PlayerData'
import { navigate } from '../lib/router'
import Distribution from '../components/Distribution'

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  })
}

/**
 * The pipeline's group label, in words a player can be told.
 *
 * The pipeline names its groups by how they compare with each other --
 * "Developing / Lower-Performance", "Higher-Performance" -- and it
 * deliberately does not call them Beginner or Advanced, because a
 * group is only ever relative to this club. These keep that: "the
 * strongest group" is a fact about the club, "Advanced" would be a
 * claim about the player that nothing here can back.
 *
 * Anything unrecognised is shown as sent rather than guessed at.
 */
function groupLabel(name, groupCount) {
  if (name.startsWith('Developing')) return 'The developing group'
  if (name === 'Intermediate-Performance') return 'The middle group'
  if (name === 'Higher-Performance') {
    return groupCount === 2 ? 'The stronger group' : 'The strongest group'
  }
  const numbered = name.match(/^Performance Group (\d+)$/)
  if (numbered) return `Group ${numbered[1]} of ${groupCount}`
  return name
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

function WhereYouSit({ standing }) {
  const others = standing.poolSize - 1

  return (
    <section className="standing-section" aria-label="Where you sit">
      <h2>Where you sit</h2>

      {standing.distribution ? (
        <Distribution buckets={standing.distribution} />
      ) : null}

      <p className="standing-sentence">
        {others === 0
          ? 'You are the only rated player so far.'
          : `Your score is higher than ${standing.below} of the ${others} other rated players.`}
      </p>

      {!standing.distribution && others > 0 && (
        <p className="muted-inline standing-note">
          With more players rated, this becomes a picture of the whole club.
        </p>
      )}
    </section>
  )
}

function YourGroup({ band }) {
  const others = band.size - 1
  return (
    <section className="standing-section" aria-label="Your group">
      <h2>Your group</h2>
      <p className="standing-group">{groupLabel(band.name, band.groupCount)}</p>
      <p className="muted-inline">
        {others === 0
          ? 'Just you, for now.'
          : others === 1
            ? 'You and one other player.'
            : `You and ${others} other players.`}{' '}
        The model sorts everyone into a few groups by how they play. Nobody
        in a group is ranked above anyone else in it.
      </p>
    </section>
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

  return (
    <div className="standing">
      <BackLink />
      <h1>Your rating</h1>

      {rating?.state === 'rated' && (
        <div className="rating-score standing-score">
          <span className="rating-number">{rating.skillScore}</span>
          <span className="rating-outof">/ 100</span>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!standing && !error && <p className="muted-inline">Loading…</p>}

      {/* The overview's rating card already explains, in the player's
          own terms, why there is no score yet. Saying it again here
          would be worse and would drift. */}
      {standing?.state === 'unrated' && (
        <p className="muted-inline">
          There is no rating to compare yet — the card on your overview says
          what it is waiting for.
        </p>
      )}

      {standing?.state === 'rated' && (
        <>
          <WhereYouSit standing={standing} />
          {standing.band && <YourGroup band={standing.band} />}

          <p className="standing-dated muted-inline">
            As of {formatDate(standing.computedAt)}, among{' '}
            {standing.poolSize} rated players.
          </p>

          {/* The reason there is no leaderboard, said once, plainly. A
              player who wonders "why can't I see who's first?" deserves
              the real answer, not silence. */}
          <section className="standing-why" aria-label="Why there is no ranking">
            <h2>Why there&rsquo;s no ranking</h2>
            <p>
              Your score is measured against whoever has played, so it can move
              when new people join — even if you haven&rsquo;t played at all. A
              place on a list would claim more than the number can. Where you
              sit, and the group you are in, is what it can honestly tell you.
            </p>
          </section>
        </>
      )}
    </div>
  )
}

export default Rating
