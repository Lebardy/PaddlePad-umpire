import { currentStreak, recentForm } from '../lib/derive'

/**
 * The figure the page leads with.
 *
 * A win-loss record is a single headline value, so it is a hero number
 * rather than a chart -- a two-bar chart of the same thing would be
 * slower to read and say less.
 */
function Hero({ player, summary, matches }) {
  const form = recentForm(matches)
  const streak = currentStreak(matches)

  return (
    <header className="hero">
      <p className="eyebrow">{player.name}</p>

      <p className="hero-figure">
        {summary.wins}<span className="hero-sep">–</span>{summary.losses}
      </p>
      <p className="hero-caption">
        {summary.matches} {summary.matches === 1 ? 'match' : 'matches'} played
        {streak && streak.length > 1 && (
          <>
            {' · '}
            <span className={streak.won ? 'streak-won' : 'streak-lost'}>
              {streak.length} {streak.won ? 'wins' : 'losses'} in a row
            </span>
          </>
        )}
      </p>

      {form.length > 0 && (
        <div className="form-guide">
          <span className="form-label">Recent</span>
          <ol className="form-pills">
            {/* Reversed so it reads oldest to newest, left to right --
                the direction people expect a run of results to run. */}
            {[...form].reverse().map((entry) => (
              <li
                key={entry.id}
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
