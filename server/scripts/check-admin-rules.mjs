#!/usr/bin/env node
// ============================================================
// The admin site's rules that need no database.
//
//   node server/scripts/check-admin-rules.mjs
//
// Setup links, which sign-in methods may be removed, what an admin row
// looks like to the site, invite expiry, and (from Task 2) which tokens
// each guard lets through. Everything that needs the database is
// checked on staging by smoke.mjs.
// ============================================================

process.env.JWT_SECRET ??= 'check-admin-rules-'.padEnd(48, 'x')

const rules = await import('../src/admin-rules.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label}` +
    (ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`),
  )
}
const section = (title) => console.log(`\n${title}`)

section('setup links')
{
  const { secret, hash } = rules.newSetupSecret()
  check('a secret is long and URL-safe', /^[A-Za-z0-9_-]{43}$/.test(secret), true)
  check('the stored hash is the sha256 of the secret', rules.hashSetupSecret(secret), hash)
  check('the hash is not the secret', hash === secret, false)
  check('two secrets differ', rules.newSetupSecret().secret === secret, false)

  const now = Date.parse('2026-09-15T12:00:00Z')
  const fresh = { used_at: null, cancelled_at: null, expires_at: '2026-09-16T11:59:00Z' }
  check('an unused, uncancelled, unexpired link is usable', rules.setupLinkState(fresh, now), 'usable')
  check('no link is missing', rules.setupLinkState(undefined, now), 'missing')
  check('a used link is used', rules.setupLinkState({ ...fresh, used_at: '2026-09-15T11:00:00Z' }, now), 'used')
  check('a cancelled link is cancelled', rules.setupLinkState({ ...fresh, cancelled_at: '2026-09-15T11:00:00Z' }, now), 'cancelled')
  check('a link past its expiry is expired', rules.setupLinkState({ ...fresh, expires_at: '2026-09-15T12:00:00Z' }, now), 'expired')
  check('used wins over expired', rules.setupLinkState({ ...fresh, used_at: '2026-09-15T01:00:00Z', expires_at: '2026-09-15T02:00:00Z' }, now), 'used')
  check('links last 24 hours', rules.SETUP_LINK_HOURS, 24)
}

section('sign-in methods')
{
  check('Google can be disconnected when a password exists', rules.canDisconnectGoogle({ password_hash: 'a:b' }), true)
  check('Google cannot be disconnected when it is the only way in', rules.canDisconnectGoogle({ password_hash: null }), false)
}

section('what the site is told about an admin')
{
  const row = {
    id: 'a1', name: 'Jan', email: 'jan@example.com', role: 'owner',
    password_hash: 'salt:key', google_sub: 'g1', google_email: 'jan@gmail.com',
    deactivated_at: null, last_signed_in_at: '2026-09-15T01:00:00Z', created_at: '2026-09-14T01:00:00Z',
  }
  const payload = rules.adminPayload(row)
  check('never the hash or the Google id', 'password_hash' in payload || 'google_sub' in payload || JSON.stringify(payload).includes('salt:key'), false)
  check('the fields the site uses', payload, {
    id: 'a1', name: 'Jan', email: 'jan@example.com', role: 'owner', hasPassword: true,
    googleEmail: 'jan@gmail.com', active: true, lastSignedInAt: '2026-09-15T01:00:00Z', createdAt: '2026-09-14T01:00:00Z',
  })
  check('a switched-off admin is not active', rules.adminPayload({ ...row, deactivated_at: '2026-09-15T02:00:00Z' }).active, false)
}

section('emails and invite codes')
{
  check('emails are trimmed and lower-cased', rules.normalizeEmail('  Jan@Example.COM '), 'jan@example.com')
  check('no expiry given means 14 days', rules.inviteExpiryDays({}), { days: 14 })
  check('null means never', rules.inviteExpiryDays({ expiresInDays: null }), { days: null })
  check('30 is allowed', rules.inviteExpiryDays({ expiresInDays: 30 }), { days: 30 })
  check('0 is refused', 'error' in rules.inviteExpiryDays({ expiresInDays: 0 }), true)
  check('366 is refused', 'error' in rules.inviteExpiryDays({ expiresInDays: 366 }), true)
  check('text is refused', 'error' in rules.inviteExpiryDays({ expiresInDays: 'soon' }), true)
  check('a code hint shows only the first group', rules.inviteCodeHint('7K3M-9QXR-ACDE'), '7K3M-…')
}

section('action names')
{
  for (const action of ['admin.signed_in', 'admin.sign_in_failed', 'owner.created', 'admin.added',
    'admin.setup_link_created', 'admin.switched_off', 'admin.switched_on', 'admin.setup_completed',
    'admin.password_changed', 'admin.google_connected', 'admin.google_disconnected',
    'invite.created', 'invite.cancelled']) {
    check(`${action} is a known action`, rules.ACTIONS.includes(action), true)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
