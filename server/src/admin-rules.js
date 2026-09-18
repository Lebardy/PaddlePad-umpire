// ============================================================
// The admin site's rules that need no database.
//
// Kept apart from the routes so they can be checked on their own
// (scripts/check-admin-rules.mjs) and so the routes read as the steps
// they take rather than the details of each rule.
// ============================================================

import { createHash, randomBytes, randomInt } from 'node:crypto'

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
  'admin.signed_out_others',
  'admin.backup_codes_created',
  'admin.backup_code_used',
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

/**
 * Whether a token issued at `iatSeconds` (a JWT `iat`, whole seconds)
 * belongs to a session that has since been ended. Compared in whole
 * seconds, so a token handed back in the same response as the reset
 * still works.
 */
export function sessionEnded(iatSeconds, resetAt) {
  if (!resetAt) return false
  if (!Number.isFinite(iatSeconds)) return true
  return iatSeconds < Math.floor(new Date(resetAt).getTime() / 1000)
}

/**
 * The `iat` to sign a fresh token with right after a session reset.
 *
 * `resetAt` comes from Postgres's clock; `now` comes from this server's
 * own. If Postgres runs even slightly ahead, a token signed with a
 * plain "now" could carry an `iat` before the reset it is meant to
 * survive, and sessionEnded would refuse it on the very next request.
 * Using whichever moment is later avoids that.
 */
export function adminTokenIat(resetAt, now = Date.now()) {
  const nowSeconds = Math.floor(now / 1000)
  if (!resetAt) return nowSeconds
  return Math.max(nowSeconds, Math.floor(new Date(resetAt).getTime() / 1000))
}

/**
 * Whether the session itself already proves who is asking, without a
 * password or a fresh Google check.
 *
 * True only right after a backup-code sign-in (the token's
 * `viaBackupCode` claim, carried onto `req.admin` by requireAdminAccount).
 * That is safe to treat as proof: the code that opened the session is
 * single-use, the sign-in reset every other session on the account, and
 * for an owner who has already lost both their password and Google it
 * is the only way back in at all -- refusing to let that session repair
 * the account would turn ten one-time sign-ins into ten dead ends.
 */
export function proofFromSession(admin) {
  return Boolean(admin?.viaBackupCode)
}

export const BACKUP_CODE_COUNT = 10
export const BACKUP_CODE_LOW = 3
// The invite-code alphabet: no letters or digits that look alike.
const BACKUP_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY2346789'
const BACKUP_LENGTH = 10

function oneBackupCode() {
  let raw = ''
  for (let i = 0; i < BACKUP_LENGTH; i += 1) raw += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]
  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

/** A fresh set of plain codes, shown to the owner once and stored only as hashes. */
export function newBackupCodes() {
  const codes = new Set()
  while (codes.size < BACKUP_CODE_COUNT) codes.add(oneBackupCode())
  return [...codes]
}

/** A typed code as it is compared: capitals, no spaces or dashes; '' if it can't be a code. */
export function normalizeBackupCode(value) {
  const cleaned = String(value ?? '').toUpperCase().replace(/[\s-]/g, '')
  if (cleaned.length !== BACKUP_LENGTH) return ''
  for (const ch of cleaned) if (!BACKUP_ALPHABET.includes(ch)) return ''
  return cleaned
}

/** something@something.something, one @, no spaces. */
export function isAdminEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ''))
}

/**
 * The hashes a backup-code check compares against: every unused code's
 * hash, padded with `dummyHash` so the result always has exactly
 * BACKUP_CODE_COUNT entries.
 *
 * Without this, how many codes an owner has left -- and whether there
 * is a real account to check at all -- would leak through how many
 * scrypt comparisons a wrong code costs to refuse. Padding to a fixed
 * count makes an owner with one code left, an owner with ten, and no
 * account at all cost exactly the same to check.
 */
export function paddedCodeHashes(hashes, dummyHash) {
  const padded = hashes.slice(0, BACKUP_CODE_COUNT)
  while (padded.length < BACKUP_CODE_COUNT) padded.push(dummyHash)
  return padded
}
