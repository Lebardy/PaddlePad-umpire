// ============================================================
// The Leaderboard tab's wording and arithmetic, kept out of the
// components so player/scripts/check-leaderboard.mjs can prove it.
// ============================================================

const fmt = new Intl.NumberFormat('en-US')

export function ordinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`
}

/** "12 Jul", in the phone's own time zone (Manila for PaddlePad's players). */
export function shortDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// The ladder: rows sit apart by the real PPR gap, to scale, but a single
// runaway gap can't push everyone else off the screen. Sized for the
// chess scale (a quarter of the old 1.1px per PPR, and a label from 52
// PPR rather than 13), so the ladder looks as it did.
export const GAP_PX_PER_POINT = 0.275
export const GAP_MAX_PX = 48
export const GAP_LABEL_MIN = 52

export function gapBefore(prevPoints, points) {
  const gap = prevPoints - points
  return {
    px: Math.min(Math.round(gap * GAP_PX_PER_POINT * 10) / 10, GAP_MAX_PX),
    label: gap >= GAP_LABEL_MIN ? `${fmt.format(gap)} PPR gap` : null,
  }
}

/** The words on the black board above the ladder. */
export function standingWords(you) {
  // Off the ranking (too few matches, or away too long): no place to show.
  if (you.state !== 'on') return null
  let line = 'Nobody is above you.'
  if (you.behind) {
    const { points, name, others, place } = you.behind
    const tie = others > 0 ? ` and ${others} ${others === 1 ? 'other' : 'others'}` : ''
    line = `${fmt.format(points)} PPR behind ${name}${tie} in ${ordinal(place)}.`
  }
  return { place: ordinal(you.place), of: you.of, line, sub: null }
}

// The glide down to your row when the tab opens.
export function glideTarget(rowTop, rowHeight, boxHeight, maxScroll) {
  return Math.min(Math.max(rowTop - boxHeight / 2 + rowHeight / 2, 0), maxScroll)
}
export function glideDuration(distance) {
  return Math.min(Math.max(distance * 1.6, 700), 1300)
}
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export const STEP_UP_WORDS = {
  ppr: { label: 'PPR gained', icon: 'trendUp', note: null },
  shots: { label: 'Shots per mistake', icon: 'target', note: 'winning shots per mistake' },
  mistakes: { label: 'Fewer mistakes', icon: 'shield', note: 'of their rallies ended by their own mistake' },
  winRate: { label: 'Win rate', icon: 'trophy', note: 'of matches won' },
  rallies: { label: 'Rallies won', icon: 'bolt', note: 'of rallies won by their side' },
}

const SHARES = new Set(['mistakes', 'winRate', 'rallies'])

export function stepUpFigure(key, figures) {
  if ('change' in figures) {
    if (key === 'ppr') return `+${fmt.format(figures.change)} PPR`
    if (key === 'shots') return `+${figures.change}%`
    if (key === 'mistakes') return `${figures.change} points fewer`
    return `+${figures.change} points`
  }
  if (key === 'shots') {
    const side = (v) => (v === null ? 'no mistakes' : String(v))
    return `${side(figures.before)} → ${side(figures.now)}`
  }
  if (SHARES.has(key)) return `${figures.before}% → ${figures.now}%`
  return ''
}

/** "Ana", "Ana and Ben", "Ana, Ben, Cy and 2 more". */
export function namesList({ names, more }) {
  if (more > 0) return `${names.join(', ')} and ${more} more`
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
