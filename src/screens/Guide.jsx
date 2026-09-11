// ============================================================
// How this works.
//
// Nothing in the app explained itself before. An umpire handed a phone
// courtside met four buttons per player -- Clean Winner, Dink Winner,
// Unforced Error, Dink Error -- with nothing anywhere saying what they
// record or when to tap which, and a match setup asking about stacking
// and first server as bare labels.
//
// This is the long version. The short one now sits on the scoring
// screen itself: the same 2x2 of won/lost against dink/not, built from
// the same list in lib/outcomes.js, so an umpire who is unsure
// mid-rally does not have to leave the match to find out. What is here
// and not there is everything that is not urgent -- how a night runs,
// fixing mistakes, signal, codes.
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

import { Fragment } from 'react'
import { OUTCOMES, RALLY_RULE, outcomeFor } from '../lib/outcomes'

const STEPS = [
  {
    title: 'Make a session',
    body: 'One night of play, named however you like — "Saturday League — Court 3". Every match belongs to a session.',
  },
  {
    title: 'Add the players',
    body: 'Open the session and add everyone playing. A player added once is on everyone’s roster from then on, so the next night you pick them rather than typing them again.',
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

const TERMS = [
  {
    term: 'Dink or clean',
    body: 'A dink is a soft shot at the net. Clean means every other shot. It is about where the shot was played, not how good it was.',
  },
  {
    term: 'Third shot',
    body: 'Only the serving side gets these buttons, and only for their third shot of the rally. Drop ✓ it landed soft at the net, Drop ✗ they tried and missed it, Drive they hit it hard instead. It is recorded separately from how the rally ended, so one rally can have both.',
  },
  {
    term: 'Stacking',
    body: 'Tick it when a doubles pair line up on the same side each serve rather than switching. It changes nothing about scoring — it is recorded because it changes how the pair actually play.',
  },
  {
    term: 'First server',
    body: 'Who puts the first ball in play. In doubles that player is on the right by rule, so setup then asks only which of the other pair starts on the right — from those two facts the app follows the serve for the rest of the game.',
  },
  {
    term: 'Who starts on the right',
    body: 'Right means their own right, facing the net — so the two teams’ right-hand boxes are diagonally opposite, which is why a serve crosses. Watching a pair from behind them, their right is the player on your left. It is also called the even court, because that is the side you serve from when your team’s score is even.',
  },
  {
    term: 'Why the app asks',
    body: 'It decides who serves when the ball goes over. A pair swaps sides only when they score, so whoever is on the right when their team wins the serve is fixed by their own score: even, and it is whoever started there; odd, and it is their partner. If the app ever names the wrong one, tap “Not them?” next to the score — that sticks for the rest of the match.',
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
        <p>{RALLY_RULE}</p>
        <div className="rally-legend-grid guide-legend-grid">
          <span />
          <span className="rally-legend-head">Won the rally</span>
          <span className="rally-legend-head">Lost the rally</span>
          {[true, false].map((dink) => (
            <Fragment key={String(dink)}>
              <span className="rally-legend-row">
                {dink ? 'Soft shot at the net' : 'Any other shot'}
              </span>
              {[true, false].map((won) => (
                <span
                  key={String(won)}
                  className={`rally-legend-cell ${won ? 'winner' : 'error'}`}
                >
                  {outcomeFor(won, dink).label}
                </span>
              ))}
            </Fragment>
          ))}
        </div>
        <dl className="guide-terms">
          {OUTCOMES.map((o) => (
            <div key={o.label}>
              <dt>{o.label}</dt>
              <dd>{o.help}</dd>
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
          All of them. Every umpire account sees every record on
          PaddlePad, because courts and phones change hands mid-session and a
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
          Every player has a code that signs them into the player app, where
          they see their own matches and statistics. Show it from{' '}
          <strong>Players &amp; codes</strong> on the home screen, or from the
          roster inside a session — the same code either way. Only ever show
          someone their own: anyone holding a code can claim that record.
        </p>
        <p>
          The code keeps working after they have used it, and after they set a
          password. That is deliberate — there are no email addresses here, so
          no reset links, and you handing them a fresh code is how someone
          locked out gets back in.
        </p>
      </section>
    </div>
  )
}

export default Guide
