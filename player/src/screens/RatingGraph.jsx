// ============================================================
// The PaddlePad Rating graph: the player's PPR over the last week, the
// last month, or since their first match.
//
// Opened from the rating card's last-seven-days line. The whole history
// is fetched here and nowhere else, so the overview never pays for it.
// The headline, the symbols on the line and the Highest / Lowest card
// all read off the line as drawn (see lib/ratingGraph.js), so none of
// them can disagree with what the player is looking at.
// ============================================================

import { useEffect, useState } from 'react'
import RatingLine from '../components/RatingLine'
import { fetchRatingHistory } from '../lib/api'
import { formatDate } from '../lib/format'
import { changeClass, changeWords, graphView } from '../lib/ratingGraph'
import { navigate } from '../lib/router'

const FILTERS = [
  { key: 'week', label: 'Week', span: 'Over the last 7 days', none: 'No matches in the last 7 days.' },
  { key: 'month', label: 'Month', span: 'Since your first match' },
  { key: 'all', label: 'All', span: 'Since your first match' },
]

const STEP_WORDS = {
  day: 'Each step is a day you played.',
  month: 'Each step is a month you played, all its matches together.',
  match: 'Each step is a match.',
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

function RatingGraph() {
  const [history, setHistory] = useState(undefined)
  const [filter, setFilter] = useState('week')

  useEffect(() => {
    const controller = new AbortController()
    fetchRatingHistory({ signal: controller.signal })
      .then((loaded) => setHistory(loaded))
      .catch((err) => {
        if (err?.name !== 'AbortError') setHistory({ failed: true })
      })
    return () => controller.abort()
  }, [])

  if (history === undefined || history?.failed || !history?.matches?.length) {
    const message =
      history === undefined
        ? 'Loading…'
        : history?.failed
          ? 'Your graph couldn’t load. Check your connection and try again.'
          : 'Your graph appears once you’ve played 5 matches.'
    return (
      <div className="graph-page">
        <BackLink />
        <h1>Your PaddlePad Rating</h1>
        <p className="muted">{message}</p>
      </div>
    )
  }

  const matches = history.matches
  const chosen = FILTERS.find((f) => f.key === filter)
  const view = graphView(matches, filter)
  const now = matches[matches.length - 1].points

  return (
    <div className="graph-page">
      <BackLink />
      <h1>Your PaddlePad Rating</h1>
      <p className="points-figure">
        {now.toLocaleString()} <span className="points-unit">PPR</span>
        <span className="graph-now-key"><span className="graph-glyph is-now" aria-hidden="true">●</span> now</span>
      </p>

      <div className="filter-row graph-filters" role="group" aria-label="How far back">
        {FILTERS.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`filter ${filter === option.key ? 'filter-active' : ''}`}
            aria-pressed={filter === option.key}
            onClick={() => setFilter(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {view.empty ? (
        <section className="graph-card">
          <p className="points-quiet">
            {chosen.none} You last played on {formatDate(matches[matches.length - 1].at)}.
          </p>
        </section>
      ) : (
        <>
          <section className="graph-card" aria-label="Your PaddlePad Rating graph">
            <p className={`points-change ${changeClass(view.headline.change)}`}>{changeWords(view.headline)}</p>
            {/* Re-keyed per filter, so the line draws in again on every change. */}
            <RatingLine
              key={filter}
              view={view}
              label={`Your PaddlePad Rating ${chosen.span.toLowerCase()}: from ${view.points[0].value.toLocaleString()} to ${now.toLocaleString()}, highest ${view.highest.toLocaleString()}, lowest ${view.lowest.toLocaleString()}.`}
            />
            <p className="graph-caption">{STEP_WORDS[view.step]}</p>
          </section>

          <section className="graph-extremes" aria-label={chosen.span}>
            <p className="graph-span">{chosen.span}</p>
            <div>
              <strong>
                <span className="graph-glyph is-high" aria-hidden="true">▲</span>
                {view.highest.toLocaleString()}
              </strong>
              <span>Highest</span>
            </div>
            <div>
              <strong>
                <span className="graph-glyph is-low" aria-hidden="true">▼</span>
                {view.lowest.toLocaleString()}
              </strong>
              <span>Lowest</span>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default RatingGraph
