// ============================================================
// Open play courts at a place: which courts an open play uses, clashes
// with the place's other open plays, and what an edit may change. Pure,
// checked offline by scripts/check-open-play-courts.mjs.
//
// A "play" here is { id, startsAt, endsAt, courtNumbers, spots,
// feeCentavos, umpire, note }; courtNumbers are sorted.
// ============================================================

import { openPlayWhen } from './visit-rules.js'

const t = (value) => new Date(value).getTime()

/** Whether two open plays share any time; one ending as the other starts does not. */
export const overlaps = (a, b) => t(a.startsAt) < t(b.endsAt) && t(b.startsAt) < t(a.endsAt)

/** The courts `others` hold during `play`'s hours: court -> the open play holding it. `play` itself is skipped. */
export function takenCourts(play, others) {
  const taken = new Map()
  for (const other of others) {
    if (other.id === play.id || !overlaps(play, other)) continue
    for (const court of other.courtNumbers) if (!taken.has(court)) taken.set(court, other)
  }
  return taken
}

/** The lowest of `play`'s courts another open play holds then, or null. */
export function courtClash(play, others) {
  const taken = takenCourts(play, others)
  const court = play.courtNumbers.find((n) => taken.has(n))
  if (court === undefined) return null
  return { court, startsAt: taken.get(court).startsAt, endsAt: taken.get(court).endsAt }
}

export const clashText = ({ court, startsAt, endsAt }) => `Court ${court} is taken by the ${openPlayWhen(startsAt, endsAt)} open play`

/** For a caller that sends how many courts, not which: the lowest free ones, or null when too few are free. */
export function lowestFreeCourts(play, count, courtCount, others) {
  const taken = takenCourts(play, others)
  const free = Array.from({ length: courtCount }, (_, i) => i + 1).filter((n) => !taken.has(n))
  return free.length >= count ? free.slice(0, count) : null
}

/** Why the place's court count can't become `count` (null clears it), or null. `upcoming` are open plays not yet ended, soonest first. */
export function courtCountRefusal(count, upcoming) {
  for (const play of upcoming) {
    const over = play.courtNumbers.find((n) => count == null || n > count)
    if (over !== undefined) return `Court ${over} is in the ${openPlayWhen(play.startsAt, play.endsAt)} open play`
  }
  return null
}

/**
 * Why an edit can't be saved, or null. `before` is the open play as
 * stored, `after` the form's values; `going` counts active players
 * going; `startedCourts` are courts with a live session, in order.
 */
export function editRefusal(before, after, { now, going, startedCourts }) {
  const at = now.getTime()
  if (t(before.endsAt) <= at) return 'This open play is over'
  if (t(before.startsAt) <= at && t(after.startsAt) !== t(before.startsAt)) return 'It has started, so its day and start stay'
  if (t(after.endsAt) <= at) return 'That end has passed'
  const kept = startedCourts.find((n) => !after.courtNumbers.includes(n))
  if (kept !== undefined) return `Court ${kept} has started, so it stays`
  // Spots are at least 2, so this only bites from 3 going: always plural.
  if (after.spots < going) return `${going} players are going, so keep at least ${going} spots`
  if (before.umpire && !after.umpire && startedCourts.length > 0) return 'Courts have started, so the umpire stays on duty'
  return null
}

export const timeChanged = (before, after) => t(before.startsAt) !== t(after.startsAt) || t(before.endsAt) !== t(after.endsAt)

/** What an edit changed, for the activity record. Empty when nothing did. */
export function openPlayChanges(before, after) {
  const changes = []
  if (timeChanged(before, after)) changes.push(`time to ${openPlayWhen(after.startsAt, after.endsAt)}`)
  if (before.courtNumbers.join() !== after.courtNumbers.join()) changes.push(`courts to ${after.courtNumbers.join(', ')}`)
  if (before.spots !== after.spots) changes.push(`spots to ${after.spots}`)
  if ((before.feeCentavos ?? null) !== (after.feeCentavos ?? null)) changes.push('fee')
  if (before.umpire !== after.umpire) changes.push(after.umpire ? 'umpire on duty' : 'no umpire')
  if ((before.note ?? null) !== (after.note ?? null)) changes.push('note')
  return changes
}
