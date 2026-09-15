#!/usr/bin/env node
// ============================================================
// The admin site's wording for codes, admins and activity.
//
//   node admin/scripts/check-format.mjs
// ============================================================

import {
  EXPIRY_CHOICES, actionLabel, formatWhen, inviteStatusText, madeByText, signInMethods,
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

check('expiry choices default to 14 days and include never',
  [EXPIRY_CHOICES.find((c) => c.value === '14')?.label, EXPIRY_CHOICES.at(-1)?.value], ['In 14 days', 'never'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
