#!/usr/bin/env node
// ============================================================
// The People rules that need no database.
//
//   node server/scripts/check-people-rules.mjs
//
// Status, pause reasons, closing, list filters and what a person looks
// like to the admin site. Everything that needs the database is checked
// on staging by smoke.mjs.
// ============================================================

const rules = await import('../src/people-rules.js')

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

section('status')
{
  check('nothing set is active', rules.personStatus({ pausedAt: null, closedAt: null }), 'active')
  check('paused is paused', rules.personStatus({ pausedAt: '2026-09-16T00:00:00Z', closedAt: null }), 'paused')
  check('closed is closed', rules.personStatus({ pausedAt: null, closedAt: '2026-09-16T00:00:00Z' }), 'closed')
  check('closed wins over paused', rules.personStatus({ pausedAt: '2026-09-16T00:00:00Z', closedAt: '2026-09-16T00:00:00Z' }), 'closed')
}

section('pause reasons')
{
  check('a reason is trimmed', rules.readPauseReason('  rude to other players  '), { reason: 'rude to other players' })
  check('an empty reason is refused', rules.readPauseReason('   '), { error: 'Write a short reason (up to 300 characters)' })
  check('a missing reason is refused', rules.readPauseReason(undefined), { error: 'Write a short reason (up to 300 characters)' })
  check('300 characters is fine', rules.readPauseReason('x'.repeat(300)), { reason: 'x'.repeat(300) })
  check('301 characters is refused', rules.readPauseReason('x'.repeat(301)), { error: 'Write a short reason (up to 300 characters)' })
  check('the limit is 300', rules.PAUSE_REASON_MAX, 300)
}

section('closing')
{
  check('the typed name matches ignoring case and outer spaces', rules.confirmNameMatches('  jan LIBRANDO ', 'Jan Librando'), true)
  check('a different name does not match', rules.confirmNameMatches('Jan', 'Jan Librando'), false)
  check('nothing typed does not match', rules.confirmNameMatches(undefined, 'Jan Librando'), false)
  check('the owner may close', rules.mayClose({ role: 'owner' }), true)
  check('an admin may not close', rules.mayClose({ role: 'admin' }), false)
  check('no admin may not close', rules.mayClose(undefined), false)
  check('a closed umpire email is unique and unusable',
    rules.closedUmpireEmail('3f1c2b1e-0000-4000-8000-000000000001'),
    'closed+3f1c2b1e-0000-4000-8000-000000000001@paddlepad.invalid')
}

section('who may make a claim code')
{
  check('anyone may for an active player',
    rules.mayMintClaimCode({ closed_by_admin_at: null }), true)
  check('anyone may for a player who closed their own account',
    rules.mayMintClaimCode({ closed_by_admin_at: null, deactivated_at: '2026-09-16T00:00:00Z' }), true)
  check('a normal admin is refused for an owner-closed player',
    rules.mayMintClaimCode({ closed_by_admin_at: '2026-09-16T00:00:00Z' }, { isOwner: false }), false)
  check('the owner may for an owner-closed player',
    rules.mayMintClaimCode({ closed_by_admin_at: '2026-09-16T00:00:00Z' }, { isOwner: true }), true)
  check('with no admin at all (the umpire route), an owner-closed player is refused',
    rules.mayMintClaimCode({ closed_by_admin_at: '2026-09-16T00:00:00Z' }), false)
}

section('refusals')
{
  check('an active umpire session is fine', rules.sessionRefusal({ paused_at: null, closed_at: null }, 'closed_at'), null)
  check('a paused session is refused with the paused message',
    rules.sessionRefusal({ paused_at: '2026-09-16T00:00:00Z', closed_at: null }, 'closed_at'),
    { statusCode: 401, body: { error: 'Your account is paused. Contact PaddlePad.', status: 'paused' } })
  check('a closed player session is refused with the closed message',
    rules.sessionRefusal({ paused_at: null, deactivated_at: '2026-09-16T00:00:00Z' }, 'deactivated_at'),
    { statusCode: 401, body: { error: 'That account has been closed', status: 'closed' } })
  check('a missing row is refused as closed', rules.sessionRefusal(undefined, 'closed_at'),
    { statusCode: 401, body: { error: 'That account has been closed', status: 'closed' } })
  check('an active sign-in is fine', rules.signInRefusal({ paused_at: null, closed_at: null }, 'closed_at'), null)
  check('a paused sign-in is refused with 403',
    rules.signInRefusal({ paused_at: '2026-09-16T00:00:00Z', closed_at: null }, 'closed_at'),
    { statusCode: 403, body: { error: 'Your account is paused. Contact PaddlePad.', status: 'paused' } })
  check('a closed sign-in is refused with 403',
    rules.signInRefusal({ paused_at: null, closed_at: '2026-09-16T00:00:00Z' }, 'closed_at'),
    { statusCode: 403, body: { error: 'That account has been closed', status: 'closed' } })
}

section('list filters')
{
  check('statuses', rules.PEOPLE_STATUSES, ['all', 'active', 'paused', 'closed'])
  check('a known status is kept', rules.readStatusFilter('paused'), 'paused')
  check('an unknown status is all', rules.readStatusFilter('nonsense'), 'all')
  check('page size is 50', rules.PEOPLE_PAGE_SIZE, 50)
  check('a search becomes a contains pattern', rules.likePattern('  Ana '), '%ana%')
  check('wildcards in a search are matched literally', rules.likePattern('50%_a\\b'), '%50\\%\\_a\\\\b%')
  check('an empty search is no pattern', rules.likePattern('   '), null)
  const cursor = rules.makeCursor({ created_at: new Date('2026-09-16T01:02:03.456Z'), id: '3f1c2b1e-0000-4000-8000-000000000001' })
  check('a cursor round-trips', rules.readCursor(cursor), { createdAt: '2026-09-16T01:02:03.456Z', id: '3f1c2b1e-0000-4000-8000-000000000001' })
  check('a broken cursor is ignored', rules.readCursor('nope'), null)
  check('a cursor with a bad id is ignored', rules.readCursor('2026-09-16T01:02:03.456Z|x'), null)
  check('no cursor is null', rules.readCursor(undefined), null)
}

section('what a person looks like to the site')
{
  const player = {
    id: 'p1', name: 'Ana Cruz', username: 'ana', password_hash: 'salt:key', google_sub: 'g1',
    google_email: 'ana@gmail.com', claim_code: 'PAD-7K3M', claimed_at: '2026-09-01T00:00:00Z',
    created_at: '2026-08-01T00:00:00Z', last_signed_in_at: null,
    paused_at: null, deactivated_at: null,
  }
  check('a player list item never carries the code or the hash', rules.playerListItem(player), {
    id: 'p1', name: 'Ana Cruz', username: 'ana', signInMethods: ['password', 'google', 'claim code'],
    claimed: true, joinedAt: '2026-08-01T00:00:00Z', lastSignedInAt: null, status: 'active',
  })
  check('an unclaimed player with nothing set has no ways in',
    rules.playerListItem({ ...player, username: null, password_hash: null, google_sub: null, claim_code: null, claimed_at: null }).signInMethods, [])
  const umpire = {
    id: 'u1', name: 'Ref Ray', email: 'ray@example.com', password_hash: null, google_sub: 'g2',
    created_at: '2026-08-01T00:00:00Z', last_signed_in_at: '2026-09-15T00:00:00Z', paused_at: '2026-09-16T00:00:00Z', closed_at: null,
  }
  check('an umpire list item', rules.umpireListItem(umpire), {
    id: 'u1', name: 'Ref Ray', email: 'ray@example.com', signInMethods: ['google'],
    joinedAt: '2026-08-01T00:00:00Z', lastSignedInAt: '2026-09-15T00:00:00Z', status: 'paused',
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
