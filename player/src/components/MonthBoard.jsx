// ============================================================
// This month on PaddlePad.
//
// The board a leaderboard was asked for, built so it cannot become one.
// Every row names people for something they DID this month -- played a
// lot, met a lot of people, played a great game, got better than they
// used to be. Nothing on it is the rating model's opinion of anyone,
// and nothing sets one person's number beside another's to compare.
// Why two planned rows were left out is written up in server/board.js.
//
// Ties are shown as ties, alphabetically, so the order can never be
// read as a ranking: everyone listed in a row did the same thing.
//
// The whole board resets each month and says when. A top spot that
// visibly expires is not much of a top spot.
//
// Anyone who hides their name is left off entirely, not blanked -- a
// board that says "Ana & Cy v Dee & someone" tells anyone who was there
// exactly who "someone" was. The footer says who is shown and how to
// leave, so the rule is never a surprise.
// ============================================================

import { useEffect, useState } from 'react'
import { fetchBoard } from '../lib/api'
import { usePlayerData } from '../lib/PlayerData'
import { Link } from '../lib/router'

/** "Ana", "Ana and Ben", "Ana, Ben and Cy", "Ana, Ben, Cy and 3 more". */
function listNames({ names, more }) {
  if (more > 0) return `${names.join(', ')} and ${more} more`
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function tied(row) {
  return row.names.length + row.more > 1
}

function resetLabel(resetsOn) {
  // A plain date from the server; read as local midnight, not UTC, or
  // "1 October" shows as 30 September west of Greenwich.
  return new Date(`${resetsOn}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

function Row({ label, children }) {
  return (
    <li className="board-row">
      <span className="board-label">{label}</span>
      <span className="board-value">{children}</span>
    </li>
  )
}

function Empty() {
  return <span className="board-empty">Not yet this month</span>
}

function MonthBoard() {
  const { matches: mine } = usePlayerData()
  const [board, setBoard] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchBoard({ signal: controller.signal })
      .then(setBoard)
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(true)
      })
    return () => controller.abort()
  }, [])

  if (error) {
    return (
      <section className="board" aria-label="This month on PaddlePad">
        <p className="muted-inline">Couldn&rsquo;t load this month&rsquo;s board.</p>
      </section>
    )
  }
  // Nothing while loading: a skeleton would jump the People list down a
  // moment later, and the list is what this screen is for.
  if (!board) return null

  const { playedMost, metMost, matchOfTheMonth: best, biggestStepUp } = board
  const quiet = !playedMost && !metMost && !best && !biggestStepUp

  return (
    <section className="board" aria-label="This month on PaddlePad">
      <div className="section-head">
        <h2>This month on PaddlePad</h2>
        <span className="chip chip-quiet">Resets {resetLabel(board.resetsOn)}</span>
      </div>

      {quiet ? (
        <p className="muted-inline">No finished matches yet this month.</p>
      ) : (
        <ul className="board-rows">
          <Row label="Played the most">
            {playedMost ? (
              <>
                {listNames(playedMost)}
                <span className="board-note">
                  {playedMost.count} {playedMost.count === 1 ? 'match' : 'matches'}
                  {tied(playedMost) ? ' each' : ''}
                </span>
              </>
            ) : (
              <Empty />
            )}
          </Row>

          <Row label="Met the most people">
            {metMost ? (
              <>
                {listNames(metMost)}
                <span className="board-note">
                  {metMost.count} {metMost.count === 1 ? 'person' : 'people'}
                  {tied(metMost) ? ' each' : ''}
                </span>
              </>
            ) : (
              <Empty />
            )}
          </Row>

          <Row label="Match of the month">
            {best ? (
              // Someone who played in it gets their own full match page,
              // shots and all, as anywhere else in the app. Everyone else
              // gets the story of the game and nobody's shots.
              <Link
                className="board-link"
                to={
                  mine.some((m) => m.id === best.id)
                    ? `/matches/${best.id}`
                    : `/board/match/${best.id}`
                }
              >
                {best.teamA.join(' & ')} v {best.teamB.join(' & ')}
                <span className="board-note">
                  {best.score.A}–{best.score.B}, the closest game this month &rarr;
                </span>
              </Link>
            ) : (
              <Empty />
            )}
          </Row>

          <Row label="Biggest step up">
            {biggestStepUp ? (
              <>
                {listNames(biggestStepUp)}
                <span className="board-note">compared with their own earlier games</span>
              </>
            ) : (
              <Empty />
            )}
          </Row>
        </ul>
      )}

      <p className="board-footer">
        Only players who show their name appear here. You can hide yours on the
        You tab.
      </p>
    </section>
  )
}

export default MonthBoard
