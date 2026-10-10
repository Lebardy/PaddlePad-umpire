// ============================================================
// Words and counts for a manager's home page. Pure, so they can be
// checked without a browser (scripts/check-manager-home.mjs).
// ============================================================

import { countWord, dayHeading } from './format.js'

/** What players can't see yet under Places to play, or null when nothing is missing. */
export function missingLine(facility) {
  const missing = [
    !facility.logoUrl && 'logo',
    !facility.openingHours && 'opening hours',
    facility.hourlyFeeCentavos == null && 'court fee',
    facility.umpireFeeCentavos == null && 'umpire fee',
    !facility.locationUrl && 'map link',
  ].filter(Boolean)
  return missing.length > 0 ? `Players can’t see yet: ${missing.join(', ')}.` : null
}

/** The three facts under Your place, each with "Not set" when empty. */
export function placeFacts(facility) {
  return [
    { label: 'Open', value: facility.openingHours ?? 'Not set' },
    { label: 'Court fee', value: facility.hourlyFeeCentavos == null ? 'Not set' : facility.feeText },
    { label: 'Umpire fee', value: facility.umpireFeeText ?? 'Not set' },
  ]
}

export function umpireWeekText(umpire) {
  return umpire.weekMatches > 0 ? `${countWord(umpire.weekMatches, 'match', 'matches')} this week` : 'None this week'
}

export function umpireLastText(umpire, now = Date.now()) {
  return umpire.lastScoredAt ? `Last scored ${dayHeading(umpire.lastScoredAt, now)}` : 'Hasn’t scored yet'
}

/** "14 matches · 11 players · run by Paolo Sy", or "No matches · run by ..." for an empty session. */
export function sessionLine(session) {
  const parts = session.matches === 0
    ? ['No matches']
    : [countWord(session.matches, 'match', 'matches'), countWord(session.players, 'player', 'players')]
  if (session.openedBy) parts.push(`run by ${session.openedBy}`)
  return parts.join(' · ')
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

export function allTimeLine(totals) {
  return [
    countWord(totals.players.count, 'player', 'players'),
    countWord(totals.matches.count, 'match', 'matches'),
    countWord(totals.sessions.count, 'session', 'sessions'),
  ].join(' · ')
}
