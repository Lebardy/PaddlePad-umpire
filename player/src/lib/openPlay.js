// ============================================================
// Open play in words: the day, the hours, the fee and who's coming.
// The server's visit-rules.js says the same things for the admin site.
//
// Manila keeps UTC+8 all year (no daylight saving), so a time there is
// the UTC time plus 8 hours, read with the UTC getters.
//
//   node player/scripts/check-open-play.mjs
// ============================================================

const MANILA = 8 * 3_600_000
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const manila = (iso) => new Date(new Date(iso).getTime() + MANILA)

/** The left tile on a place page: { day: 'Sat', date: '17' }. */
export function dayTile(iso) {
  const at = manila(iso)
  return { day: DAYS[at.getUTCDay()], date: String(at.getUTCDate()) }
}

/** "Sat, Oct 17". */
export function dayHeading(iso) {
  const at = manila(iso)
  return `${DAYS[at.getUTCDay()]}, ${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`
}

const clock = (iso) => {
  const hour = manila(iso).getUTCHours()
  return [hour % 12 || 12, hour < 12 ? 'am' : 'pm']
}

/** "6–9 am", or "11 am–1 pm" across noon. Open play is in whole hours. */
export function timeSpan(startIso, endIso) {
  const [from, fromHalf] = clock(startIso)
  const [to, toHalf] = clock(endIso)
  return `${fromHalf === toHalf ? from : `${from} ${fromHalf}`}–${to} ${toHalf}`
}

export function courtsWords(n) {
  return `${n} ${n === 1 ? 'court' : 'courts'}`
}

/** "₱150 · pay when you arrive", or "Free" with no fee. */
export function feeWords(centavos) {
  if (centavos == null) return 'Free'
  const pesos = (centavos / 100).toLocaleString('en-US', { minimumFractionDigits: centavos % 100 ? 2 : 0 })
  return `₱${pesos} · pay when you arrive`
}

/**
 * Who's coming, as the row's foot says it: "N at your level" when there
 * are some, otherwise the levels coming ("Advanced · new"); nothing about
 * levels when the latest run has none. Then up to two first names the
 * viewer knows and "+N" for everyone else but the viewer.
 */
export function whoWords(row) {
  const level = row.atYourLevel > 0 ? `${row.atYourLevel} at your level` : null
  const words = row.levels ? [...row.levels.map((l) => l.name), ...(row.newCount > 0 ? ['new'] : [])] : []
  const shown = row.names.slice(0, 2).map((name) => name.split(' ')[0])
  const rest = row.count - shown.length - (row.you ? 1 : 0)
  return {
    level,
    mix: !level && row.count > 0 && words.length > 0 ? words.join(' · ') : null,
    empty: row.count === 0 ? 'Nobody yet. Be the first.' : null,
    names: shown.length > 0 ? `${shown.join(', ')}${rest > 0 ? ` +${rest}` : ''}` : null,
  }
}

/** The one button: 'going' (tap to leave), 'full' or 'join'. */
export function buttonState(row) {
  if (row.you) return 'going'
  return row.count >= row.spots ? 'full' : 'join'
}
