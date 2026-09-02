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
  return jwt.sign(
    { sub: umpire.id, name: umpire.name, role: 'umpire' },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  )
}

/**
 * A token for a PLAYER who has claimed their own record.
 *
 * Carries a different role so it can never be mistaken for an umpire's.
 * A player may read their own history and nothing else -- they cannot
 * score, edit rosters, issue invites, or pull the club-wide export.
 * That separation is enforced by role, not by which screens the app
 * happens to show.
 */
export function signPlayerToken(player) {
  return jwt.sign(
    { sub: player.id, name: player.name, role: 'player' },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  )
}

/** Extracts and verifies a bearer token, or null if absent/invalid. */
function verify(req) {
  const header = req.get('authorization') ?? ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return null
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}

/**
 * Express middleware: requires a valid umpire token and attaches
 * `req.umpire = { id, name }`.
 *
 * Note this authenticates the umpire but deliberately does not
 * restrict which umpire may edit which match -- a venue's umpires are
 * a trusted group covering for each other, and locking matches to
 * their creator would block the normal handover case where one umpire
 * takes over a court mid-session. Attribution is recorded instead
 * (matches.recorded_by) so any entry can still be traced to a scorer.
 *
 * A PLAYER token is refused here. Players may read their own history
 * and nothing else, and that boundary is enforced by role rather than
 * by which screens each app happens to show.
 */
export function requireAuth(req, res, next) {
  const payload = verify(req)
  if (!payload) {
    return res.status(401).json({ error: 'Missing or invalid token' })
  }

  // Tokens issued before roles existed have no role claim; treat those
  // as umpires so a signed-in umpire is not logged out by this change.
  // A player token, which always carries a role, can never slip through
  // this default.
  if ((payload.role ?? 'umpire') !== 'umpire') {
    return res.status(403).json({ error: 'That action is for umpires only' })
  }

  req.umpire = { id: payload.sub, name: payload.name }
  next()
}

/** Requires a token belonging to a claimed PLAYER, not an umpire. */
export function requirePlayer(req, res, next) {
  const payload = verify(req)
  if (!payload) {
    return res.status(401).json({ error: 'Missing or invalid token' })
  }
  if (payload.role !== 'player') {
    return res.status(403).json({ error: 'That action is for players only' })
  }
  req.player = { id: payload.sub, name: payload.name }
  next()
}

/**
 * Express middleware: requires the player's record still to exist and
 * still to be active. Must run after requirePlayer.
 *
 * Same reasoning as requireAdmin below, for the same reason: a player
 * token is valid for 30 days and requirePlayer is stateless, so without
 * this a player who has just deleted their profile would keep getting
 * in for a month with the token already in their browser -- which would
 * make "you won't be able to get back in" a lie on the very screen that
 * says it.
 *
 * One primary-key lookup. The routes behind it were already querying
 * this table.
 */
export function requireActivePlayer(queryFn) {
  return async function requireActivePlayerMiddleware(req, res, next) {
    try {
      const { rows } = await queryFn(
        'SELECT deactivated_at FROM players WHERE id = $1',
        [req.player.id],
      )
      // One message for both cases. Whether the record was deleted
      // outright or the account was closed is not the holder of a dead
      // token's business, and the app treats a 401 the same way either
      // way -- clear the session, show the gate.
      if (!rows[0] || rows[0].deactivated_at) {
        return res.status(401).json({ error: 'That player no longer exists' })
      }
      next()
    } catch (error) {
      next(error)
    }
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

// ============================================================
// Service-to-service auth for the ML pipeline
// ============================================================

// The ML service needs to read match logs and write back a ratings
// snapshot, and nothing else. A shared key grants exactly that.
//
// Deliberately NOT a service umpire account: that would be a real login
// with a real password hash that could sign in to the umpire app and
// score matches. The smallest credential that does the job is the right
// one.
//
// Unset means the internal routes refuse everything rather than falling
// open, so forgetting to set it in Railway is a locked door, not an
// open one.
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY

/**
 * Requires the shared internal-service key in `x-internal-key`.
 *
 * An umpire or player bearer token is NOT accepted here, and this key
 * is not accepted anywhere else -- the two credential systems do not
 * overlap in either direction.
 */
export function requireInternalKey(req, res, next) {
  if (!INTERNAL_API_KEY || INTERNAL_API_KEY.length < 32) {
    return res.status(503).json({
      error: 'Internal API is not configured on this server',
    })
  }

  const presented = req.get('x-internal-key') ?? ''

  // Compared in constant time on equal-length buffers. Buffer.from of a
  // shorter string would make timingSafeEqual throw rather than return
  // false, so the length check comes first and is itself the only
  // length-dependent branch.
  const expected = Buffer.from(INTERNAL_API_KEY)
  const actual = Buffer.from(presented)
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) {
    return res.status(401).json({ error: 'Missing or invalid internal key' })
  }

  next()
}
