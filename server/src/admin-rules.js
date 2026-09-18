// ============================================================
// The admin site's rules that need no database.
//
// Kept apart from the routes so they can be checked on their own
// (scripts/check-admin-rules.mjs) and so the routes read as the steps
// they take rather than the details of each rule.
// ============================================================

import { createHash, randomBytes } from 'node:crypto'

// Shorter than the umpire and player apps' 30 days: an admin can do far
// more with a stolen session.
export const ADMIN_TOKEN_TTL = '12h'
export const SETUP_LINK_HOURS = 24
export const DEFAULT_INVITE_DAYS = 14

/** Every kind of entry the activity record can hold. */
export const ACTIONS = [
  'owner.created',
  'admin.added',
  'admin.setup_link_created',
  'admin.setup_completed',
  'admin.signed_in',
  'admin.sign_in_failed',
  'admin.switched_off',
  'admin.switched_on',
  'admin.password_changed',
  'admin.google_connected',
  'admin.google_disconnected',
  'invite.created',
  'invite.cancelled',
  'player.paused',
  'player.unpaused',
  'player.closed',
  'player.claim_code_created',
  'umpire.paused',
  'umpire.unpaused',
  'umpire.closed',
]

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * A setup link's secret and what is stored for it. Only the hash is
 * saved, so someone reading the database cannot use a link that has not
 * been opened yet.
 */
export function newSetupSecret() {
  const secret = randomBytes(32).toString('base64url')
  return { secret, hash: hashSetupSecret(secret) }
}

export function hashSetupSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex')
}

/** Whether a stored setup link can still be used, and if not, why. */
export function setupLinkState(link, now = Date.now()) {
  if (!link) return 'missing'
  if (link.used_at) return 'used'
  if (link.cancelled_at) return 'cancelled'
  if (new Date(link.expires_at).getTime() <= now) return 'expired'
  return 'usable'
}

/**
 * There are no reset emails, so an admin whose only way in is Google
 * would be locked out for good by disconnecting it.
 */
export function canDisconnectGoogle(row) {
  return Boolean(row.password_hash)
}

/** What the site is told about an admin: never the hash or the Google id. */
export function adminPayload(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    hasPassword: Boolean(row.password_hash),
    googleEmail: row.google_email ?? null,
    active: !row.deactivated_at,
    lastSignedInAt: row.last_signed_in_at ?? null,
    createdAt: row.created_at,
  }
}

/** The expiry asked for when making an invite code. */
export function inviteExpiryDays(body) {
  if (!body || !('expiresInDays' in body)) return { days: DEFAULT_INVITE_DAYS }
  if (body.expiresInDays === null) return { days: null }
  const days = Number(body.expiresInDays)
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return { error: 'Expiry must be a whole number of days from 1 to 365, or never' }
  }
  return { days }
}

/**
 * An invite code as the activity record shows it. An unused code lets
 * someone create an account, so the record never holds a whole one.
 */
export function inviteCodeHint(code) {
  return `${String(code).split('-')[0]}-…`
}
