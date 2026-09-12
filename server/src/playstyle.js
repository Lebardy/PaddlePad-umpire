// ============================================================
// Proof for a playstyle name.
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

function mean(values) {
  return values.length > 0
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : null
}

/** Four places: these are rates and spreads, not scores. */
function round(value) {
  return value === null ? null : Math.round(value * 10_000) / 10_000
}

function valuesOf(rows, feature) {
  return rows
    .map((row) => Number(row.evidence?.[feature]))
    .filter((value) => Number.isFinite(value))
}

/**
 * The rows behind a playstyle name.
 *
 * @param {object} input
 * @param {Array<{label, feature, family, direction, z}>} input.traits
 *   what the pipeline built the name from, in name order
 * @param {object} input.mine this player's rating row (cluster + evidence)
 * @param {Array<{playstyle_cluster, playstyle_archetype, evidence}>} input.peers
 *   every rated player in the same skill group, this player included
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

  const rows = traits
    // A trait with no measurement behind it -- the generic noun the
    // pipeline falls back to when nothing stood out -- has nothing to
    // prove, so it is left off rather than shown with empty columns.
    .filter((trait) => trait.feature)
    .map((trait) => ({
      label: trait.label,
      feature: trait.feature,
      family: trait.family ?? null,
      direction: trait.direction ?? null,
      you: round(Number(mine.evidence[trait.feature])),
      group: round(mean(valuesOf(peers, trait.feature))),
      other: other ? round(mean(valuesOf(other.members, trait.feature))) : null,
    }))

  if (rows.length === 0) return null

  return {
    // How many share this player's style, so the page can say "one of 9
    // in this style" without naming any of them.
    styleSize: sameStyle.length,
    other: other ? { archetype: other.archetype, size: other.members.length } : null,
    rows,
  }
}
