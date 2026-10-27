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
//   per10          a per-minute count, shown per 10 minutes as 1.4
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
  drop_usage_rate: { label: 'drops per 10 min', as: 'per10', better: 'neither' },
  drop_preference_rate_mean: { label: 'drops rather than drives', as: 'percent', better: 'neither' },
  drop_preference_rate_std: { label: 'change in choosing drops, match to match', thing: 'choosing drops over drives', as: 'swing-percent', better: 'neither' },
  net_game_preference_rate_mean: { label: 'points won at the net', as: 'percent', better: 'neither' },
  net_game_preference_rate_std: { label: 'change in points won at the net, match to match', thing: 'points won at the net', as: 'swing-percent', better: 'neither' },
}

/**
 * The one line saying how many share the style.
 * Not the group's size: the plate counts the level, and a group can span levels.
 */
export function styleShareLine(styleSize, groupSize) {
  if (!groupSize) return null
  if (!styleSize) return 'Compared with similar players'
  if (styleSize === 1) return 'No similar player plays this way yet'
  if (styleSize === 2) return 'You and 1 other play this way'
  return `${styleSize} play this way`
}

/** The one note under a style of two, saying why its average is missing. */
export function hiddenStyleNote(styleSize) {
  return styleSize === 2
    ? 'Your style’s average is hidden: with 2 players it would reveal the other’s numbers.'
    : null
}
