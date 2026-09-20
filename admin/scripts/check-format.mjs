#!/usr/bin/env node
// ============================================================
// The admin site's wording for codes, admins and activity.
//
//   node admin/scripts/check-format.mjs
// ============================================================

import {
  EXPIRY_CHOICES, actionLabel, agoText, clockText, confirmNameMatches, countWord, dayHeading, facilityLabel,
  formatWhen, inviteStatusText, lastSignedInText, madeByText, ratingText, signInMethods, signInMethodsText,
  statusLabel, timeOfDay,
} from '../src/lib/format.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const now = Date.parse('2026-09-15T00:00:00Z')

check('a used code names who used it', inviteStatusText({ status: 'used', used_by_name: 'Ana' }, now), 'Used by Ana')
check('a used code with no name left', inviteStatusText({ status: 'used', used_by_name: null }, now), 'Used')
check('an expired code', inviteStatusText({ status: 'expired' }, now), 'Expired')
check('an open code that never expires', inviteStatusText({ status: 'open', expires_at: null }, now), 'Open · never expires')
check('an open code with days left', inviteStatusText({ status: 'open', expires_at: '2026-09-22T00:00:00Z' }, now), 'Open · 7 days left')
check('one day, not one days', inviteStatusText({ status: 'open', expires_at: '2026-09-15T20:00:00Z' }, now), 'Open · 1 day left')

check('made by an admin', madeByText({ created_by_name: 'Jan', made_before_admin_site: false }), 'Jan')
check('made by an umpire before the admin site', madeByText({ created_by_name: 'Ump', made_before_admin_site: true }), 'Ump (before the admin site)')
check('made by someone since removed', madeByText({ created_by_name: null }), '—')

check('password and Google', signInMethods({ hasPassword: true, googleEmail: 'a@gmail.com' }), 'Password · Google (a@gmail.com)')
check('not set up yet', signInMethods({ hasPassword: false, googleEmail: null }), 'Not set up yet')

check('times are shown in Manila time', formatWhen('2026-09-14T17:05:00Z'), 'Sep 15, 1:05 AM')
check('no time is a dash', formatWhen(null), '—')

check('actions read as words', actionLabel('invite.created'), 'Made an invite code')
check('an unknown action falls back to its name', actionLabel('something.new'), 'something.new')
check('an admin move reads as words', actionLabel('admin.moved'), 'Moved an admin')
check('an umpire move reads as words', actionLabel('umpire.moved'), 'Moved an umpire')
check('a facility being made reads as words', actionLabel('facility.created'), 'Made a facility')
check('a facility being edited reads as words', actionLabel('facility.updated'), 'Updated a facility')
check('marking fine reads as words', actionLabel('match.looks_fine'), 'Marked a match as fine')
check('voided label', actionLabel('match.voided'), 'Voided a match')
check('a void undone reads as words', actionLabel('match.restored'), 'Undid a void')
check('marking different people reads as words', actionLabel('player.not_duplicate'), 'Marked players as different people')
check('a merge reads as words', actionLabel('player.merged'), 'Merged two players')
check('closing a session reads as words', actionLabel('session.closed'), 'Closed a session')

check('expiry choices default to 14 days and include never',
  [EXPIRY_CHOICES.find((c) => c.value === '14')?.label, EXPIRY_CHOICES.at(-1)?.value], ['In 14 days', 'never'])

check('never signed in', lastSignedInText(null), 'Not yet recorded')
check('signed in shows Manila time', lastSignedInText('2026-09-14T17:05:00Z'), 'Sep 15, 1:05 AM')

check('two ways in, comma style', signInMethodsText(['password', 'google']), 'Password, Google')
check('a two-word way in is capitalised on its first word', signInMethodsText(['claim code']), 'Claim code')
check('no way in yet', signInMethodsText([]), 'No way in yet')

check('active status', statusLabel('active'), 'Active')
check('paused status', statusLabel('paused'), 'Paused')
check('closed status', statusLabel('closed'), 'Closed')

check('rated with a playstyle', ratingText({ state: 'rated', skillScore: 62, playstyle: 'Baseliner' }), '62 · Baseliner')
check('rated with no playstyle yet', ratingText({ state: 'rated', skillScore: 62, playstyle: null }), '62')
check('not enough of their own matches', ratingText({ state: 'not_enough_matches', have: 2, need: 5 }), 'Not rated yet: 2 of 5 matches')
check('not enough players in the pool', ratingText({ state: 'not_enough_players', have: 4, need: 8 }), 'Not rated yet: waiting for more players (4 of 8)')
check('qualified, waiting for the nightly run', ratingText({ state: 'pending' }), 'Rated at the next nightly run')
check('unrated falls back', ratingText({ state: 'unrated' }), 'Not rated yet')

check('an exact typed name matches', confirmNameMatches('Ana Reyes', 'Ana Reyes'), true)
check('matching ignores case and outer spaces', confirmNameMatches('  ana reyes  ', 'Ana Reyes'), true)
check('a different name does not match', confirmNameMatches('Ana', 'Ana Reyes'), false)
check('an empty or blank typed name never matches', confirmNameMatches('   ', 'Ana Reyes'), false)

check('the owner sees every facility', facilityLabel({ role: 'owner', facilityId: null }, []), 'All facilities')
check('a facility admin sees their own facility’s name',
  facilityLabel({ role: 'admin', facilityId: 'f1' }, [{ id: 'f1', name: 'Cebu IT Park' }]), 'Cebu IT Park')
check('a facility admin whose facility hasn’t loaded yet shows nothing',
  facilityLabel({ role: 'admin', facilityId: 'f1' }, []), null)

check('a day heading this year has no year', dayHeading('2026-09-18T01:00:00Z', Date.parse('2026-09-18T12:00:00Z')), 'Friday, Sep 18')
check('a day heading from a past year gets one', dayHeading('2025-12-31T15:00:00Z', Date.parse('2026-09-18T12:00:00Z')), 'Wednesday, Dec 31, 2025')
check('Manila can already be the next day', dayHeading('2025-12-31T17:00:00Z', Date.parse('2026-09-18T12:00:00Z')), 'Thursday, Jan 1')
check('a time of day in Manila', timeOfDay('2026-09-18T01:05:00Z'), '9:05 AM')

const at = Date.parse('2026-09-20T11:42:00Z')
check('seconds ago reads just now', agoText('2026-09-20T11:41:40Z', at), 'just now')
check('minutes ago', agoText('2026-09-20T11:28:00Z', at), '14 min ago')
check('hours ago', agoText('2026-09-20T09:30:00Z', at), '2 h ago')
check('a day ago', agoText('2026-09-19T09:00:00Z', at), 'yesterday')
check('days ago', agoText('2026-09-16T09:00:00Z', at), '4 days ago')
check('one player', countWord(1, 'player', 'players'), '1 player')
check('many players', countWord(3, 'player', 'players'), '3 players')
check('clock time has AM/PM', /^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(clockText('2026-09-20T11:42:00Z')), true)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
