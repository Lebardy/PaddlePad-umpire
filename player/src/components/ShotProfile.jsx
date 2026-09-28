/**
 * How this player finishes points, and how they play the third shot --
 * step 4 of the Rating screen, which gives it its heading. It moved there
 * from the Overview. "Drop over drive" did not come with it: the Dropper
 * bar in the playstyle step already shows how often they choose the drop.
 *
 * Two forms, chosen by what each piece of data is doing:
 *
 * - Winning shots split by where they were hit is PART-TO-WHOLE, so it is a
 *   horizontal stacked bar with two categorical series, each directly
 *   labelled and separated by a surface-coloured gap.
 * - Drop success is a single ratio against a limit, so it is a METER on
 *   a same-hue track -- not a two-slice pie, which would be slower to
 *   read and harder to compare between visits.
 *
 * Neither has a hover tooltip, and that is deliberate rather than an
 * omission. This is a phone-first app where hover does not exist, so a
 * tooltip would hide values from most of its readers. Every number is
 * directly labelled instead, which is what a tooltip would have shown
 * and is reachable by touch, keyboard and screen reader alike.
 *
 * The third block asks whether the choice actually WON the point, which
 * is a different question from whether the drop landed -- that one is
 * the umpire's judgement that the ball arrived soft at the net. Both
 * are shown or neither is: one of the two alone reads as good or bad on
 * its own, when the only thing it means is "compared with the other".
 *
 * StackedBar and Meter live in their own files now: match detail draws
 * the same two forms for a single match, and one definition means the
 * career view and the single-match view can never drift apart.
 */

import Meter from './Meter'
import StackedBar from './StackedBar'

// Matches the floor the server applies before it will send a
// conversion at all (MIN_LINKED_THIRD_SHOTS in player-stats.js). Held
// here only so the waiting message can name a number.
const MIN_LINKED = 10

function ShotProfile({ summary }) {
  const winnerTotal = summary.cleanWinners + summary.dinkWinners
  // Both or neither: the whole point is the comparison, and one of the
  // two alone invites reading it as good or bad on its own.
  const bothKnown =
    summary.dropConversion !== null &&
    summary.dropConversion !== undefined &&
    summary.driveConversion !== null &&
    summary.driveConversion !== undefined

  return (
    <>
      {winnerTotal > 0 ? (
        <StackedBar
          total={winnerTotal}
          segments={[
            { label: 'Away from the net', value: summary.cleanWinners, className: 'seg-1' },
            { label: 'At the net (dinks)', value: summary.dinkWinners, className: 'seg-2' },
          ]}
        />
      ) : (
        <p className="muted-inline">No winning shots yet.</p>
      )}

      <div className="meters">
        <Meter
          label="Drops that landed"
          value={summary.dropSuccessRate}
          caption={
            summary.dropAttempts > 0
              ? `${summary.dropSuccesses} of ${summary.dropAttempts} third-shot drops`
              : 'No third shots logged yet'
          }
        />
      </div>

      <h3 className="shot-ask">Which one actually wins you the point?</h3>
      {bothKnown ? (
        <>
          <div className="meters">
            <Meter
              label="You won the point after a drop"
              value={summary.dropConversion}
              caption={`${summary.dropRalliesWon} of ${summary.dropRallies} rallies`}
            />
            <Meter
              label="After a drive"
              value={summary.driveConversion}
              caption={`${summary.driveRalliesWon} of ${summary.driveRallies} rallies`}
            />
          </div>
          <p className="shot-note">
            Different question from the one above: a drop can land beautifully
            and still lose the rally.
          </p>
        </>
      ) : (
        <p className="muted-inline">
          Not enough yet — this needs at least {MIN_LINKED} of each, logged
          against the point they were played in.
        </p>
      )}
    </>
  )
}

export default ShotProfile
