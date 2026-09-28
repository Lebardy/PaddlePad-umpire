// ============================================================
// A player's matches as months and nights, and the one small line under
// each match row.
//
// A night is the evening at the courts: the same calendar date on the
// phone AND the same session. Two sessions on one date are two nights,
// because they are two different groups of people. Everything here reads
// the list newest first and groups consecutive runs, which is the order
// the server sends it in.
//
// Kept out of the components so the rules can be checked without a
// browser: node player/scripts/check-nights.mjs.
// ============================================================

import { formatDate } from './format.js'
import { matchStory } from './story.js'

const pad = (n) => String(n).padStart(2, '0')
const monthKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const dayKeyOf = (d) => `${monthKeyOf(d)}-${pad(d.getDate())}`

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long' })
const NIGHT = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

/** "3–2": wins then losses. A match with no result counts for neither. */
export function recordText(matches) {
  const won = matches.filter((m) => m.won === true).length
  const lost = matches.filter((m) => m.won === false).length
  return `${won}–${lost}`
}

/** "September", or "August 2025" when it isn't this year. */
export function monthLabel(iso, now = new Date()) {
  const d = new Date(iso)
  const name = MONTH.format(d)
  return d.getFullYear() === now.getFullYear() ? name : `${name} ${d.getFullYear()}`
}

/** "Sat, Sep 12". */
export function nightLabel(iso) {
  return NIGHT.format(new Date(iso))
}

function runs(list, keyOf) {
  const out = []
  for (const item of list) {
    const key = keyOf(item)
    if (out.length === 0 || out.at(-1).key !== key) out.push({ key, items: [] })
    out.at(-1).items.push(item)
  }
  return out
}

/**
 * Months, each holding its nights (or null when `nights` is false: a
 * filtered list, where a night's record would leave out the matches the
 * filter hid, and a person's page, where one night rarely holds more than
 * one match with them).
 */
export function groupMatches(matches, { nights = true } = {}) {
  return runs(matches, (m) => monthKeyOf(new Date(m.endedAt))).map((month) => ({
    key: month.key,
    label: monthLabel(month.items[0].endedAt),
    matches: month.items,
    record: recordText(month.items),
    nights: nights
      ? runs(month.items, (m) => `${dayKeyOf(new Date(m.endedAt))}|${m.sessionName ?? ''}`).map((night) => ({
          key: night.key,
          label: nightLabel(night.items[0].endedAt),
          sessionName: night.items[0].sessionName ?? null,
          matches: night.items,
          record: recordText(night.items),
        }))
      : null,
  }))
}

/**
 * The small line under a match row: who with, anything unusual about the
 * game, and the one thing worth saying about it. Dated when the row has
 * no night heading above it to carry the date.
 */
export function matchLine(match, { dated = false } = {}) {
  const story = matchStory(match.progression, match.won, match.pointTarget)
  return [
    dated ? formatDate(match.endedAt) : null,
    match.partner ? `with ${match.partner}` : 'singles',
    // Only when it wasn't the usual 11, so a 15-13 score doesn't read as
    // a game that ran unusually long.
    match.pointTarget && match.pointTarget !== 11 ? `to ${match.pointTarget}` : null,
    match.endedEarly ? 'stopped early' : null,
    story,
  ].filter(Boolean).join(' · ')
}
