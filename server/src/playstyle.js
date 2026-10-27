// ============================================================
// Proof for a playstyle name.
//
// "Peers" below are everyone the style was compared with: the whole run
// for runs whose styles were found across everyone, the skill group for
// older runs.
//
// The pipeline names a player's style from where their cluster sits
// against its skill group's average -- "Streaky" because the scoring
// swings more than their group's, "Dropper" because they drop more. It
// records which measurements chose which words (players.playstyle_traits)
// but the words alone are an assertion. This turns them into something
// checkable: for each word, the player's own number, their group's
// average, and the average of the OTHER style in their group -- the
// players the clustering separated them from. That last column is the
// proof: it shows what they would have had to look like to be called
// something else.
//
// Built from what is already stored. Every rated player's feature values
// are in `evidence` for that run, beside their skill group and playstyle
// cluster, so these are averages over rows the database already has --
// no second copy of the pipeline's arithmetic, and it works for runs
// published before any of this existed.
//
// PRIVACY: only the asking player's own values, and AVERAGES of others,
// ever leave here. No names, no ids, nobody's individual numbers. A
// style with fewer than MIN_STYLE_MEMBERS members is never averaged or
// named at all -- in a cluster of one an average IS that person, which
// is the same reason a hidden player is left off the monthly board
// rather than blanked on it.
// ============================================================

// Three, the same floor the pipeline uses before it will cluster a
// group's playstyles at all (see run.py), and the same floor the board
// uses before naming anyone.
export const MIN_STYLE_MEMBERS = 3

// The two habits a style name's noun is chosen from, in the pipeline's
// order (IDENTITY_DESCRIPTORS in ml/pipeline/clustering.py): drops
// rather than drives picks Dropper or Driver, points won at the net
// picks Net Player or Power Player. When neither stands out the noun is
// "All-Court Player", and these two are its proof.
export const IDENTITY_FEATURES = ['drop_preference_rate_mean', 'net_game_preference_rate_mean']

// The average each swing measurement moves around, so the app can say
// "usually 4 to 5" rather than a bare standard deviation.
export const SWING_CENTRE = {
  aggression_std: 'aggression_mean',
  drop_efficiency_std: 'drop_efficiency_mean',
  winner_rate_std: 'winner_rate_mean',
  general_error_rate_std: 'general_error_rate_mean',
  dink_error_rate_std: 'dink_error_rate_mean',
  drop_preference_rate_std: 'drop_preference_rate_mean',
  net_game_preference_rate_std: 'net_game_preference_rate_mean',
}

function mean(values) {
  return values.length > 0
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : null
}

/** Four places: these are rates and spreads, not scores. */
function round(value) {
  return value === null ? null : Math.round(value * 10_000) / 10_000
}

// A missing value is left out: Number(null) is 0 and would drag the average.
function valuesOf(rows, feature) {
  return rows
    .map((row) => row.evidence?.[feature])
    .filter((value) => value !== null && value !== undefined)
    .map(Number)
    .filter((value) => Number.isFinite(value))
}

// The fingerprint's six corners, in drawing order: [feature, word, the way
// that word points]. A corner whose measurement gave a word in the name
// shows THAT word instead (Driver for Dropper, Streaky for Consistent), so
// "further out = more of the word shown" always holds.
const CORNERS = [
  ['error_to_winner_ratio', 'Clean', 'lower'],
  ['drop_efficiency_mean', 'Precise', 'higher'],
  ['drop_preference_rate_mean', 'Dropper', 'higher'],
  ['net_game_preference_rate_mean', 'Net Player', 'higher'],
  ['aggression_std', 'Steady', 'lower'],
  ['winner_rate_std', 'Consistent', 'lower'],
]

// The sixth corner is about steadiness, which several measurements can
// name. Steady keeps corner five; the name's other steadiness measure, if
// any, takes corner six so every word in a name is on the chart.
const SIXTH = {
  winner_rate_std: 'Consistent',
  drop_efficiency_std: 'Reliable',
  general_error_rate_std: 'Composed',
  dink_error_rate_std: 'Solid-Net',
}

export function buildCorners({ traits, mine, compare, sameStyle }) {
  const named = new Map(traits.filter((t) => t.feature).map((t) => [t.feature, t]))
  const sixth = Object.keys(SIXTH).find((f) => f !== 'winner_rate_std' && named.has(f)) ?? 'winner_rate_std'
  return CORNERS.map(([feature, word, out], i) => {
    if (i === 5) [feature, word] = [sixth, SIXTH[sixth]]
    const trait = named.get(feature)
    const values = valuesOf(compare, feature)
    // A whole set of zeros is nothing recorded (see the proof rows below).
    const recorded = values.some((v) => v !== 0)
    const average = mean(values)
    const own = mine.evidence?.[feature]
    return {
      word: trait ? trait.label : word,
      feature,
      out: trait ? (trait.direction === 'above' ? 'higher' : 'lower') : out,
      inName: Boolean(trait),
      you: recorded && own !== null && own !== undefined && Number.isFinite(Number(own)) ? round(Number(own)) : null,
      style: recorded && sameStyle.length >= MIN_STYLE_MEMBERS ? round(mean(valuesOf(sameStyle, feature))) : null,
      mean: recorded ? round(average) : null,
      spread: recorded ? round(Math.sqrt(mean(values.map((v) => (v - average) ** 2)))) : null,
    }
  })
}

// One phrase per word, in everyday words, for the line under the name.
const SAYS = {
  'error_to_winner_ratio:lower': 'makes fewer mistakes',
  'drop_efficiency_mean:higher': 'lands its drops',
  'drop_preference_rate_mean:higher': 'chooses drops over drives',
  'drop_preference_rate_mean:lower': 'chooses drives over drops',
  'net_game_preference_rate_mean:higher': 'plays more at the net',
  'net_game_preference_rate_mean:lower': 'plays more from the back',
  'aggression_std:lower': 'finishes points the same way every match',
  'aggression_std:higher': 'mixes up how it finishes points',
  'winner_rate_std:lower': 'scores at an even pace',
  'winner_rate_std:higher': 'scores in streaks',
  'drop_efficiency_std:lower': 'keeps its drops steady from match to match',
  'drop_efficiency_std:higher': 'has good and bad drop days',
  'general_error_rate_std:lower': 'keeps its mistakes level',
  'general_error_rate_std:higher': 'has good and bad days for mistakes',
  'dink_error_rate_std:lower': 'keeps its kitchen game steady',
  'dink_error_rate_std:higher': 'has good and bad days in the kitchen',
}

/** "Your style makes fewer mistakes, … and drives more than it drops." */
export function takeaway(traits) {
  const parts = traits
    .map((t) => (t.feature ? SAYS[`${t.feature}:${t.direction === 'above' ? 'higher' : 'lower'}`] : 'plays every part of the court'))
    .filter(Boolean)
  if (parts.length === 0) return null
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  return `Your style ${list}.`
}

// What a player does better than most, for corners their name does not
// mention. Only the corner's own (default) way, so it is always a
// compliment.
const STANDS_OUT = {
  error_to_winner_ratio: 'fewer mistakes',
  drop_efficiency_mean: 'drops that land',
  drop_preference_rate_mean: 'choosing drops',
  net_game_preference_rate_mean: 'playing at the net',
  aggression_std: 'finishing the same way every match',
  winner_rate_std: 'scoring at an even pace',
  drop_efficiency_std: 'steady drops',
  general_error_rate_std: 'keeping mistakes level',
  dink_error_rate_std: 'a steady kitchen game',
}

/** The corner the player reaches furthest past the average (at least half a spread), not in the name: its words and which corner. */
export function standout(corners) {
  let best = null
  for (const c of corners) {
    if (c.inName || c.you === null || !c.spread) continue
    const z = ((c.you - c.mean) / c.spread) * (c.out === 'lower' ? -1 : 1)
    if (z >= 0.5 && (!best || z > best.z)) best = { z, feature: c.feature }
  }
  return best ? { text: STANDS_OUT[best.feature], feature: best.feature } : null
}

/**
 * The style most common one level up, for a gentle line on the card. Levels
 * are the run's display levels (lowest first), each listing its skill
 * groups. Counts only, never who.
 */
export function nextLevelStyle({ peers, group, levels }) {
  if (!Array.isArray(levels)) return null
  const at = levels.findIndex((level) => level.groups?.includes(group))
  const next = at >= 0 ? levels[at + 1] : null
  if (!next) return null
  const there = peers.filter((p) => next.groups.includes(p.skill_group) && p.playstyle_archetype)
  if (there.length < MIN_STYLE_MEMBERS) return null
  const counts = new Map()
  for (const p of there) counts.set(p.playstyle_archetype, (counts.get(p.playstyle_archetype) ?? 0) + 1)
  const [[style]] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return { style }
}

/**
 * The rows behind a playstyle name.
 *
 * @param {object} input
 * @param {Array<{label, feature, family, direction, z}>} input.traits
 *   what the pipeline built the name from, in name order
 * @param {object} input.mine this player's rating row (cluster + evidence)
 * @param {Array<{playstyle_cluster, playstyle_archetype, evidence}>} input.peers
 *   everyone the style is compared with, this player included: the whole
 *   run when styles were found across everyone, else the skill group
 * @returns {null | {styleSize, other, rows}}
 */
export function buildPlaystyleProof({ traits, mine, peers }) {
  if (!Array.isArray(traits) || traits.length === 0) return null
  if (!mine?.evidence) return null

  const sameStyle = peers.filter((p) => p.playstyle_cluster === mine.playstyle_cluster)

  // The other styles in this group, largest first, ignoring any too
  // small to average without describing one person. A group split into
  // one style has no "other" -- and then the group average is the only
  // honest comparison, which the rows still carry.
  const others = [...new Set(peers.map((p) => p.playstyle_cluster))]
    .filter((cluster) => cluster !== null && cluster !== mine.playstyle_cluster)
    .map((cluster) => {
      const members = peers.filter((p) => p.playstyle_cluster === cluster)
      return {
        cluster,
        archetype: members.find((m) => m.playstyle_archetype)?.playstyle_archetype ?? null,
        members,
      }
    })
    .filter((style) => style.members.length >= MIN_STYLE_MEMBERS)
    .sort((a, b) => b.members.length - a.members.length)

  const other = others[0] ?? null

  const row = (trait, feature, neutral) => {
    const own = mine.evidence[feature]
    // The pipeline stores a player with nothing to measure (no third
    // shots logged) as 0 rather than as missing. One zero can be real;
    // a whole group of zeros is nothing recorded, and bars at 0% would
    // tell every one of them they never drop.
    const recorded = valuesOf(peers, feature).some((value) => value !== 0)
    const shaped = {
      label: trait.label,
      feature,
      family: trait.family ?? null,
      direction: neutral ? null : (trait.direction ?? null),
      // True for the all-court rows below: the word was chosen because
      // this measurement did NOT stand out, so the page reads it that way.
      neutral,
      // Null, never 0, when nothing was recorded. Number(null) would say 0.
      you: !recorded || own === null || own === undefined || !Number.isFinite(Number(own))
        ? null
        : round(Number(own)),
      group: recorded ? round(mean(valuesOf(peers, feature))) : null,
      other: recorded && other ? round(mean(valuesOf(other.members, feature))) : null,
      // The average of this player's own style. Every word in a style
      // name is chosen from where the STYLE sits against its group, not
      // from the one player, so this is the column that proves the word.
      // Measured on staging: all 17 all-court styles sat close to their
      // group while 8 of those players' own numbers did not. Withheld
      // below MIN_STYLE_MEMBERS, where a style average describes the
      // other people in it.
      style: recorded && sameStyle.length >= MIN_STYLE_MEMBERS
        ? round(mean(valuesOf(sameStyle, feature)))
        : null,
    }
    const centre = SWING_CENTRE[feature]
    if (!centre) return shaped
    // Unlike valuesOf, a null average is missing here, not a real 0.
    const centresOf = (rows) => valuesOf(rows.filter((r) => r.evidence?.[centre] != null), centre)
    const styleCentres = centresOf(sameStyle)
    const ownCentre = mine.evidence[centre]
    const hasCentre = shaped.you !== null && ownCentre != null && Number.isFinite(Number(ownCentre))
    return {
      ...shaped,
      center: hasCentre
        ? {
            you: round(Number(ownCentre)),
            style: shaped.style !== null && styleCentres.length >= MIN_STYLE_MEMBERS ? round(mean(styleCentres)) : null,
            group: round(mean(centresOf(peers))),
          }
        : null,
    }
  }

  const rows = traits.flatMap((trait) => {
    if (trait.feature) return [row(trait, trait.feature, false)]
    // The generic noun ("All-Court Player") is what the pipeline picks
    // when NEITHER shot-selection habit stands out from the group. It
    // has no single measurement, but it is still a claim about both, so
    // both are shown as its proof.
    if (trait.family === 'identity') return IDENTITY_FEATURES.map((feature) => row(trait, feature, true))
    return []
  })

  if (rows.length === 0) return null

  const corners = buildCorners({ traits, mine, compare: peers, sameStyle })

  return {
    corners,
    takeaway: takeaway(traits),
    standout: standout(corners),
    // How many share this player's style, so the page can say "one of 9
    // in this style" without naming any of them.
    styleSize: sameStyle.length,
    other: other ? { archetype: other.archetype, size: other.members.length } : null,
    rows,
  }
}
