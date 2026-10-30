// ============================================================
// The one rule that names a session  —  SHARED by the api and the app
//
// Lives here, not in src/, for the same deploy reason as pickleball.js:
// the Railway api builds from server/ only, while the app build can
// reach in here. One copy, so the name an umpire sees on the phone is
// the name the server stores.
//
// Manila time always: the phone's own zone must not change a name.
// ============================================================

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
})

/** "Open Play · Court 2 · Fri Oct 30, 6 PM", or "Session · Fri Oct 30, 6:10 PM" without a court. */
export function sessionName({ startsAt, court = null }) {
  const part = Object.fromEntries(PARTS.formatToParts(new Date(startsAt)).map((p) => [p.type, p.value]))
  const time = `${part.hour}${part.minute === '00' ? '' : `:${part.minute}`} ${part.dayPeriod}`
  const when = `${part.weekday} ${part.month} ${part.day}, ${time}`
  return court ? `Open Play · Court ${court} · ${when}` : `Session · ${when}`
}
