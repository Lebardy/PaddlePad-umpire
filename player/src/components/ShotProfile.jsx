/**
 * How this player finishes points, and how they play the third shot.
 *
 * Two forms, chosen by what each piece of data is doing:
 *
 * - Winners split by where they were hit is PART-TO-WHOLE, so it is a
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
 * StackedBar and Meter live in their own files now: match detail draws
 * the same two forms for a single match, and one definition means the
 * career view and the single-match view can never drift apart.
 */

import Meter from './Meter'
import StackedBar from './StackedBar'

function ShotProfile({ summary }) {
  const winnerTotal = summary.cleanWinners + summary.dinkWinners
  const thirdShots = summary.dropAttempts + summary.driveAttempts

  return (
    <section className="shot-profile" aria-label="Shot profile">
      <h2>How you win points</h2>

      {winnerTotal > 0 ? (
        <StackedBar
          total={winnerTotal}
          segments={[
            { label: 'Away from the net', value: summary.cleanWinners, className: 'seg-1' },
            { label: 'At the net (dinks)', value: summary.dinkWinners, className: 'seg-2' },
          ]}
        />
      ) : (
        <p className="muted-inline">No winners logged yet.</p>
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
        <Meter
          label="Drop over drive"
          value={summary.dropPreference}
          caption={
            thirdShots > 0
              ? `You chose the drop ${summary.dropAttempts} of ${thirdShots} times`
              : 'No third shots logged yet'
          }
        />
      </div>
    </section>
  )
}

export default ShotProfile
