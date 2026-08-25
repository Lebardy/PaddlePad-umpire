/**
 * What a player sees before any of their matches has finished.
 *
 * This is the first screen most players ever see -- they have just
 * scanned a code and arrived. A bare "no matches yet" reads like
 * something is broken, and gives them no reason to come back. So it
 * does three jobs instead: confirm the claim worked, say plainly what
 * happens next, and show what this page will hold once it has data.
 *
 * The preview is drawn as empty structure rather than fake numbers.
 * Placeholder figures would be a small lie, and the first thing a
 * player learns about the app shouldn't be that its numbers can't be
 * trusted.
 */

const WHAT_YOU_GET = [
  {
    title: 'Your record',
    body: 'Wins, losses, and how your recent matches have gone.',
  },
  {
    title: 'Every match',
    body: 'The score, who you partnered, and who you were up against.',
  },
  {
    title: 'How you play',
    body: 'Winners and errors, and how many of your drops actually landed.',
  },
]

function EmptyState({ name, inProgress }) {
  const firstName = name.split(' ')[0]

  return (
    <div className="empty">
      <header className="empty-head">
        <p className="eyebrow">You&rsquo;re all set</p>
        <h1>{firstName}, this is your page.</h1>
        <p className="empty-lede">
          {inProgress > 0
            ? `A match of yours is being scored right now. It'll appear here the moment it finishes.`
            : `Nothing to do — just play. Your matches show up here as soon as an umpire scores one you're in.`}
        </p>
      </header>

      {inProgress > 0 && (
        <div className="live-note" role="status">
          <span className="live-dot" aria-hidden="true" />
          <span>
            {inProgress} {inProgress === 1 ? 'match' : 'matches'} in progress
          </span>
        </div>
      )}

      {/* Structure without numbers: shows the shape of the page to come
          without inventing data to fill it. */}
      <section className="preview" aria-label="What will appear here">
        <div className="preview-card" aria-hidden="true">
          <span className="ghost ghost-hero" />
          <span className="ghost ghost-line" />
          <div className="ghost-row">
            <span className="ghost ghost-pill" />
            <span className="ghost ghost-pill" />
            <span className="ghost ghost-pill" />
            <span className="ghost ghost-pill" />
            <span className="ghost ghost-pill" />
          </div>
        </div>

        <ul className="promise-list">
          {WHAT_YOU_GET.map((item) => (
            <li key={item.title}>
              <span className="promise-title">{item.title}</span>
              <span className="promise-body">{item.body}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="empty-foot">
        Playing today? Ask whoever&rsquo;s scoring to add you to the match.
      </p>
    </div>
  )
}

export default EmptyState
