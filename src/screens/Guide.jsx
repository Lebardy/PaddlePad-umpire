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
// screen itself: every way a rally can end, built from the same list in
// lib/outcomes.js, so an umpire who is unsure
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

import { FAULT_ENDINGS, RALLY_RULE, WINNING_ENDINGS } from '../lib/outcomes'
import Icon from '../components/Icon'

const STEPS = [
  { title: 'Make a session', body: 'One night of play, named how you like. Every match belongs to one.' },
  { title: 'Add the players', body: 'Add everyone playing. A player added once is on every roster from then on.' },
  { title: 'Start a match', body: 'Singles or doubles, the teams, and who serves first.' },
  { title: 'Two taps per rally', body: 'What ended it, then the player. The score, the serve and every statistic come from those taps.' },
]

const TERMS = [
  {
    term: 'Dink',
    body: 'A soft shot at the net. Dink winner and Missed dink are the endings about them; every other ending is a shot played anywhere else.',
  },
  {
    term: 'Third shot',
    body: 'Serving side only, for their third shot of the rally. Drop ✓ landed soft at the net, Drop ✗ missed, Drive hit hard. Recorded separately from how the rally ended, so one rally can have both.',
  },
  {
    term: 'Stacking',
    body: 'Tick it when a doubles pair line up on the same side each serve instead of switching. Scoring is unchanged; it is recorded because it changes how the pair play.',
  },
  {
    term: 'First server',
    body: 'Who puts the first ball in play. In doubles they start on the right by rule, so setup only asks which of the other pair starts on the right. From those two facts the app follows the serve all game.',
  },
  {
    term: 'Who starts on the right',
    body: 'Their own right, facing the net, so the two teams’ right-hand boxes are diagonally opposite. Seen from behind a pair, their right is the player on your left. Also called the even court: you serve from it when your score is even.',
  },
  {
    term: 'Why the app asks',
    body: 'It decides who serves when the ball goes over. A pair swaps sides only when they score, so on an even score the right-hand player is whoever started there, and on an odd score their partner. If the app names the wrong one, tap “Not them?” beside the score; that sticks for the match.',
  },
  {
    term: 'Play to',
    body: '11, 15 or 21, set per match. The app decides when the game is over, so a wrong setting calls a game to 15 at 11.',
  },
]

// One folded section: its icon, its title, and the answer under it.
function Section({ icon, title, open = false, children }) {
  return (
    <details className="guide-section" open={open}>
      <summary>
        <span className="guide-icon"><Icon name={icon} size={22} /></span>
        <h3>{title}</h3>
        <Icon name="chevron" size={18} className="guide-chevron" />
      </summary>
      {children}
    </details>
  )
}

function Guide({ onBack }) {
  return (
    <div className="guide">
      <button className="back-link" onClick={onBack}>
        ← Back
      </button>

      <h2>How this works</h2>
      <p className="guide-lede">
        You tap what happened. The app works out the score, the serve and the
        statistics.
      </p>

      <Section icon="list" title="Start to finish" open>
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
      </Section>

      <Section icon="target" title="Scoring a rally">
        <p>{RALLY_RULE}</p>
        {[
          ['Won with a shot', WINNING_ENDINGS],
          ['Lost by a fault', FAULT_ENDINGS],
        ].map(([title, endings]) => (
          <div key={title}>
            <h4 className="guide-subhead">{title}</h4>
            <dl className="guide-terms">
              {endings.map((ending) => (
                <div key={ending.key}>
                  <dt><Icon name={ending.key} size={18} />{ending.label}</dt>
                  <dd>{ending.help}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <p>
          In doubles you pick the player on a picture of the court seen from
          the side: one pair left of the net, the other right, each where
          they stand right now. Back to front from where you stand? Tap{' '}
          <strong>Swap ends</strong> once; it stays that way for the match.
        </p>
        <p className="guide-note">
          Winning shots go to the player who hit them. Faults go to the player
          who made them, not to whoever won the point.
        </p>
      </Section>

      <Section icon="book" title="Words the app asks you for">
        <dl className="guide-terms">
          {TERMS.map((t) => (
            <div key={t.term}>
              <dt>{t.term}</dt>
              <dd>{t.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section icon="undo" title="When you get it wrong">
        <p>
          <strong>Undo</strong>, under the score, removes the last thing
          logged, as many times as you need. Wrong ending tapped?{' '}
          <strong>Back</strong>, in the same place, before you pick a player.
        </p>
        <p>
          <strong>End match early</strong> is for a game stopped, not won:
          someone retires, or the court is needed. The score stands.
        </p>
        <p>
          <strong>Cancel match</strong> throws away a match started by mistake,
          before it finishes. A finished match is <strong>voided</strong>{' '}
          instead: it stays on record, stops counting, and can be put back.
        </p>
      </Section>

      <Section icon="offline" title="No signal?">
        <p>
          Keep scoring. Everything is saved on this phone first and sent when
          there is signal; the indicator in the header shows what is waiting.
          Don&rsquo;t sign out while something is waiting: that throws it away.
        </p>
        <p>
          A red indicator means the server refused something. Tap it to see
          what and why, then try again or dismiss.
        </p>
        <p className="guide-note">
          Two phones must not score the same match at once. If someone takes
          over, the app says so, and theirs is the record that counts.
        </p>
      </Section>

      <Section icon="calendar" title="Whose sessions you can see">
        <p>
          Every session at the place you umpire, because courts and phones
          change hands mid-session. Yours come first; below them are the ones
          other umpires still have running, with their name on each.
        </p>
        <p>
          <strong>End session</strong> when the night is over. That takes it
          off everyone else&rsquo;s list. It is not voiding: every match still
          counts. Reopen it if you ended too early.
        </p>
      </Section>

      <Section icon="qr" title="Players and their codes">
        <p>
          Every player has a code that signs them into the player app. Show it
          from <strong>Players &amp; codes</strong> on the home screen or from
          a session&rsquo;s roster; it is the same code. Only show someone
          their own: anyone holding a code can claim that record.
        </p>
        <p>
          A code stops working once the player sets a password or connects
          Google. Locked out? Give them a fresh code; that is how they get
          back in.
        </p>
      </Section>
    </div>
  )
}

export default Guide
