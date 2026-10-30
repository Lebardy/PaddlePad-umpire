// ============================================================
// How the playstyle card reads its numbers.
//
// Kept apart from the screen so the wording can be checked without a
// browser: node player/scripts/check-style-proof.mjs.
//
// The card's words, takeaway and corners come from the server; this only
// says how each corner's number is shown and how many share the style.
// ============================================================

import { styleName } from './styleName.js'

// `as` says how a corner's number reads (the feature names belong to the
// model; a player never meets `winner_rate_std`):
//   percent        a share, shown as 19%
//   ratio          shown as 0.85
//   swing-percent  how much a share changes from match to match (the
//                  spread of a proportion), shown as ±12%
//   swing-per10    how much a per-minute count changes from match to
//                  match, shown per 10 minutes as ±0.9 -- ten minutes is
//                  roughly a game, a length people already think in
//   share          also a percent, but a low-side word (Driver, Power Player)
//                  names the other side, so it shows 1 - value

export const MEASURES = {
  drop_efficiency_mean: { as: 'percent' },
  error_to_winner_ratio: { as: 'ratio' },
  // The share of a player's finishes (winners and mistakes) that were
  // winners: how cleanly they finish, not how often they attack.
  aggression_std: { as: 'swing-percent' },
  drop_efficiency_std: { as: 'swing-percent' },
  winner_rate_std: { as: 'swing-per10' },
  general_error_rate_std: { as: 'swing-per10' },
  dink_error_rate_std: { as: 'swing-per10' },
  drop_preference_rate_mean: { as: 'percent', share: true },
  net_game_preference_rate_mean: { as: 'percent', share: true },
}

/**
 * The one line saying how many share the style.
 * Not the group's size: the plate counts the level, and a group can span levels.
 */
export function styleShareLine(styleSize, groupSize) {
  if (!groupSize) return null
  if (!styleSize) return 'Compared with similar players'
  if (styleSize === 1) return 'Nobody else plays this way yet'
  if (styleSize === 2) return 'You and 1 other play this way'
  return `${styleSize} play this way`
}

/**
 * A corner's number as the table shows it, so the row agrees with its word:
 * a low-side shot-choice word shows the side it names (drives, not drops).
 */
export function shownNumber(value, corner) {
  if (value === null || value === undefined) return null
  return MEASURES[corner.feature]?.share && corner.out === 'lower' ? 1 - value : value
}

/** True when a smaller number means more of the word (Clean, the steadiness swings), so the table adds a down arrow. */
export function lowerIsMore(corner) {
  return corner.out === 'lower' && !(MEASURES[corner.feature]?.share)
}

/** The gentle line about the level above: text before, the bold style name, text after. Null when there is none. */
export function metaLine(meta, ownStyle, group) {
  if (!meta) return null
  return meta.style === ownStyle
    ? { before: 'Your style is the most common one level up.' }
    : { before: 'At the next level up, many play as ', style: `${styleName(meta.style, group)}s`, after: '.' }
}
