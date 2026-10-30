// ============================================================
// Which open play courts this phone may start, in plain functions so
// scripts/check-courts.mjs can run them under plain node.
// ============================================================

const LEAD_MS = 60 * 60_000 // matches COURT_LEAD_MS on the server
const HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true })

// Minutes only when not :00, the same rule as session names.
const hourParts = (iso) => {
  const parts = Object.fromEntries(HOUR.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return [parts.minute === '00' ? parts.hour : `${parts.hour}:${parts.minute}`, parts.dayPeriod]
}

/** "6–9 PM", "6:30–9 PM", or "10 AM–2:30 PM" across noon. */
export function hoursWords(startsAt, endsAt) {
  const [from, fromHalf] = hourParts(startsAt)
  const [to, toHalf] = hourParts(endsAt)
  return fromHalf === toHalf ? `${from}–${to} ${toHalf}` : `${from} ${fromHalf}–${to} ${toHalf}`
}

/** Courts this umpire may start now: theirs or nobody's, not started, not already started on this phone. Theirs first. */
export function startableCourts(openPlays, sessions, now) {
  const here = new Set(sessions.filter((s) => s.openPlayId && s.court && !s.voidedAt).map((s) => `${s.openPlayId}:${s.court}`))
  return openPlays
    .filter((p) => now >= Date.parse(p.startsAt) - LEAD_MS && now <= Date.parse(p.endsAt))
    .flatMap((p) => p.courts
      .filter((c) => c.assignedTo !== 'other' && !c.started && !here.has(`${p.id}:${c.court}`))
      .map((c) => ({ openPlayId: p.id, court: c.court, mine: c.assignedTo === 'me', startsAt: p.startsAt, endsAt: p.endsAt })))
    .sort((a, b) => Number(b.mine) - Number(a.mine) || a.startsAt.localeCompare(b.startsAt) || a.court - b.court)
}
