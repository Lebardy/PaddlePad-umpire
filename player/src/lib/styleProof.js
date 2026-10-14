// ============================================================
// The words and rules behind the playstyle step's proof.
//
// Kept apart from the screen so the wording can be checked without a
// browser: node player/scripts/check-style-proof.mjs.
//
// A style's size changes what can honestly be said about it. Three or
// more players: the style's own average is shown and proves each word.
// Two: that average is withheld (server/src/playstyle.js), because
// beside the player's own number it would give away the other player's.
// One: the style IS the player, so the page talks about them directly.
// ============================================================

/**
 * Each measurement in everyday words, with how to read its number.
 *
 * The feature names belong to the model; a player should never meet
 * `winner_rate_std`. The spread features are said as how much something
 * changes from match to match.
 */
// `as` says how its number reads:
//   percent        a share, shown as 19%
//   ratio          shown as 0.85
//   swing-percent  how much a share changes from match to match (the
//                  spread of a proportion), shown as ±12%
//   swing-per10    how much a per-minute count changes from match to
//                  match, shown per 10 minutes as ±0.9 -- ten minutes is
//                  roughly a game, a length people already think in

export const MEASURES = {
  drop_efficiency_mean: { label: 'drop shots landing', as: 'percent', better: 'higher' },
  error_to_winner_ratio: { label: 'mistakes per winning shot', as: 'ratio', better: 'lower' },
  // The share of a player's finishes (winners and mistakes) that were
  // winners: how cleanly they finish, not how often they attack.
  aggression_std: { label: 'match-to-match change in winning finishes', thing: 'winning finishes', as: 'swing-percent', better: 'neither' },
  drop_efficiency_std: { label: 'change in drops landing, match to match', thing: 'drops landing', as: 'swing-percent', better: 'neither' },
  winner_rate_std: { label: 'change in winning shots per 10 min, match to match', thing: 'winning shots per 10 min', as: 'swing-per10', better: 'neither' },
  general_error_rate_std: { label: 'change in mistakes per 10 min, match to match', thing: 'mistakes per 10 min', as: 'swing-per10', better: 'neither' },
  dink_error_rate_std: { label: 'change in net mistakes per 10 min, match to match', thing: 'net mistakes per 10 min', as: 'swing-per10', better: 'neither' },
  drop_usage_rate: { label: 'third shots that are drops', as: 'percent', better: 'neither' },
  drop_preference_rate_mean: { label: 'drops rather than drives', as: 'percent', better: 'neither' },
  drop_preference_rate_std: { label: 'change in choosing drops, match to match', thing: 'choosing drops over drives', as: 'swing-percent', better: 'neither' },
  net_game_preference_rate_mean: { label: 'points won at the net', as: 'percent', better: 'neither' },
  net_game_preference_rate_std: { label: 'change in points won at the net, match to match', thing: 'points won at the net', as: 'swing-percent', better: 'neither' },
}

/**
 * The one line saying how many share the style. The group's size is not
 * said: the player sees their level, and the group is only part of it.
 */
export function styleShareLine(styleSize, groupSize) {
  if (!groupSize) return null
  if (!styleSize) return 'Compared with similar players'
  if (styleSize === 1) return 'No similar player plays this way yet'
  if (styleSize === 2) return 'You and 1 other play this way'
  return `${styleSize} play this way`
}

/**
 * Which way the line under a trait points: 'higher', 'lower', or null
 * for no line.
 *
 * The word was chosen from where the STYLE sits against its group, so
 * three or more read the style's average. A style of one is the player,
 * but the word was chosen from their numbers with skill taken out, and
 * the page shows the numbers as they were: when those point against the
 * word, no line is better than one the bars beside it contradict. A
 * style of two has no average to read.
 */
export function verdictWay(row, styleSize) {
  if (styleSize === 1) {
    if (row.you === null || row.you === undefined || row.you === row.group) return null
    const way = row.you > row.group ? 'higher' : 'lower'
    return (way === 'higher') === (row.direction === 'above') ? way : null
  }
  const hasStyle = row.style !== null && row.style !== undefined
  return hasStyle && row.style !== row.group ? (row.style > row.group ? 'higher' : 'lower') : null
}

/** The one note under a style of two, saying why its average is missing. */
export function hiddenStyleNote(styleSize) {
  return styleSize === 2
    ? 'Your style’s average is hidden: with 2 players it would reveal the other’s numbers.'
    : null
}

/**
 * The short line under a trait: who it is about and which way they sit
 * from the group. Null when the numbers cannot point (see `verdictWay`).
 */
export function traitLine(row, styleSize) {
  const way = verdictWay(row, styleSize)
  if (!MEASURES[row.feature] || !way) return null
  return `${styleSize === 1 ? 'You' : 'Your style'}: ${way} than others`
}

/** "4 to 5", "48% to 60%", or "about 5" when both ends round alike; `places` decimals. */
export function usualWords(low, high, per10, places = 0) {
  const unit = per10 ? '' : '%'
  const at = (x) => (Math.round(x * 10 ** places) / 10 ** places).toFixed(places)
  const a = at(low)
  const b = at(high)
  return a === b ? `about ${a}${unit}` : `${a}${unit} to ${b}${unit}`
}

/**
 * A swing row as bands: each one's average plus and minus its swing, so
 * a narrower band is a steadier player. Null for a run from before the
 * averages were sent, which keeps the old row.
 *
 * `against` names the band the line compares with the group ('your
 * style', or 'you' for a style of one; null with no line) and `way` is
 * the line's direction ('lower' calls that band steadier). When whole
 * numbers would show the steadier band no narrower -- a tie, or a flip
 * -- the whole row shows one decimal.
 */
export function swingBands(row, measure, against = null, way = null) {
  const centre = row.center
  if (!centre || centre.you === null || row.you === null) return null
  const per10 = measure.as === 'swing-per10'
  const times = per10 ? 10 : 100
  const top = per10 ? Infinity : 100
  const bands = [['you', centre.you, row.you, true], ['your style', centre.style, row.style, false], ['similar players', centre.group, row.group, false]]
    .filter(([, average, swing]) => average !== null && average !== undefined && swing !== null && swing !== undefined)
    .map(([who, average, swing, mine]) => ({ who, mine, low: Math.max(0, (average - swing) * times), high: Math.min(top, (average + swing) * times) }))
  const whole = (band) => (band ? Math.round(band.high) - Math.round(band.low) : null)
  const compared = whole(bands.find((band) => band.who === against))
  const group = whole(bands.find((band) => band.who === 'similar players'))
  const hidden = compared !== null && group !== null && (way === 'lower' ? compared >= group : group >= compared)
  for (const band of bands) band.words = usualWords(band.low, band.high, per10, hidden ? 1 : 0)
  const step = per10 ? 1 : 10
  let lo = Math.floor(Math.min(...bands.map((band) => band.low)) / step) * step
  let hi = Math.ceil(Math.max(...bands.map((band) => band.high)) / step) * step
  // Every band at one whole value would leave a scale with no width:
  // widen it upwards, or downwards for a share already at 100%.
  if (hi === lo) {
    if (hi < top) hi += step
    else lo -= step
  }
  return { bands, lo, hi, unit: per10 ? '' : '%' }
}

/** The line under a swing row: steadier or swinging more than the group. */
export function swingLine(way, styleSize) {
  if (styleSize === 1) return way === 'lower' ? 'You: steadier than others' : 'You: swing more than others'
  return way === 'lower' ? 'Your style: steadier than others' : 'Your style: swings more than others'
}
