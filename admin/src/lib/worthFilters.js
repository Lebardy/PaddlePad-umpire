// The chips and filters over Worth a look. Everything here is the data
// the Overview already loaded (the last 30 days), filtered in the page.
import { formatWhen } from './format.js'
import { sizeText } from './matches.js'

const DAY = 86_400_000
const CHIPS = [
  { id: 'stuck', label: 'Stuck', reasons: ['stuck'] },
  { id: 'ended_early', label: 'Ended early', reasons: ['ended_early'] },
  { id: 'shutout', label: 'Shutouts', reasons: ['shutout'] },
  { id: 'length', label: 'Too short / long', reasons: ['short', 'long'] },
  { id: 'left_open', label: 'Left open' },
  { id: 'duplicates', label: 'Duplicates' },
]

const hasReason = (warning, reasons) => warning.reasons.some((r) => reasons.includes(r.reason))
// A voided match stays listed for Undo, but it has been dealt with.
const waiting = (warnings) => warnings.filter((w) => !w.voided).length

export function worthChips({ warnings, leftOpen, duplicates }) {
  const chips = CHIPS.filter((chip) => chip.id !== 'duplicates' || duplicates).map((chip) => ({
    id: chip.id,
    label: chip.label,
    count: chip.reasons ? waiting(warnings.filter((w) => hasReason(w, chip.reasons)))
      : chip.id === 'left_open' ? leftOpen.length : duplicates.length,
  }))
  const all = waiting(warnings) + leftOpen.length + (duplicates?.length ?? 0)
  return [{ id: 'all', label: 'All', count: all }, ...chips]
}

export function filterWorth({ warnings, leftOpen, duplicates }, { chip, umpire, days }, now = Date.now()) {
  const after = now - days * DAY
  const recent = (at) => Date.parse(at) >= after
  const byUmpire = (name) => !umpire || name === umpire
  const reasons = CHIPS.find((c) => c.id === chip)?.reasons
  return {
    warnings: chip === 'all' || reasons
      ? warnings.filter((w) => (chip === 'all' || hasReason(w, reasons)) && byUmpire(w.umpireName) && recent(w.startedAt))
      : [],
    leftOpen: chip === 'all' || chip === 'left_open' ? leftOpen.filter((s) => byUmpire(s.openedBy) && recent(s.openedAt)) : [],
    // A pair of players has no umpire or date to filter by.
    duplicates: duplicates && (chip === 'all' || chip === 'duplicates') ? duplicates : [],
  }
}

export function umpireChoices({ warnings, leftOpen }) {
  return [...new Set([...warnings.map((w) => w.umpireName), ...leftOpen.map((s) => s.openedBy)].filter(Boolean))].sort()
}

const newLine = (n) => (n === 0 ? 'none this week' : `+${n} this week`)
/** The owner's number strip: what is live, then the totals. */
export function ownerCells({ live, totals }) {
  return [
    { key: 'live', label: 'Live now', figure: live.sessions, sub: live.sessions ? `${live.matches} matches · ${live.onCourt} on court` : 'Nothing live', lit: live.sessions > 0 },
    { key: 'players', label: 'Players', figure: totals.players.count.toLocaleString(), sub: newLine(totals.players.newThisWeek) },
    { key: 'matches', label: 'Matches', figure: totals.matches.count.toLocaleString(), sub: newLine(totals.matches.newThisWeek) },
    { key: 'sessions', label: 'Sessions', figure: totals.sessions.count.toLocaleString(), sub: newLine(totals.sessions.newThisWeek) },
    { key: 'umpires', label: 'Umpires scoring', figure: totals.umpires.active, sub: `${totals.umpires.notActive} not scoring` },
    ...(totals.videos ? [{ key: 'videos', label: 'Videos', figure: totals.videos.count.toLocaleString(), sub: sizeText(totals.videos.bytes) }] : []),
    { key: 'ratings', label: 'Ratings run', figure: totals.ratings ? formatWhen(totals.ratings.computedAt) : 'Not yet', sub: totals.ratings ? `${totals.ratings.playerCount} players rated` : '' },
  ]
}
