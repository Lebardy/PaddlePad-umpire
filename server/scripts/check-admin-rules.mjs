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
    facilityId: null,
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

section('which tokens each guard lets through')
{
  const auth = await import('../src/auth.js')
  const jwt = (await import('jsonwebtoken')).default
  const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' })

  const adminToken = auth.signAdminToken({ id: 'a1', name: 'Jan' })
  const umpireToken = sign({ sub: 'u1', name: 'Ump', role: 'umpire' })
  const oldUmpireToken = sign({ sub: 'u1', name: 'Ump' })
  const playerToken = sign({ sub: 'p1', name: 'Pat', role: 'player' })

  const decoded = jwt.decode(adminToken)
  check('an admin token carries the admin role', decoded.role, 'admin')
  check('an admin token lasts 12 hours', decoded.exp - decoded.iat, 12 * 3600)

  // Runs a middleware against a fake request and reports what it did.
  async function run(middleware, token, extra = {}) {
    const req = { get: (h) => (h.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : undefined), ...extra }
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
    let nextCalled = false
    await middleware(req, res, () => { nextCalled = true })
    return { status: nextCalled ? 'next' : res.statusCode, req, body: res.body }
  }

  const activeRow = { id: 'a1', name: 'Jan', email: 'jan@example.com', role: 'admin', deactivated_at: null }
  const lookups = []
  const fakeQuery = (rows) => async (text, params) => { lookups.push(params); return { rows } }
  const guard = auth.requireAdminAccount(fakeQuery([activeRow]))

  check('the admin guard lets an admin token through', (await run(guard, adminToken)).status, 'next')
  check('and reads the admin from the database', lookups.at(-1), ['a1'])
  check('and attaches who it is', (await run(guard, adminToken)).req.admin, { id: 'a1', name: 'Jan', email: 'jan@example.com', role: 'admin', facilityId: null })
  check('the admin guard refuses no token', (await run(guard, null)).status, 401)
  check('the admin guard refuses an umpire token', (await run(guard, umpireToken)).status, 403)
  check('the admin guard refuses an old umpire token with no role', (await run(guard, oldUmpireToken)).status, 403)
  check('the admin guard refuses a player token', (await run(guard, playerToken)).status, 403)
  check('the admin guard refuses a switched-off admin',
    (await run(auth.requireAdminAccount(fakeQuery([{ ...activeRow, deactivated_at: '2026-09-15T00:00:00Z' }])), adminToken)).status, 401)
  check('the admin guard refuses an admin who no longer exists',
    (await run(auth.requireAdminAccount(fakeQuery([])), adminToken)).status, 401)
  check('the role comes from the database, not the token',
    (await run(auth.requireAdminAccount(fakeQuery([{ ...activeRow, role: 'owner' }])), adminToken)).req.admin.role, 'owner')

  // A token issued before admins.sessions_reset_at must be refused, even
  // though it is otherwise valid and the admin is still switched on.
  // The reset moment sits between the two tokens' iat, and everything
  // is close to "now" so a 1h expiresIn never makes a token expired.
  const nowSecond = Math.floor(Date.now() / 1000)
  const resetAt = new Date(nowSecond * 1000).toISOString()
  const tokenBeforeReset = sign({ sub: 'a1', name: 'Jan', role: 'admin', iat: nowSecond - 5 })
  const tokenAfterReset = sign({ sub: 'a1', name: 'Jan', role: 'admin', iat: nowSecond + 5 })
  const resetRow = { ...activeRow, sessions_reset_at: resetAt }

  const beforeResult = await run(auth.requireAdminAccount(fakeQuery([resetRow])), tokenBeforeReset)
  check('the admin guard refuses a token from before a session reset', beforeResult.status, 401)
  check('and says the session ended', beforeResult.body, { error: 'Your session has ended. Sign in again.' })
  check('the admin guard lets a token from after a session reset through',
    (await run(auth.requireAdminAccount(fakeQuery([resetRow])), tokenAfterReset)).status, 'next')

  check('the umpire guard refuses an admin token', (await run(auth.requireAuth, adminToken)).status, 403)
  check('the umpire guard still accepts an old umpire token', (await run(auth.requireAuth, oldUmpireToken)).status, 'next')
  check('the player guard refuses an admin token', (await run(auth.requirePlayer, adminToken)).status, 403)

  check('the owner guard lets the owner through', (await run(auth.requireOwner, null, { admin: { role: 'owner' } })).status, 'next')
  check('the owner guard refuses an admin', (await run(auth.requireOwner, null, { admin: { role: 'admin' } })).status, 403)

  // requireActiveUmpire / requireActivePlayer (Task 2) must run after
  // requireAuth / requirePlayer, so they read req.umpire.id / req.player.id
  // rather than a token -- the fake request supplies that directly.
  const umpireExtra = { umpire: { id: 'u1' } }
  const runUmpireGuard = (rows) => run(auth.requireActiveUmpire(fakeQuery(rows)), null, umpireExtra)

  check('the active-umpire guard lets an active umpire through',
    (await runUmpireGuard([{ paused_at: null, closed_at: null }])).status, 'next')
  check('the active-umpire guard refuses a paused umpire', (await runUmpireGuard([{ paused_at: '2026-09-15T00:00:00Z', closed_at: null }])).status, 401)
  check('and says which', (await runUmpireGuard([{ paused_at: '2026-09-15T00:00:00Z', closed_at: null }])).body.status, 'paused')
  check('the active-umpire guard refuses a closed umpire', (await runUmpireGuard([{ paused_at: null, closed_at: '2026-09-15T00:00:00Z' }])).status, 401)
  check('and says which', (await runUmpireGuard([{ paused_at: null, closed_at: '2026-09-15T00:00:00Z' }])).body.status, 'closed')
  check('the active-umpire guard treats a missing umpire as closed', (await runUmpireGuard([])).status, 401)
  check('and says which', (await runUmpireGuard([])).body.status, 'closed')

  const playerExtra = { player: { id: 'p1' } }
  const runPlayerGuard = (rows) => run(auth.requireActivePlayer(fakeQuery(rows)), null, playerExtra)

  check('the active-player guard lets an active player through',
    (await runPlayerGuard([{ paused_at: null, deactivated_at: null }])).status, 'next')
  check('the active-player guard refuses a paused player', (await runPlayerGuard([{ paused_at: '2026-09-15T00:00:00Z', deactivated_at: null }])).status, 401)
  check('and says which', (await runPlayerGuard([{ paused_at: '2026-09-15T00:00:00Z', deactivated_at: null }])).body.status, 'paused')
  check('the active-player guard refuses a closed player', (await runPlayerGuard([{ paused_at: null, deactivated_at: '2026-09-15T00:00:00Z' }])).status, 401)
  check('and says which', (await runPlayerGuard([{ paused_at: null, deactivated_at: '2026-09-15T00:00:00Z' }])).body.status, 'closed')
  check('the active-player guard treats a missing player as closed', (await runPlayerGuard([])).status, 401)
  check('and says which', (await runPlayerGuard([])).body.status, 'closed')
}

section('a backup-code session counts as proof')
{
  check('no viaBackupCode claim is not proof', rules.proofFromSession({ id: 'a1' }), false)
  check('viaBackupCode true is proof', rules.proofFromSession({ id: 'a1', viaBackupCode: true }), true)
  check('viaBackupCode false is not proof', rules.proofFromSession({ id: 'a1', viaBackupCode: false }), false)
  check('nothing at all is not proof', rules.proofFromSession(undefined), false)

  const auth = await import('../src/auth.js')
  const jwt = (await import('jsonwebtoken')).default

  const withClaim = auth.signAdminToken({ id: 'a1', name: 'Jan' }, null, { viaBackupCode: true })
  const withoutClaim = auth.signAdminToken({ id: 'a1', name: 'Jan' })
  check('signAdminToken carries an extra claim when asked', jwt.decode(withClaim).viaBackupCode, true)
  check('and carries none by default', 'viaBackupCode' in jwt.decode(withoutClaim), false)

  const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' })
  const activeRow = { id: 'a1', name: 'Jan', email: 'jan@example.com', role: 'admin', deactivated_at: null }
  const fakeQuery = (rows) => async () => ({ rows })
  const guard = auth.requireAdminAccount(fakeQuery([activeRow]))
  async function run(middleware, token) {
    const req = { get: (h) => (h.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : undefined) }
    const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this }, json(b) { this.body = b; return this } }
    await middleware(req, res, () => {})
    return req
  }

  const tokenWithClaim = sign({ sub: 'a1', name: 'Jan', role: 'admin', viaBackupCode: true })
  const tokenWithoutClaim = sign({ sub: 'a1', name: 'Jan', role: 'admin' })
  check('the admin guard carries viaBackupCode onto req.admin', (await run(guard, tokenWithClaim)).admin.viaBackupCode, true)
  check('and leaves it off an ordinary token', 'viaBackupCode' in (await run(guard, tokenWithoutClaim)).admin, false)
}

section('ending sessions')
{
  const reset = '2026-09-18T01:00:00.700Z'
  const second = Math.floor(Date.parse(reset) / 1000)
  check('no reset never ends a session', rules.sessionEnded(second - 1000, null), false)
  check('a token from before the reset has ended', rules.sessionEnded(second - 1, reset), true)
  check('a token from the same second as the reset survives', rules.sessionEnded(second, reset), false)
  check('a token from after the reset survives', rules.sessionEnded(second + 5, reset), false)
  check('a token with no issue time has ended once there is a reset', rules.sessionEnded(undefined, reset), true)
}

section('signing a token right after a reset')
{
  const reset = '2026-09-18T01:00:00.700Z'
  const resetSecond = Math.floor(Date.parse(reset) / 1000)
  check('the reset wins when this server is behind Postgres',
    rules.adminTokenIat(reset, Date.parse(reset) - 5000), resetSecond)
  check('now wins when this server is ahead of the reset',
    rules.adminTokenIat(reset, Date.parse(reset) + 5000), resetSecond + 5)
  check('the same second as the reset counts as now, not before it',
    rules.adminTokenIat(reset, Date.parse(reset)), resetSecond)
  check('no reset just means now', rules.adminTokenIat(null, Date.parse(reset)), resetSecond)
}

section('backup codes')
{
  const codes = rules.newBackupCodes()
  check('a set has 10 codes', codes.length, 10)
  check('the count is 10', rules.BACKUP_CODE_COUNT, 10)
  check('low means 3 or fewer', rules.BACKUP_CODE_LOW, 3)
  check('every code is XXXXX-XXXXX from the invite alphabet',
    codes.every((c) => /^[ACDEFGHJKMNPQRTUVWXY2346789]{5}-[ACDEFGHJKMNPQRTUVWXY2346789]{5}$/.test(c)), true)
  check('codes in a set are all different', new Set(codes).size, 10)
  check('typing ignores case, spaces and dashes', rules.normalizeBackupCode(' acdef - ghjkm '), 'ACDEFGHJKM')
  check('the shown form normalises to itself without the dash', rules.normalizeBackupCode(codes[0]), codes[0].replace('-', ''))
  check('too short is nothing', rules.normalizeBackupCode('ACDEF'), '')
  check('letters outside the alphabet are nothing', rules.normalizeBackupCode('ABCDEFGHIJ'), '')
  check('nothing is nothing', rules.normalizeBackupCode(undefined), '')
}

section('padding backup-code hashes for a constant-time check')
{
  check('no real hashes is still 10 entries, all the dummy',
    rules.paddedCodeHashes([], 'dummy'), Array(10).fill('dummy'))
  check('some real hashes keep their place and the rest is padding',
    rules.paddedCodeHashes(['h1', 'h2', 'h3'], 'dummy'),
    ['h1', 'h2', 'h3', 'dummy', 'dummy', 'dummy', 'dummy', 'dummy', 'dummy', 'dummy'])
  check('a full set is exactly 10 real hashes, nothing padded',
    rules.paddedCodeHashes(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10'], 'dummy'),
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10'])
  check('always exactly 10 entries', rules.paddedCodeHashes(['h1'], 'dummy').length, 10)
}

section('admin emails')
{
  check('a normal address is fine', rules.isAdminEmail('ana@example.com'), true)
  check('a subdomain is fine', rules.isAdminEmail('ana.cruz@mail.example.co'), true)
  check('no dot after the @ is refused', rules.isAdminEmail('ana@example'), false)
  check('a space is refused', rules.isAdminEmail('ana cruz@example.com'), false)
  check('two @ are refused', rules.isAdminEmail('a@b@example.com'), false)
  check('nothing before the @ is refused', rules.isAdminEmail('@example.com'), false)
  check('empty is refused', rules.isAdminEmail(''), false)
}

section('new action names')
{
  for (const name of ['admin.signed_out_others', 'admin.backup_codes_created', 'admin.backup_code_used',
    'facility.logo_changed', 'facility.logo_removed']) {
    check(`${name} is an action`, rules.ACTIONS.includes(name), true)
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
