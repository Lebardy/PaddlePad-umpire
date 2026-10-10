// ============================================================
// Words and counts for a manager's home page. Pure, so they can be
// checked without a browser (scripts/check-manager-home.mjs).
// ============================================================

import { countWord, dayHeading } from './format.js'

/** What the three facts don't already show as "Not set", or null when nothing is missing. */
export function missingLine(facility) {
  const missing = [!facility.logoUrl && 'logo', !facility.locationUrl && 'map link'].filter(Boolean)
  return missing.length > 0 ? `Missing: ${missing.join(', ')}.` : null
}

/** The three facts under Your place, each with "Not set" when empty. */
export function placeFacts(facility) {
  return [
    { label: 'Open', value: facility.openingHours ?? 'Not set' },
    { label: 'Court fee', value: facility.hourlyFeeCentavos == null ? 'Not set' : facility.feeText },
    { label: 'Umpire fee', value: facility.umpireFeeText ?? 'Not set' },
  ]
}

/** One line per umpire: this week's matches, or the last day they scored when there are none. */
export function umpireLine(umpire, now = Date.now()) {
  if (umpire.weekMatches > 0) return `${countWord(umpire.weekMatches, 'match', 'matches')} this week`
  return umpire.lastScoredAt ? `Last scored ${dayHeading(umpire.lastScoredAt, now)}` : 'Hasn’t scored yet'
}

/** "14 matches · 11 players", or "No matches" for an empty session. */
export function sessionLine(session) {
  if (session.matches === 0) return 'No matches'
  return `${countWord(session.matches, 'match', 'matches')} · ${countWord(session.players, 'player', 'players')}`
}

/** How many of a session's matches are waiting on the Needs-you list. */
export function sessionNeeds(sessionId, warnings) {
  return warnings.filter((w) => w.sessionId === sessionId && !w.voided).length
}

export function needsFlag(count) {
  if (count === 0) return null
  return count === 1 ? '1 match needs you' : `${count} matches need you`
}

/** Rows still waiting for the manager. A voided match showing its Undo has been dealt with. */
export function waitingCount({ leftOpen, warnings }) {
  return leftOpen.length + warnings.filter((w) => !w.voided).length
}

/** "44 players · 322 matches · 38 sessions", or null on a facility with nothing at all. */
export function allTimeLine(totals) {
  if (totals.players.count + totals.matches.count + totals.sessions.count === 0) return null
  return [
    countWord(totals.players.count, 'player', 'players'),
    countWord(totals.matches.count, 'match', 'matches'),
    countWord(totals.sessions.count, 'session', 'sessions'),
  ].join(' · ')
}
