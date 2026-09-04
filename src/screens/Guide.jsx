// ============================================================
// How this works.
//
// Nothing in the app explained itself before. An umpire handed a phone
// courtside met four buttons per player -- Clean Winner, Dink Winner,
// Unforced Error, Dink Error -- with nothing anywhere saying what they
// record or when to tap which, and a match setup asking about stacking
// and first server as bare labels.
//
// Reachable from the header at any time, not shown once and lost. Most
// of what is here is needed on the second night as much as the first,
// and someone who dismissed a tour has no way back to it.
//
// It teaches the APP and the words the app puts in front of them. It
// deliberately does not teach pickleball: the people umpiring here play
// the game, and explaining side-out scoring to them would be padding.
//
// Every claim below is a fact about this code, not a general
// description of scoring. If the buttons in LiveMatch or the fields in
// MatchSetup change, this has to change with them.
// ============================================================

const STEPS = [
  {
    title: 'Make a session',
    body: 'One night of play, named however you like — "Saturday League — Court 3". Every match belongs to a session.',
  },
  {
    title: 'Add the players',
    body: 'Open the session and add everyone playing. A player added once is on the club roster from then on, so the next night you pick them rather than typing them again.',
  },
  {
    title: 'Start a match',
    body: 'Choose singles or doubles, pick the teams, and say who serves first. That is the whole setup.',
  },
  {
    title: 'Tap once per rally',
    body: 'When a rally ends, tap the button under whoever hit the last shot. The score, the serve and every statistic come from those taps.',
  },
]

const OUTCOMES = [
  {
    label: 'Clean Winner',
    body: 'They ended the rally with a shot away from the net.',
  },
  {
    label: 'Dink Winner',
    body: 'They ended it with a soft shot at the net.',
  },
  {
    label: 'Unforced Error',
    body: 'They ended it themselves — out, or into the net — away from the net.',
  },
  {
    label: 'Dink Error',
    body: 'The same, but on a dink at the net.',
  },
]

const TERMS = [
  {
    term: 'Dink or clean',
    body: 'Dink means the soft game at the net. Clean means everything else. It is about where the shot was played, not how good it was.',
  },
  {
    term: 'Third shot',
    body: 'Only the serving side gets these buttons, and only they can play a third shot. Drop ✓ if the drop landed, Drop ✗ if it did not, Drive if they drove instead. It is recorded separately from how the rally ended, so a rally can have both.',
  },
  {
    term: 'Stacking',
    body: 'Tick it when a doubles pair line up on the same side each serve rather than switching. It changes nothing about scoring — it is recorded because it changes how the pair actually play.',
  },
  {
    term: 'First server',
    body: 'Who puts the first ball in play. The app tracks the serve from there, so you never have to say whose serve it is again.',
  },
  {
    term: 'Play to',
    body: '11, 15 or 21. Set it per match, because the app decides when the game is finished — get it wrong and a game to 15 will be called at 11.',
  },
]

function Guide({ onBack }) {
  return (
    <div className="guide">
      <button className="back-link" onClick={onBack}>
        ← Back
      </button>

      <h2>How this works</h2>
      <p className="guide-lede">
        You tap what happened. The app works out the score, whose serve it is,
        and everything the ratings are built from.
      </p>

      <section className="guide-section" aria-label="The flow">
        <h3>Start to finish</h3>
        <ol className="guide-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="guide-step-n">{i + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-section" aria-label="The four buttons">
        <h3>The four buttons</h3>
        <p>
          Every player has these. Tap the one under the player who hit the shot
          that <em>ended</em> the rally — whether they won it or lost it.
        </p>
        <dl className="guide-terms">
          {OUTCOMES.map((o) => (
            <div key={o.label}>
              <dt>{o.label}</dt>
              <dd>{o.body}</dd>
            </div>
          ))}
        </dl>
        <p className="guide-note">
          Winners go to the player who hit them. Errors go to the player who
          made them — not to whoever won the point.
        </p>
      </section>

      <section className="guide-section" aria-label="Words the app uses">
        <h3>Words the app asks you for</h3>
        <dl className="guide-terms">
          {TERMS.map((t) => (
            <div key={t.term}>
              <dt>{t.term}</dt>
              <dd>{t.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="guide-section" aria-label="Fixing mistakes">
        <h3>When you get it wrong</h3>
        <p>
          <strong>Undo last</strong> sits up with the score rather than at the
          bottom, because correcting a mis-tap has to be as quick as the tap
          was. It removes the last thing logged, as many times as you need.
        </p>
        <p>
          <strong>End match early</strong> is for a game stopped rather than
          won — someone retires, or the court is needed. The score stands as it
          was.
        </p>
        <p>
          <strong>Cancel match</strong> throws away a match started by mistake,
          before it finishes. A match that already finished is{' '}
          <strong>voided</strong> instead: wrong court, wrong pairing. It stays
          on record, stops counting, and you can put it back.
        </p>
      </section>

      <section className="guide-section" aria-label="Signal">
        <h3>No signal?</h3>
        <p>
          Keep scoring. Everything is written to this phone first and sent up
          when there is signal again — the indicator in the header shows what is
          still waiting. The one thing to avoid is signing out while it says
          there is something left, because that throws it away.
        </p>
        <p className="guide-note">
          Two phones must not score the same match at once. If someone takes
          over, the app says so, and the phone that took over is the one whose
          record counts.
        </p>
      </section>

      <section className="guide-section" aria-label="Whose sessions">
        <h3>Whose sessions you can see</h3>
        <p>
          All of them. Every umpire account sees the whole club&rsquo;s
          records, because courts and phones change hands mid-session and a
          player has to be the same person whoever scored them. Your own
          sessions are listed first; below them are the ones other umpires
          still have running, with their name against each.
        </p>
        <p>
          <strong>End session</strong> when the night is over. That is what
          takes it off everyone else&rsquo;s list — it is not the same as
          voiding, and every match in it still counts. Reopen it if you end it
          too early.
        </p>
      </section>

      <section className="guide-section" aria-label="Players">
        <h3>Players and their codes</h3>
        <p>
          Every player has a code you can show them from the session roster. It
          signs them into the player app, where they see their own matches and
          statistics. Only ever show someone their own — anyone holding a code
          can claim that record.
        </p>
      </section>
    </div>
  )
}

export default Guide
