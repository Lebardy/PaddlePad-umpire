import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import jwt from 'jsonwebtoken'

const scryptAsync = promisify(scrypt)

// scrypt from Node's own crypto is used rather than a bcrypt package:
// it's a memory-hard KDF suitable for passwords, and it avoids pulling
// a native-build dependency into the deploy.
const KEY_LENGTH = 64
const SALT_LENGTH = 16

const TOKEN_TTL = '30d'

// Fail at boot rather than silently signing tokens with a guessable
// secret. On Railway this is set as a service variable.
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET must be set to a random string of at least 32 characters. ' +
      'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"',
  )
}

export const MIN_PASSWORD_LENGTH = 8

/** Hashes a password as `salt:key`, both hex. */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_LENGTH).toString('hex')
  const key = await scryptAsync(password, salt, KEY_LENGTH)
  return `${salt}:${key.toString('hex')}`
}

/**
 * Constant-time password check. Returns false rather than throwing on
 * a malformed stored hash, so a corrupt row can't be distinguished
 * from a wrong password by an attacker watching for error shapes.
 */
export async function verifyPassword(password, stored) {
  const [salt, keyHex] = String(stored).split(':')
  if (!salt || !keyHex) return false

  const expected = Buffer.from(keyHex, 'hex')
  if (expected.length !== KEY_LENGTH) return false

  const actual = await scryptAsync(password, salt, KEY_LENGTH)
  return timingSafeEqual(expected, actual)
}

export function signToken(umpire) {
  return jwt.sign({ sub: umpire.id, name: umpire.name }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  })
}

/**
 * Express middleware: requires a valid `Authorization: Bearer <token>`
 * header and attaches `req.umpire = { id, name }`.
 *
 * Note this authenticates the umpire but deliberately does not
 * restrict which umpire may edit which match -- a venue's umpires are
 * a trusted group covering for each other, and locking matches to
 * their creator would block the normal handover case where one umpire
 * takes over a court mid-session. Attribution is recorded instead
 * (matches.recorded_by) so any entry can still be traced to a scorer.
 */
export function requireAuth(req, res, next) {
  const header = req.get('authorization') ?? ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing bearer token' })
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.umpire = { id: payload.sub, name: payload.name }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/**
 * Express middleware: requires the caller to be an admin. Must run
 * after requireAuth.
 *
 * Deliberately reads is_admin from the database rather than trusting
 * the token. A token is valid for 30 days, so a token minted while
 * someone was an admin would keep asserting that long after the flag
 * was revoked. The copy of is_admin in the token is only ever used by
 * the app to decide what to show, never to decide what is allowed.
 */
export function requireAdmin(queryFn) {
  return async function requireAdminMiddleware(req, res, next) {
    try {
      const { rows } = await queryFn(
        'SELECT is_admin FROM umpires WHERE id = $1',
        [req.umpire.id],
      )
      if (!rows[0]) {
        return res.status(401).json({ error: 'Account no longer exists' })
      }
      if (!rows[0].is_admin) {
        return res
          .status(403)
          .json({ error: 'Only an admin can manage invite codes' })
      }
      next()
    } catch (error) {
      next(error)
    }
  }
}
