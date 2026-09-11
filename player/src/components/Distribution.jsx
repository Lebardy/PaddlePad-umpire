// ============================================================
// The club's spread of skill scores, with this player marked in it.
//
// A shape rather than a list, and that is the whole design. A list has
// an order, and an order is a leaderboard whether or not it is labelled
// one. A shape says where someone sits without saying who sits above
// them -- which is also the most honest thing this model can say,
// because the score is relative to whoever has played and a position on
// a list would claim a precision it does not have.
//
// One highlighted bar in --series-1, everything else neutral. Colour is
// never the only cue: the player's bar is also labelled underneath, so
// the picture reads the same without colour at all.
//
// Only ever handed counts. The server sends no scores, ids or names for
// anyone else (getClubStanding), so there is nothing here that could be
// turned back into a ranking.
// ============================================================

function Distribution({ buckets }) {
  const tallest = Math.max(...buckets.map((b) => b.count), 1)
  const yours = buckets.find((b) => b.yours)

  return (
    <figure className="dist">
      <div
        className="dist-bars"
        role="img"
        aria-label={
          `How everyone's scores are spread, in ten bands from 0 to 100. ` +
          (yours ? `Yours is in the ${yours.from} to ${yours.to} band.` : '')
        }
      >
        {buckets.map((bucket) => (
          <span key={bucket.from} className="dist-col">
            <span
              className={`dist-bar${bucket.yours ? ' is-you' : ''}`}
              // A floor of 2% so an empty band still reads as "nobody
              // here" rather than as a gap in the chart.
              style={{ height: `${Math.max((bucket.count / tallest) * 100, 2)}%` }}
            />
          </span>
        ))}
      </div>

      <div className="dist-axis" aria-hidden="true">
        {buckets.map((bucket) => (
          <span key={bucket.from} className="dist-tick">
            {bucket.yours ? 'You' : ''}
          </span>
        ))}
      </div>

      <figcaption className="dist-scale" aria-hidden="true">
        <span>0</span>
        <span>100</span>
      </figcaption>
    </figure>
  )
}

export default Distribution
