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
//
// `says(way)` finishes "Compared with your group, players with your
// style …" for a style that sits higher or lower than its group.
export const MEASURES = {
  drop_efficiency_mean: {
    label: 'drop shots landing', as: 'percent', better: 'higher',
    says: (way) => `land their drop shots ${way === 'higher' ? 'more' : 'less'} often`,
  },
  error_to_winner_ratio: {
    label: 'mistakes per winning shot', as: 'ratio', better: 'lower',
    says: (way) => `make ${way === 'higher' ? 'more' : 'fewer'} mistakes for every winning shot`,
  },
  // The share of a player's finishes (winners and mistakes) that were
  // winners: how cleanly they finish, not how often they attack.
  aggression_std: {
    label: 'change in how many of your finishes are winners, match to match', as: 'swing-percent', better: 'neither',
    says: (way) => `change ${way === 'higher' ? 'more' : 'less'} from match to match in how many of their finishes are winners`,
  },
  drop_efficiency_std: {
    label: 'change in drops landing, match to match', as: 'swing-percent', better: 'neither',
    says: (way) => `change ${way === 'higher' ? 'more' : 'less'} from match to match in how well their drops land`,
  },
  winner_rate_std: {
    label: 'change in winning shots per 10 min, match to match', as: 'swing-per10', better: 'neither',
    says: (way) => `change ${way === 'higher' ? 'more' : 'less'} from match to match in how many winning shots they hit`,
  },
  general_error_rate_std: {
    label: 'change in mistakes per 10 min, match to match', as: 'swing-per10', better: 'neither',
    says: (way) => `change ${way === 'higher' ? 'more' : 'less'} from match to match in how many mistakes they make`,
  },
  dink_error_rate_std: {
    label: 'change in net mistakes per 10 min, match to match', as: 'swing-per10', better: 'neither',
    says: (way) => `change ${way === 'higher' ? 'more' : 'less'} from match to match in how many mistakes they make at the net`,
  },
  drop_usage_rate: {
    label: 'third shots that are drops', as: 'percent', better: 'neither',
    says: (way) => `use drops for ${way === 'higher' ? 'more' : 'fewer'} of their third shots`,
  },
  drop_preference_rate_mean: {
    label: 'drops rather than drives', as: 'percent', better: 'neither',
    says: (way) => `choose drops over drives ${way === 'higher' ? 'more' : 'less'} often`,
  },
  drop_preference_rate_std: {
    label: 'change in choosing drops, match to match', as: 'swing-percent', better: 'neither',
    says: (way) => `change ${way === 'higher' ? 'more' : 'less'} from match to match in choosing drops over drives`,
  },
  net_game_preference_rate_mean: {
    label: 'points won at the net', as: 'percent', better: 'neither',
    says: (way) => `win ${way === 'higher' ? 'more' : 'fewer'} of their points at the net`,
  },
  net_game_preference_rate_std: {
    label: 'change in points won at the net, match to match', as: 'swing-percent', better: 'neither',
    says: (way) => `change ${way === 'higher' ? 'more' : 'less'} from match to match in how many points they win at the net`,
  },
}

/** The end of "Compared with the N players closest to your level — …". */
export function styleShareLine(styleSize) {
  if (!styleSize) return null
  if (styleSize === 1) return 'no one else has your style yet'
  if (styleSize === 2) return 'you and 1 other player share your style'
  return `${styleSize} of them, you included, share your style`
}

/**
 * Which way the "that's why it's called …" sentence points: 'higher',
 * 'lower', or null for no sentence.
 *
 * The word was chosen from where the STYLE sits against its group, so
 * three or more read the style's average. A style of one is the player,
 * but the word was chosen from their numbers with skill taken out, and
 * the page shows the numbers as they were: when those point against the
 * word, no sentence is better than one the bars beside it contradict. A
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

/** Who "Compared with your group, … " is about. */
export function verdictSubject(styleSize) {
  return styleSize === 1 ? 'you' : 'players with your style'
}

/**
 * A measure's sentence said about the player rather than their style:
 * every `says` is written about "they", and for a style of one that is
 * the player themselves.
 */
export function aboutYou(text) {
  return text.replace(/\btheir\b/g, 'your').replace(/\bthey\b/g, 'you').replace(/\bthem\b/g, 'you')
}

/** The one note under a style of two, saying why its average is missing. */
export function hiddenStyleNote(styleSize) {
  return styleSize === 2
    ? 'Your style has just 2 players, so its average isn’t shown: it would give away the other player’s numbers.'
    : null
}
