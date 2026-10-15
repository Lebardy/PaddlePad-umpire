// ============================================================
// The Guests page: the open-play form's choices and the words it
// shows. Pure, so scripts/check-guests.mjs proves it.
//
// Manila keeps UTC+8 all year (no daylight saving), so a time there is
// the UTC time plus 8 hours, read with the UTC getters.
// ============================================================

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MANILA = 8 * HOUR
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const manila = (at) => new Date(new Date(at).getTime() + MANILA)
const dayText = (at) => `${DAYS[manila(at).getUTCDay()]}, ${MONTHS[manila(at).getUTCMonth()]} ${manila(at).getUTCDate()}`
const hourText = (hour) => `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`
const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ value: from + i, label: hourText(from + i) }))

/** Today and the six days after it, each valued at its Manila midnight. */
export function dayOptions(now) {
  const shifted = now + MANILA
  const today = shifted - (shifted % DAY) - MANILA
  return Array.from({ length: 7 }, (_, i) => {
    const value = new Date(today + i * DAY).toISOString()
    return { value, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayText(value) }
  })
}

/** Open play starts at 6 am at the earliest and runs at least an hour, so 10 pm is the last start. */
export const startHours = hours(6, 22)

/** From an hour after `start` to eight hours after it, but never past 11 pm. */
export function endHours(start) {
  return hours(start + 1, Math.min(start + 8, 23))
}

export function toIso(dayValue, hour) {
  return new Date(Date.parse(dayValue) + hour * HOUR).toISOString()
}

export function spotsFor(courts) {
  return Number.isInteger(courts) && courts > 0 ? courts * 8 : ''
}

/** "4 Advanced · 7 Developing · 1 new": the levels come highest first. */
export function levelWords(levels, newCount) {
  return [...(levels ?? []).map((l) => `${l.count} ${l.name}`), ...(newCount > 0 ? [`${newCount} new`] : [])].join(' · ')
}

/** The Who's coming cell: the levels, or just how many when there are no clear levels. */
export function comingWords({ count, levels, newCount }) {
  return levelWords(levels, newCount) || (count > 0 ? `${count} going` : '—')
}

/** The visit score, shown from 3 ratings. */
export function scoreWords({ rated, average }) {
  if (rated === 0) return { figure: null, words: 'No ratings yet' }
  if (average == null) return { figure: null, words: `${rated} rated so far` }
  return { figure: average.toFixed(1), words: `${rated} rated · last 30 days` }
}

export function feeWords(centavos) {
  if (centavos == null) return 'Free'
  return `₱${(centavos / 100).toLocaleString('en-US', { minimumFractionDigits: centavos % 100 ? 2 : 0 })}`
}

/** "Sat, Oct 17 · 6–9 AM", or "10 AM–2 PM" across noon. */
export function whenWords(startsAt, endsAt) {
  const from = manila(startsAt).getUTCHours()
  const to = manila(endsAt).getUTCHours()
  const sameHalf = (from < 12) === (to < 12)
  return `${dayText(startsAt)} · ${sameHalf ? from % 12 || 12 : hourText(from)}–${hourText(to)}`
}
