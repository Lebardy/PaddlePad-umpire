import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import {
  MIN_PASSWORD_LENGTH,
  hashPassword,
  requireAuth,
  requireActivePlayer,
  requirePlayer,
  signPlayerToken,
  signToken,
  verifyPassword,
} from '../auth.js'
import { generateInviteCode, normalizeInviteCode } from '../invites.js'
import { verifyGoogleToken } from '../google.js'
import {
  USERNAME_RULE,
  isValidUsername,
  normalizePlayerName,
  normalizeUsername,
  playerNameError,
} from '../validate.js'

const router = Router()

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

// Verified against when no account matches, so a missing account and a
// wrong password take similar time to answer. Well-formed (`salt:key`
// with a 64-byte key) so verifyPassword does the real scrypt work rather
// than bailing early on a malformed hash, which would give the timing
// away again.
const NO_SUCH_ACCOUNT_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`

/** An error carrying the status and extra fields a handler should return. */
function refusal(statusCode, message, extra = {}) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.extra = extra
  return error
}

// Lets the very first umpire register before any invite can exist.
// Only honoured while the umpires table is empty, so it stops working
// the moment a real account exists rather than remaining a permanent
// back door. Unset it in Railway once you've signed up.
const BOOTSTRAP_INVITE_CODE = process.env.BOOTSTRAP_INVITE_CODE

/**
 * Claims a single-use invite, or accepts the bootstrap code while no
 * umpires exist yet.
 *
 * Runs inside the caller's transaction and marks the invite used in
 * the same breath as creating the umpire. That ordering matters: a
 * check-then-insert would let two people submitting the same code
 * concurrently both pass the check and both get accounts. Here the
 * UPDATE only matches while `used_by IS NULL`, so the second one
 * matches zero rows and its whole transaction rolls back.
 *
 * @returns {Promise<string|null>} an error message, or null on success
 */
async function claimInvite(client, rawCode, umpireId) {
  const code = normalizeInviteCode(rawCode)

  if (BOOTSTRAP_INVITE_CODE) {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM umpires')
    // The new umpire is already inserted at this point, so "empty
    // before this registration" means exactly one row.
    if (rows[0].n === 1 && code === normalizeInviteCode(BOOTSTRAP_INVITE_CODE)) {
      // The founding umpire becomes the admin, and is the only account
      // that gets the flag automatically -- everyone who joins later
      // arrives through an invite and stays a plain umpire.
      await client.query('UPDATE umpires SET is_admin = true WHERE id = $1', [
        umpireId,
      ])
      return null
    }
  }

  if (!code) return 'An invite code is required'

  const { rowCount } = await client.query(
    `UPDATE invites
        SET used_by = $2, used_at = now()
      WHERE code = $1
        AND used_by IS NULL
        AND (expires_at IS NULL OR expires_at > now())`,
    [code, umpireId],
  )

  // One message for "wrong", "already used" and "expired" alike, so
  // the endpoint can't be used to probe which codes exist.
  return rowCount === 1 ? null : 'That invite code is not valid'
}

router.post('/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const name = String(req.body?.name ?? '').trim()
  const password = String(req.body?.password ?? '')
  const invite = req.body?.invite

  if (!email || !name) {
    return res.status(400).json({ error: 'Email and name are required' })
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Email looks invalid' })
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    })
  }

  const password_hash = await hashPassword(password)

  try {
    const umpire = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO umpires (email, name, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, email, name`,
        [email, name, password_hash],
      )
      const created = rows[0]

      const inviteError = await claimInvite(client, invite, created.id)
      if (inviteError) {
        // Rolls back the umpire insert above.
        throw refusal(403, inviteError)
      }

      // Re-read is_admin rather than using the INSERT's value: the
      // founding umpire has the flag set by claimInvite() above, after
      // that insert already returned.
      const { rows: flags } = await client.query(
        'SELECT is_admin FROM umpires WHERE id = $1',
        [created.id],
      )
      return { ...created, is_admin: flags[0].is_admin }
    })

    res.status(201).json({ token: signToken(umpire), umpire })
  } catch (error) {
    if (error.statusCode === 403) {
      return res.status(403).json({ error: error.message })
    }
    // 23505 = unique_violation on umpires_email_lower_idx
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That email is already registered' })
    }
    throw error
  }
})

/**
 * Signing in with Google.
 *
 * Google proves who someone is; it does not decide whether they may
 * have an account here. Registration stays invite-only whichever door
 * is used, because this API is on the public internet and an umpire
 * account can write into the club's match data. Signing IN is free; the
 * first appearance of an unknown Google account still needs an invite.
 *
 * Three outcomes, in this order:
 *
 *   1. Google account already linked  -> sign in.
 *   2. Email matches an existing umpire -> link and sign in. Safe only
 *      because verifyGoogleToken refuses an unverified address, so
 *      Google has proved they own it. Without that check this branch
 *      would be a way to take over any account by claiming its email.
 *   3. Nobody yet -> invite required, and claimed in the same
 *      transaction that creates the umpire, exactly as /auth/register
 *      does. That keeps the single-use guarantee and the
 *      BOOTSTRAP_INVITE_CODE founding-admin path working unchanged.
 *
 * The response is the same shape login and register return, so nothing
 * downstream can tell which door was used.
 */
router.post('/google', async (req, res) => {
  let profile
  try {
    profile = await verifyGoogleToken(req.body?.credential)
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    throw error
  }

  const linked = await query(
    'SELECT id, email, name, is_admin FROM umpires WHERE google_sub = $1',
    [profile.sub],
  )
  if (linked.rows[0]) {
    return res.json({ token: signToken(linked.rows[0]), umpire: linked.rows[0] })
  }

  const byEmail = await query(
    `UPDATE umpires SET google_sub = $2
      WHERE lower(email) = $1 AND google_sub IS NULL
      RETURNING id, email, name, is_admin`,
    [profile.email, profile.sub],
  )
  if (byEmail.rows[0]) {
    return res.json({ token: signToken(byEmail.rows[0]), umpire: byEmail.rows[0] })
  }

  try {
    const umpire = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO umpires (email, name, google_sub)
         VALUES ($1, $2, $3)
         RETURNING id, email, name`,
        [profile.email, profile.name, profile.sub],
      )
      const created = rows[0]

      const inviteError = await claimInvite(client, req.body?.invite, created.id)
      // Rolls back the insert above, so a refused invite leaves no
      // half-made account behind.
      if (inviteError) throw refusal(403, inviteError)

      const { rows: flags } = await client.query(
        'SELECT is_admin FROM umpires WHERE id = $1',
        [created.id],
      )
      return { ...created, is_admin: flags[0].is_admin }
    })

    res.status(201).json({ token: signToken(umpire), umpire })
  } catch (error) {
    if (error.statusCode === 403) {
      // Tells the app to REVEAL the invite field rather than show a dead
      // end -- the same move /auth/player/register makes with needsCode.
      return res.status(403).json({ error: error.message, needsInvite: true })
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That email is already registered' })
    }
    throw error
  }
})

router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password ?? '')

  const { rows } = await query(
    `SELECT id, email, name, password_hash, is_admin
       FROM umpires
      WHERE lower(email) = $1`,
    [email],
  )
  const found = rows[0]

  // Hash a throwaway password when the email is unknown so that a
  // missing account and a wrong password take similar time to answer,
  // and both return the same message -- neither reveals whether an
  // email is registered.
  //
  // `found?.password_hash` rather than `found`, because an umpire who
  // signs in with Google has none. verifyPassword returns false the
  // instant it is handed a malformed hash, WITHOUT doing the scrypt
  // work -- so passing NULL here would make a Google-only account
  // answer measurably faster than a wrong password, and that timing
  // difference tells an attacker which accounts exist and how they
  // sign in. The same shape as /auth/player/login below, for the same
  // reason.
  const ok = found?.password_hash
    ? await verifyPassword(password, found.password_hash)
    : await verifyPassword(password, NO_SUCH_ACCOUNT_HASH)

  if (!found || !found.password_hash || !ok) {
    return res.status(401).json({ error: 'Incorrect email or password' })
  }

  const umpire = {
    id: found.id,
    email: found.email,
    name: found.name,
    is_admin: found.is_admin,
  }
  res.json({ token: signToken(umpire), umpire })
})

// Lets the app confirm a stored token is still valid on launch, so an
// expired session shows the login screen instead of failing later on
// the first real request mid-match.
router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query(
    'SELECT id, email, name, is_admin FROM umpires WHERE id = $1',
    [req.umpire.id],
  )
  if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists' })
  res.json({ umpire: rows[0] })
})

/**
 * A player claiming the record an umpire has been building for them.
 *
 * This lives here rather than in routes/players.js because that router
 * guards every route with requireAuth -- and a player claiming has no
 * token yet, which is the entire point. Mounting it there would reject
 * the request before it ever reached this handler.
 *
 * The FAST path in, and the reason it asks for no password: the data is
 * a player's own pickleball stats, and a signup step at the moment
 * someone is handed a QR courtside is exactly the friction that leaves
 * records unclaimed and the app pointless. Here the code is the whole
 * credential.
 *
 * It is not the only way in any more -- see /player/register below for
 * the durable one. The code stays valid after claiming, and stays valid
 * after a password is set, which makes an umpire regenerating it the
 * recovery path for a forgotten password. An umpire regenerating it
 * invalidates the old one.
 */
router.post('/player/claim', async (req, res) => {
  // Codes get read aloud and typed on phones, so accept any casing or
  // spacing. Without this, "pad 7k3m 9qxr" fails against the
  // exact-match unique index and the code simply looks broken.
  const code = normalizeInviteCode(req.body?.code)

  if (!code) return res.status(400).json({ error: 'Enter your code to continue' })

  // Clearing deactivated_at is the whole recovery path for a deleted
  // profile. Deleting an account wipes its claim code, so holding a
  // working one means an umpire minted a fresh one and handed it over --
  // the same trusted human in the loop as the forgotten-password case.
  // Without this a closed account would be unreachable forever.
  const { rows } = await query(
    `UPDATE players
        SET claimed_at     = COALESCE(claimed_at, now()),
            deactivated_at = NULL
      WHERE claim_code = $1
      RETURNING id, name, claimed_at, username`,
    [code],
  )

  if (rows.length === 0) {
    return res.status(404).json({ error: "That code doesn't match any player" })
  }

  const player = rows[0]
  res.json({
    token: signPlayerToken(player),
    player: {
      id: player.id,
      name: player.name,
      claimedAt: player.claimed_at,
      // Null unless they have already set up sign-in. Carried so a
      // registered player recovering with their code is not shown the
      // prompt to set up something they already have.
      username: player.username,
    },
  })
})

// ============================================================
// Player accounts
//
// A player has two ways in and both are meant to exist. The claim code
// above is the fast one: an umpire hands over a QR and the player is
// looking at their stats seconds later. A username and password is the
// durable one, surviving a lost code, a new phone and a cleared browser.
//
// The code proves who you are; the password keeps you in.
//
// No email is collected anywhere here. Nothing in this app has anything
// to send, so an address would be a username in disguise -- never
// verified, never used. See the schema comment on players.username.
// ============================================================

/**
 * Refuses a registration that would take over someone else's record.
 *
 * Throws on refusal and returns nothing on success -- the caller may
 * link the account to `existing` only if this does not throw.
 *
 * Players live in ONE table keyed by a case-insensitive unique name,
 * because the ML pipeline aggregates by player_id and the same human
 * has to resolve to the same row whichever umpire logged the match. So
 * a name that already exists is never simply handed over -- otherwise
 * registering as "Maria Santos" would inherit the real Maria's whole
 * history and her skill rating.
 *
 * The claim code is what settles it. Holding it is proof an umpire gave
 * it to you, which is the only evidence this system has about who
 * someone actually is.
 *
 * `needsCode` tells the app to REVEAL the code field rather than show a
 * dead end -- that is the entire user experience of this branch, and
 * the moment the two ways in become one flow.
 */
function assertMayLinkTo(existing, code) {
  if (existing.password_hash) {
    throw refusal(
      409,
      `Someone called ${existing.name} already has an account. ` +
        'If that is you, sign in instead.',
    )
  }

  // Codes are minted lazily, so a player created before that was
  // routine can still have none. Nothing can match, and the umpire
  // mints one from the roster -- correct, if briefly puzzling.
  if (!existing.claim_code || !code || code !== existing.claim_code) {
    throw refusal(
      409,
      `${existing.name} is already on the roster. Enter the code whoever ` +
        'scores your matches gave you and this account will pick up all ' +
        'the matches already recorded for you.',
      { needsCode: true },
    )
  }
}

/**
 * Sign up as a player: either a brand-new person, or someone an umpire
 * has already been recording matches for.
 *
 * Both cases end at the same place -- one row in `players` carrying a
 * username and a password hash -- which is why they are one endpoint
 * rather than a register and a separate link step.
 */
router.post('/player/register', async (req, res) => {
  const name = normalizePlayerName(req.body?.name)
  const username = normalizeUsername(req.body?.username)
  const password = String(req.body?.password ?? '')
  const code = normalizeInviteCode(req.body?.code)

  const nameError = playerNameError(name)
  if (nameError) return res.status(400).json({ error: nameError })
  if (!isValidUsername(username)) {
    return res.status(400).json({ error: USERNAME_RULE })
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    })
  }

  const password_hash = await hashPassword(password)

  try {
    const player = await withTransaction(async (client) => {
      // Attempt the new-person case first, and let the unique index
      // decide. A SELECT-then-INSERT would let two people registering
      // the same new name at the same moment both pass the check --
      // the same reasoning as POST /players.
      const inserted = await client.query(
        `INSERT INTO players (name, username, password_hash, claim_code,
                              claimed_at, registered_at)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (lower(name)) DO NOTHING
         RETURNING id, name, claimed_at, username`,
        [name, username, password_hash, generateInviteCode()],
      )
      if (inserted.rowCount === 1) return inserted.rows[0]

      // The name is taken. Either this is the person an umpire has been
      // recording matches for, or it is not.
      const { rows } = await client.query(
        `SELECT id, name, claim_code, password_hash
           FROM players
          WHERE lower(name) = lower($1)`,
        [name],
      )
      // The insert conflicted, so a row with this name is committed --
      // unless a concurrent delete removed it in between. Refuse
      // rather than throw a TypeError into a 500.
      if (!rows[0]) throw refusal(409, 'That name is taken. Try again.')
      assertMayLinkTo(rows[0], code)

      // deactivated_at is cleared for the same reason /player/claim
      // clears it: a closed account whose code was re-minted is being
      // legitimately recovered, and assertMayLinkTo has already checked
      // that code.
      const updated = await client.query(
        `UPDATE players
            SET username       = $2,
                password_hash  = $3,
                registered_at  = now(),
                claimed_at     = COALESCE(claimed_at, now()),
                deactivated_at = NULL
          WHERE id = $1
          RETURNING id, name, claimed_at, username`,
        [rows[0].id, username, password_hash],
      )
      return updated.rows[0]
    })

    res.status(201).json({
      token: signPlayerToken(player),
      player: {
        id: player.id,
        name: player.name,
        claimedAt: player.claimed_at,
        username: player.username,
      },
    })
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        ...error.extra,
      })
    }
    // 23505 = unique_violation. Named per index so the app can point at
    // the field that actually needs changing; the name collision is
    // handled above and never reaches here.
    if (error.constraint === 'players_username_lower_idx') {
      return res.status(409).json({
        error: 'That username is taken',
        usernameTaken: true,
      })
    }
    throw error
  }
})

/** Sign in with the username and password a player chose themselves. */
router.post('/player/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username)
  const password = String(req.body?.password ?? '')

  const { rows } = await query(
    `SELECT id, name, claimed_at, username, password_hash
       FROM players
      WHERE lower(username) = $1`,
    [username],
  )
  const found = rows[0]

  // An unregistered player row has a username of NULL and so cannot be
  // found here at all, but check the hash anyway rather than relying on
  // that -- and do the scrypt work in every branch so an unknown
  // username and a wrong password cost the same. One message for both.
  const ok = found?.password_hash
    ? await verifyPassword(password, found.password_hash)
    : await verifyPassword(password, NO_SUCH_ACCOUNT_HASH)

  if (!found || !found.password_hash || !ok) {
    return res.status(401).json({ error: 'Incorrect username or password' })
  }

  res.json({
    token: signPlayerToken(found),
    player: {
      id: found.id,
      name: found.name,
      claimedAt: found.claimed_at,
      username: found.username,
    },
  })
})

/**
 * Sets up sign-in, or changes it afterwards.
 *
 * This is the endpoint that actually retires "you'll need your code
 * again to get back in": someone who scanned a QR courtside can pick a
 * username and password afterwards, at their leisure, without ever
 * seeing a sign-up form first. It doubles as the edit path on the
 * profile screen, which is why it takes partial updates.
 *
 * What is required depends on what the account already has:
 *
 *   no password yet  -> BOTH username and password. Half an account is
 *                       not a state worth being able to reach.
 *   password already -> at least one of username / password, plus
 *                       currentPassword.
 *
 * currentPassword gates a USERNAME change as well as a password change,
 * which is not obvious and is deliberate. Without it, a phone left
 * unlocked on the profile screen is an account takeover -- silently
 * changing the username someone signs in with locks them out just as
 * effectively as changing the password, and they would never know.
 */
router.post(
  '/player/credentials',
  requirePlayer,
  requireActivePlayer(query),
  async (req, res) => {
    const wantsUsername = req.body?.username !== undefined
    const wantsPassword = req.body?.password !== undefined
    const username = normalizeUsername(req.body?.username)
    const password = String(req.body?.password ?? '')
    const currentPassword = String(req.body?.currentPassword ?? '')

    const { rows } = await query(
      'SELECT username, password_hash FROM players WHERE id = $1',
      [req.player.id],
    )
    if (!rows[0]) {
      return res.status(401).json({ error: 'That player no longer exists' })
    }
    const existing = rows[0].password_hash

    if (!existing && !(wantsUsername && wantsPassword)) {
      return res.status(400).json({
        error: 'Pick both a username and a password to set up sign-in',
      })
    }
    if (!wantsUsername && !wantsPassword) {
      return res.status(400).json({ error: 'Nothing to change' })
    }
    if (wantsUsername && !isValidUsername(username)) {
      return res.status(400).json({ error: USERNAME_RULE })
    }
    if (wantsPassword && password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      })
    }

    if (existing && !(await verifyPassword(currentPassword, existing))) {
      return res.status(403).json({
        error: 'Enter your current password to change it',
        needsCurrentPassword: true,
      })
    }

    // COALESCE would not do here: the point is to leave the untouched
    // column alone entirely, and only the caller knows which that is.
    const sets = ['registered_at = COALESCE(registered_at, now())']
    const values = [req.player.id]
    if (wantsUsername) {
      values.push(username)
      sets.push(`username = $${values.length}`)
    }
    if (wantsPassword) {
      values.push(await hashPassword(password))
      sets.push(`password_hash = $${values.length}`)
    }

    let updated
    try {
      ;({ rows: updated } = await query(
        `UPDATE players SET ${sets.join(', ')} WHERE id = $1 RETURNING username`,
        values,
      ))
    } catch (error) {
      if (error.constraint === 'players_username_lower_idx') {
        return res.status(409).json({
          error: 'That username is taken',
          usernameTaken: true,
        })
      }
      throw error
    }

    res.json({ username: updated[0].username })
  },
)

/** Confirms a stored player token is still good, on app launch. */
router.get('/player/me', requirePlayer, requireActivePlayer(query), async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, claimed_at, username FROM players WHERE id = $1',
    [req.player.id],
  )
  if (!rows[0]) return res.status(401).json({ error: 'That player no longer exists' })
  // `username` is null for a player who came in by code and has not set
  // one up. The app reads that to decide whether to offer the prompt.
  res.json({
    player: {
      id: rows[0].id,
      name: rows[0].name,
      claimedAt: rows[0].claimed_at,
      username: rows[0].username,
    },
  })
})

export default router
