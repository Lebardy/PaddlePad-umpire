import { currentStreak, recentForm } from '../lib/derive'
import { useCountUp } from '../lib/motion'
import Icon from './Icon'

/**
 * The scoreboard the page leads with.
 *
 * A win-loss record is two headline values, so it is two lit figures in
 * their own cells rather than a chart -- a two-bar chart of the same
 * thing would be slower to read and say less. `children` is the row of
 * headline statistics, which hangs off the bottom of the same board.
 */
function Hero({ player, summary, matches, children }) {
  const form = recentForm(matches)
  const streak = currentStreak(matches)
  const wins = useCountUp(summary.wins, 760)
  const losses = useCountUp(summary.losses, 760)

  return (
    <header className="scoreboard" aria-label="Your record">
      <div className="sb-top">
        <span className="sb-brand" aria-hidden="true">
          <img className="sb-logo" src="/favicon.svg" alt="" />
          PaddlePad
        </span>
        <p className="sb-name">{player.name}</p>
      </div>

      <div className="sb-record">
        <p className="sb-cell">
          <span className="sb-label">Won</span>
          <span className="sb-figure">{wins}</span>
        </p>
        <p className="sb-cell">
          <span className="sb-label">Lost</span>
          <span className="sb-figure">{losses}</span>
        </p>
      </div>

      <p className="sb-caption">
        {summary.matches} {summary.matches === 1 ? 'match' : 'matches'}
        {streak && streak.length > 1 && (
          <>
            {' · '}
            <span className={streak.won ? 'streak-won' : 'streak-lost'}>
              {streak.won && <Icon name="flame" size={15} />}
              {streak.length} {streak.won ? 'wins' : 'losses'} in a row
            </span>
          </>
        )}
      </p>

      {children}

      {form.length > 0 && (
        <div className="sb-form">
          <span className="sb-label">Recent</span>
          <ol className="form-pills">
            {/* Reversed so it reads oldest to newest, left to right --
                the direction people expect a run of results to run. */}
            {[...form].reverse().map((entry, i) => (
              <li
                key={entry.id}
                style={{ '--i': i }}
                className={
                  entry.won === null ? 'pill pill-none' : entry.won ? 'pill pill-won' : 'pill pill-lost'
                }
              >
                {/* The letter, not just the colour. A status colour must
                    never carry the meaning on its own. */}
                {entry.won === null ? '–' : entry.won ? 'W' : 'L'}
              </li>
            ))}
          </ol>
        </div>
      )}
    </header>
  )
}

export default Hero
