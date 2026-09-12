// ============================================================
// What the rating is actually made of.
//
// The skill score is a weighted sum of exactly four measurements:
// drop shots landing (25 points), winning shots (30), unforced
// mistakes (20), mistakes at the net (25). Nothing else touches it.
// The other six features the pipeline computes decide which GROUP and
// which PLAYSTYLE a player lands in, and never move the number.
//
// So this is not an explanation invented after the fact, and not a
// correlation. It is the score's own arithmetic, split back into its
// four terms -- which is why the pipeline refuses to publish a run
// where the parts do not add up to the score (ml/run.py).
//
// Two questions come out of it, and they are the two a rating cannot
// answer on its own:
//
//   what is moving MY rating   -- my four parts against the average of
//                                 the four parts of players at my level
//   what separates me from the -- the same four against the group one
//   group above                  rung up the ladder
//
// PRIVACY: the same line the playstyle proof draws. Only this player's
// own numbers and AVERAGES of others leave here -- no names, no ids,
// nobody else's individual values, and no ordering anything could be
// ranked from. A group with fewer than MIN_GROUP_MEMBERS is never
// averaged at all, because an average of one or two is those people.
// ============================================================

// Three, the same floor the playstyle proof uses and the same one the
// pipeline needs before it will cluster a group at all.
export const MIN_GROUP_MEMBERS = 3

// The four parts, in the order a player should read them, with the
// everyday name for each. Keys come from the pipeline (run.SCORE_PARTS).
//
// The wording avoids racket-sport shorthand on purpose: this is the
// player app, where "mistakes at the net" beats "dink errors" even
// though the umpire app happily says the latter.
export const PARTS = [
  { key: 'winningShots', label: 'winning shots', better: 'higher' },
  { key: 'dropsLanding', label: 'drop shots landing', better: 'higher' },
  { key: 'netMistakes', label: 'mistakes at the net', better: 'lower' },
  { key: 'mistakes', label: 'mistakes away from the net', better: 'lower' },
]

function mean(values) {
  return values.length > 0
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : null
}

/** Four places on a rate, one on points: a tenth of a point is noise. */
function round(value, places) {
  if (value === null || !Number.isFinite(value)) return null
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function numbersAt(rows, key, field) {
  return rows
    .map((row) => Number(row.score_parts?.[key]?.[field]))
    .filter((value) => Number.isFinite(value))
}

/**
 * A group's average for every part, or null if the group is too small
 * to average without describing a particular person.
 */
function averageParts(rows) {
  if (!Array.isArray(rows) || rows.length < MIN_GROUP_MEMBERS) return null
  const averaged = {}
  for (const { key } of PARTS) {
    averaged[key] = {
      points: round(mean(numbersAt(rows, key, 'points')), 1),
      value: round(mean(numbersAt(rows, key, 'value')), 4),
    }
  }
  return averaged
}

/**
 * The rows behind a rating.
 *
 * @param {object} input
 * @param {object} input.mine this player's score_parts
 * @param {Array<{score_parts}>} input.peers every rated player in this
 *   player's own skill group, this player included
 * @param {Array<{score_parts}>} input.above every rated player in the
 *   group one rung up, or an empty list if there is no group above
 * @returns {null | {parts, groupSize, aboveSize}}
 */
export function buildRatingParts({ mine, peers, above }) {
  if (!mine || typeof mine !== 'object') return null

  // A run published before the pipeline sent any of this. The page says
  // so rather than drawing four empty rows.
  const present = PARTS.filter(({ key }) => Number.isFinite(Number(mine[key]?.points)))
  if (present.length !== PARTS.length) return null

  const groupAverage = averageParts(peers)
  const aboveAverage = averageParts(above)

  const parts = PARTS.map(({ key, label, better }) => ({
    key,
    label,
    better,
    // What this measurement is counted in, so the app never has to
    // guess whether 0.3 is a share or a rate.
    unit: mine[key].unit ?? null,
    // The most this part can be worth: its weight in the score.
    max: round(Number(mine[key].max), 1),
    you: {
      points: round(Number(mine[key].points), 1),
      value: round(Number(mine[key].value), 4),
    },
    group: groupAverage?.[key] ?? null,
    above: aboveAverage?.[key] ?? null,
  }))

  return {
    parts,
    // Counts, so the page can say what an average rests on. Never who.
    groupSize: Array.isArray(peers) ? peers.length : 0,
    aboveSize: Array.isArray(above) ? above.length : 0,
    // Whether the averages were withheld, which is a different fact
    // from there being no group above. The page says the right one.
    groupAveraged: groupAverage !== null,
    aboveAveraged: aboveAverage !== null,
  }
}
