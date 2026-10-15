// ============================================================
// Open play and visit ratings: every rule, with no database, so
// scripts/check-visits.mjs proves them.
//
// Manila keeps UTC+8 all year (no daylight saving), so an hour of the
// day there is the UTC hour plus 8.
// ============================================================

import { pesosToCentavos } from './facility-rules.js'
import { LADDER } from './levels.js'

export const FIRST_HOUR = 6
export const LAST_END = 23
export const DAYS_AHEAD = 7
export const MAX_HOURS = 8
export const MAX_COURTS = 20
export const MAX_SPOTS = 200
export const MAX_FEE_CENTAVOS = 10_000_000
export const NOTE_MAX = 60
export const RATE_DAYS = 7
export const MIN_RATED = 3
export const CHIPS = ['Courts', 'Staff', 'Waiting', 'Price', 'Cleanliness']

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MANILA = 8 * HOUR
const iso = (value) => new Date(value).toISOString()

/** The hour of the day in Manila, 0-23. */
export function manilaHour(date) {
  return new Date(date.getTime() + MANILA).getUTCHours()
}

/** Midnight in Manila on the day `date` falls on. */
export function manilaDayStart(date) {
  const shifted = date.getTime() + MANILA
  return new Date(shifted - (shifted % DAY) - MANILA)
}

/** The end of "this week": midnight after the seventh day, counting today. */
export function weekEnd(now) {
  return new Date(manilaDayStart(now).getTime() + DAYS_AHEAD * DAY)
}

function wholeHour(value) {
  const at = new Date(typeof value === 'string' ? value : NaN)
  return Number.isNaN(at.getTime()) || at.getTime() % HOUR !== 0 ? null : at
}

const within = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

/** An open play from the admin form: `{ values }` or `{ error }` in words. */
export function readOpenPlay(body = {}, now) {
  const start = wholeHour(body.startsAt)
  if (!start) return { error: 'Pick a day and a start hour' }
  const end = wholeHour(body.endsAt)
  if (!end) return { error: 'Pick an end hour' }
  if (start <= now) return { error: 'That time has passed' }
  if (start >= weekEnd(now)) return { error: 'Pick a day in the next 7 days' }
  if (manilaHour(start) < FIRST_HOUR) return { error: 'Start at 6 am or later' }
  const hours = (end - start) / HOUR
  if (hours < 1) return { error: 'End after it starts' }
  if (hours > MAX_HOURS) return { error: 'Open play can last up to 8 hours' }
  if (manilaDayStart(end).getTime() !== manilaDayStart(start).getTime() || manilaHour(end) > LAST_END) {
    return { error: 'End by 11 pm' }
  }
  if (!within(body.courts, 1, MAX_COURTS)) return { error: 'Courts: 1 to 20' }
  if (!within(body.spots, 2, MAX_SPOTS)) return { error: 'Spots: 2 to 200' }
  const fee = pesosToCentavos(body.fee)
  if (fee === undefined || fee > MAX_FEE_CENTAVOS) return { error: 'Enter the fee in pesos, or leave it empty for free' }
  if (typeof body.umpire !== 'boolean') return { error: 'Say whether an umpire is on duty' }
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if (note.length > NOTE_MAX) return { error: 'Keep the note to 60 characters' }
  return {
    values: {
      startsAt: start, endsAt: end, courts: body.courts, spots: body.spots,
      feeCentavos: fee || null, umpire: body.umpire, note: note || null,
    },
  }
}

/** A visit rating from the app: `{ values }` or `{ error }`. Chips come back de-duplicated, in the usual order. */
export function readRating(body = {}) {
  const { score, chips = [] } = body
  if (!Number.isInteger(score) || score < 1 || score > 5) return { error: 'Pick a face' }
  if (!Array.isArray(chips) || chips.some((chip) => !CHIPS.includes(chip))) {
    return { error: 'Pick from Courts, Staff, Waiting, Price and Cleanliness' }
  }
  return { values: { score, chips: CHIPS.filter((chip) => chips.includes(chip)) } }
}

/** Whether a visit can still be rated: a place, not voided, played in within 7 days. */
export function ratingOpen({ facilityId, voided, lastPlayedAt }, now) {
  return Boolean(facilityId) && !voided && lastPlayedAt != null && now - new Date(lastPlayedAt) <= RATE_DAYS * DAY
}

/** Why this player can't join, in words, or null when they can. Drop-ins are fine until it ends. */
export function joinRefusal({ endsAt, spots, count, you }, now) {
  if (new Date(endsAt) <= now) return 'This open play is over'
  if (!you && count >= spots) return 'This open play is full'
  return null
}

/**
 * One open play as an app shows it. `joined` holds the active players
 * going; `levelOf(id)` gives a level name or null ("new"); `levelsShown`
 * is false when the latest run has no clear levels, and then no level
 * words go out at all; `named` maps the ids the viewer may see named.
 */
export function openPlayRow(play, { joined, viewerId = null, levelOf, levelsShown, named = new Map() }) {
  const ids = [...new Set(joined)]
  const tally = new Map()
  let newCount = 0
  if (levelsShown) {
    for (const id of ids) {
      const name = levelOf(id)
      if (name) tally.set(name, (tally.get(name) ?? 0) + 1)
      else newCount += 1
    }
  }
  const yours = levelsShown && viewerId ? levelOf(viewerId) : null
  const others = ids.filter((id) => id !== viewerId)
  return {
    id: play.id,
    facility: { id: play.facilityId, name: play.facilityName },
    startsAt: iso(play.startsAt),
    endsAt: iso(play.endsAt),
    courts: play.courts,
    spots: play.spots,
    feeCentavos: play.feeCentavos ?? null,
    umpire: play.umpire,
    note: play.note ?? null,
    count: ids.length,
    atYourLevel: yours ? others.filter((id) => levelOf(id) === yours).length : null,
    levels: levelsShown ? LADDER.filter((name) => tally.has(name)).reverse().map((name) => ({ name, count: tally.get(name) })) : null,
    newCount,
    names: others.filter((id) => named.has(id)).map((id) => named.get(id)).sort((a, b) => a.localeCompare(b)),
    you: viewerId != null && ids.includes(viewerId),
  }
}

/** How visits went: the given ratings summed. No average below 3 ratings. */
export function visitSummary(ratings) {
  const faces = [0, 0, 0, 0, 0]
  const good = new Map()
  const better = new Map()
  for (const { score, chips } of ratings) {
    faces[score - 1] += 1
    const side = score >= 4 ? good : better
    for (const chip of chips) side.set(chip, (side.get(chip) ?? 0) + 1)
  }
  const inOrder = (tally) => Object.fromEntries(CHIPS.filter((chip) => tally.has(chip)).map((chip) => [chip, tally.get(chip)]))
  const total = ratings.reduce((sum, { score }) => sum + score, 0)
  return {
    rated: ratings.length,
    average: ratings.length >= MIN_RATED ? Math.round((total / ratings.length) * 10) / 10 : null,
    faces,
    good: inOrder(good),
    better: inOrder(better),
  }
}

/** The Guests totals. `plays` are this week's, soonest first, each with its `joined` ids. */
export function guestsTotals(plays) {
  const going = (play) => new Set(play.joined).size
  const next = plays[0]
  return {
    coming: new Set(plays.flatMap((play) => play.joined)).size,
    openPlays: plays.length,
    taken: plays.reduce((sum, play) => sum + going(play), 0),
    spots: plays.reduce((sum, play) => sum + play.spots, 0),
    next: next ? { startsAt: iso(next.startsAt), endsAt: iso(next.endsAt), count: going(next), spots: next.spots } : null,
  }
}

const DAY_WORDS = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' })
const clock = (date) => {
  const hour = manilaHour(new Date(date))
  return [hour % 12 || 12, hour < 12 ? 'AM' : 'PM']
}

/** An open play in words for the activity record: "Sat, Oct 17 · 6–9 AM", or "10 AM–2 PM" across noon. */
export function openPlayWhen(startsAt, endsAt) {
  const [from, fromHalf] = clock(startsAt)
  const [to, toHalf] = clock(endsAt)
  return `${DAY_WORDS.format(new Date(startsAt))} · ${fromHalf === toHalf ? from : `${from} ${fromHalf}`}–${to} ${toHalf}`
}
