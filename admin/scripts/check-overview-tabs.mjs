#!/usr/bin/env node
// The Overview's tab in the address, and the Worth a look filters.
//   node admin/scripts/check-overview-tabs.mjs
import { readTab } from '../src/lib/tabParam.js'
import { filterWorth, ownerCells, umpireChoices, worthChips } from '../src/lib/worthFilters.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

check('a known tab', readTab('?tab=look', ['now', 'look'], 'now'), 'look')
check('no tab -> fallback', readTab('', ['now', 'look'], 'now'), 'now')
check('unknown tab -> fallback', readTab('?tab=xyz', ['now', 'look'], 'look'), 'look')
check('other params are ignored', readTab('?facilityId=1&tab=now', ['now', 'look'], 'look'), 'now')

const NOW = Date.parse('2026-10-27T12:00:00Z')
const DAY = 86_400_000
const w = (id, reason, umpireName, ago, extra = {}) => ({ matchId: id, reasons: [{ reason }], umpireName, startedAt: new Date(NOW - ago * DAY).toISOString(), ...extra })
const data = {
  warnings: [w('a', 'shutout', 'Tessa Ramos', 2), w('b', 'shutout', 'Paolo Sy', 20), w('c', 'stuck', 'Paolo Sy', 1), w('d', 'short', 'Noel Garcia', 3, { voided: { byMe: true } })],
  leftOpen: [{ sessionId: 's1', openedBy: 'Tessa Ramos', openedAt: new Date(NOW - 10 * DAY).toISOString() }],
  duplicates: [{ a: { id: 1 }, b: { id: 2 } }],
}
check('chips and counts (voided not counted)', worthChips(data).map((c) => [c.id, c.count]),
  [['all', 5], ['stuck', 1], ['ended_early', 0], ['shutout', 2], ['length', 0], ['left_open', 1], ['duplicates', 1]])
check('no duplicates chip for a manager-shaped page', worthChips({ ...data, duplicates: undefined }).some((c) => c.id === 'duplicates'), false)
check('all, any umpire, 30 days', filterWorth(data, { chip: 'all', umpire: '', days: 30 }, NOW).warnings.map((x) => x.matchId), ['a', 'b', 'c', 'd'])
check('shutouts only', filterWorth(data, { chip: 'shutout', umpire: '', days: 30 }, NOW).warnings.map((x) => x.matchId), ['a', 'b'])
check('last 7 days drops older', filterWorth(data, { chip: 'all', umpire: '', days: 7 }, NOW).warnings.map((x) => x.matchId), ['a', 'c', 'd'])
check('by umpire, left open follows', filterWorth(data, { chip: 'all', umpire: 'Tessa Ramos', days: 30 }, NOW).leftOpen.length, 1)
check('by umpire narrows matches', filterWorth(data, { chip: 'all', umpire: 'Paolo Sy', days: 30 }, NOW).warnings.map((x) => x.matchId), ['b', 'c'])
check('duplicates ignore filters', filterWorth(data, { chip: 'all', umpire: 'Paolo Sy', days: 7 }, NOW).duplicates.length, 1)
check('umpire choices', umpireChoices(data), ['Noel Garcia', 'Paolo Sy', 'Tessa Ramos'])
const totals = { players: { count: 1200, newThisWeek: 0 }, matches: { count: 3, newThisWeek: 2 }, sessions: { count: 1, newThisWeek: 1 }, umpires: { active: 2, notActive: 1 }, ratings: null }
check('owner strip', ownerCells({ live: { sessions: 0 }, totals }).map((c) => [c.key, c.figure, c.sub]),
  [['live', 0, 'Nothing live'], ['players', '1,200', '+0 this week'], ['matches', '3', '+2 this week'], ['sessions', '1', '+1 this week'], ['umpires', 2, '1 not scoring'], ['ratings', 'Not yet', '']])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
