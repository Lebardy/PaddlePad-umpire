// A player's sign-in and account routes, mounted at /auth beside the
// umpire's (routes/auth.js): /auth/player/...

import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import {
  MIN_PASSWORD_LENGTH,
  NO_SUCH_ACCOUNT_HASH,
  hashPassword,
  requireActivePlayer,
  requirePlayer,
  signPlayerToken,
  verifyPassword,
} from '../auth.js'
import { normalizeInviteCode } from '../invites.js'
import { resolveGoogleProfile } from '../google.js'
import { PAUSED_MESSAGE, signInRefusal } from '../people-rules.js'
import { noteSignIn } from '../player-accounts.js'
import {
  USERNAME_RULE,
  isValidUsername,
  normalizePlayerName,
  normalizeUsername,
  playerNameError,
} from '../validate.js'

const router = Router()

/** An error carrying the status and extra fields a handler should return. */
function refusal(statusCode, message, extra = {}) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.extra = extra
  return error
}

/** Sends the refusal for a paused or closed person, or returns false. */
function refuseSignIn(res, row, closedColumn) {
  const refused = signInRefusal(row, closedColumn)
  if (!refused) return false
  res.status(refused.statusCode).json(refused.body)
  return true
}

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
 * the durable one. The code stays valid after claiming, for as long as
 * it is the player's ONLY way in. The moment they have a password or a
 * Google account it is cleared (every route below that sets one says
 * `claim_code = NULL`), so a code that was read out or sent around
 * earlier is not left behind as a spare key. A forgotten password is
 * still recovered with a code: an umpire or admin makes a NEW one.
 */
router.post('/player/claim', async (req, res) => {
  // Codes get read aloud and typed on phones, so accept any casing or
  // spacing. Without this, "pad 7k3m 9qxr" fails against the
  // exact-match unique index and the code simply looks broken.
  const code = normalizeInviteCode(req.body?.code)

  if (!code) return res.status(400).json({ error: 'Enter your code to continue' })

  // A claim code must never un-pause anyone, so a pause is checked
  // before it can do anything -- the UPDATE below also guards against
  // one landing between this check and that statement.
  const { rows: holder } = await query(
    'SELECT paused_at FROM players WHERE claim_code = $1',
    [code],
  )
  if (holder[0]?.paused_at) {
    const refused = signInRefusal({ paused_at: holder[0].paused_at }, 'deactivated_at')
    return res.status(refused.statusCode).json(refused.body)
  }

  // Clearing deactivated_at is the whole recovery path for a deleted
  // profile. Deleting an account wipes its claim code, so holding a
  // working one means an umpire minted a fresh one and handed it over --
  // the same trusted human in the loop as the forgotten-password case.
  // Without this a closed account would be unreachable forever.
  //
  // closed_by_admin_at clears the same way: reaching this row at all
  // means the umpire route already refused to mint a code for it while
  // that column was set (see people-rules.js mayMintClaimCode), so a
  // working code here only ever came from the owner.
  const { rows } = await query(
    `UPDATE players
        SET claimed_at         = COALESCE(claimed_at, now()),
            deactivated_at     = NULL,
            closed_by_admin_at = NULL
      WHERE claim_code = $1
        AND paused_at IS NULL
      RETURNING id, name, claimed_at, username, google_email`,
    [code],
  )

  if (rows.length === 0) {
    return res.status(404).json({ error: "That code doesn't match any player" })
  }

  const player = rows[0]
  await noteSignIn(query, 'players', player.id)
  // The payload carries `username`, which is null unless they have
  // already set up sign-in -- so a registered player recovering with
  // their code is not shown the prompt to set up something they
  // already have.
  res.json({ token: signPlayerToken(player), player: playerPayload(player) })
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
 * The player facts the app is given back, whichever door was used.
 *
 * `username` is null for someone who came in by code and has not set
 * up sign-in; `googleEmail` is null unless a Google account is
 * connected. The settings screen reads both to decide what to offer,
 * so every response that hands back a player has to carry them.
 */
function playerPayload(row) {
  return {
    id: row.id,
    name: row.name,
    claimedAt: row.claimed_at,
    username: row.username,
    googleEmail: row.google_email,
  }
}

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

  // Checked last, and only reachable once the right code has matched:
  // holding it is the only proof that earns the caller the truth about
  // a pause. Checking it earlier would let anyone typing a paused
  // player's NAME learn they are paused without ever proving who they are.
  if (existing.paused_at) {
    throw refusal(403, PAUSED_MESSAGE, { status: 'paused' })
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
        `INSERT INTO players (name, username, password_hash,
                              claimed_at, registered_at)
         VALUES ($1, $2, $3, now(), now())
         ON CONFLICT (lower(name)) DO NOTHING
         RETURNING id, name, claimed_at, username, google_email`,
        [name, username, password_hash],
      )
      if (inserted.rowCount === 1) return inserted.rows[0]

      // The name is taken. Either this is the person an umpire has been
      // recording matches for, or it is not.
      const { rows } = await client.query(
        `SELECT id, name, claim_code, password_hash, paused_at
           FROM players
          WHERE lower(name) = lower($1)`,
        [name],
      )
      // The insert conflicted, so a row with this name is committed --
      // unless a concurrent delete removed it in between. Refuse
      // rather than throw a TypeError into a 500.
      if (!rows[0]) throw refusal(409, 'That name is taken. Try again.')
      assertMayLinkTo(rows[0], code)

      // deactivated_at (and closed_by_admin_at with it) is cleared for
      // the same reason /player/claim clears it: a closed account whose
      // code was re-minted is being legitimately recovered, and
      // assertMayLinkTo has already checked that code.
      const updated = await client.query(
        `UPDATE players
            SET username           = $2,
                password_hash       = $3,
                claim_code          = NULL,
                registered_at       = now(),
                claimed_at          = COALESCE(claimed_at, now()),
                deactivated_at      = NULL,
                closed_by_admin_at  = NULL
          WHERE id = $1
          RETURNING id, name, claimed_at, username, google_email`,
        [rows[0].id, username, password_hash],
      )
      return updated.rows[0]
    })

    await noteSignIn(query, 'players', player.id)

    res.status(201).json({
      token: signPlayerToken(player),
      player: playerPayload(player),
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
    `SELECT id, name, claimed_at, username, google_email, password_hash, paused_at
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

  if (refuseSignIn(res, found, 'deactivated_at')) return
  await noteSignIn(query, 'players', found.id)

  res.json({ token: signPlayerToken(found), player: playerPayload(found) })
})

/**
 * The third way in: Google.
 *
 * Everything hard about this is in the FIRST sign-in, and it is worth
 * being clear about why it cannot be one tap the way the umpire app's
 * is. /auth/google can attach a Google account to an umpire on sight,
 * because umpires have an email column holding the address they signed
 * up with, and a matching address is decent evidence of the same
 * person. Players have no such column and never did. Google hands us a
 * display name and an address; neither is evidence about which row on
 * the roster this human is.
 *
 * So this endpoint resolves identity exactly the way /player/register
 * does, and shares assertMayLinkTo with it:
 *
 *   Google account already known  -> signed in, one tap, forever after.
 *   Not known, no name given      -> 403 needsName, and the app reveals
 *                                    a name field prefilled with what
 *                                    Google calls them.
 *   Name is free                  -> a new player row is created.
 *   Name is on the roster         -> the claim code is required, and
 *                                    the account picks up every match
 *                                    already recorded under that name.
 *
 * Only the first of those is a "sign in". The rest are the same
 * registration this app already had, wearing a different credential.
 */
router.post('/player/google', async (req, res) => {
  let profile
  try {
    profile = await resolveGoogleProfile(req.body ?? {})
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    throw error
  }

  // The returning case. Matched on the sub and nothing else -- see the
  // schema comment on players.google_sub for why an address must never
  // be used here.
  //
  // The address is refreshed on the way through because people do
  // change them, and a stale one on the profile screen would name a
  // Google account that no longer exists. It is display only, so
  // overwriting it settles nothing about who this is.
  const linked = await query(
    `UPDATE players SET google_email = $2
      WHERE google_sub = $1
      RETURNING id, name, claimed_at, username, google_email, paused_at, deactivated_at`,
    [profile.sub, profile.email],
  )
  if (linked.rows[0]) {
    const player = linked.rows[0]
    if (refuseSignIn(res, player, 'deactivated_at')) return
    await noteSignIn(query, 'players', player.id)
    return res.json({ token: signPlayerToken(player), player: playerPayload(player) })
  }

  const name = normalizePlayerName(req.body?.name)

  // Not a dead end, and not an error the app should print raw: it is
  // the moment the app asks who this is, with Google's own idea of the
  // answer already typed in. The same shape as needsInvite and
  // needsCode elsewhere in this file.
  if (!name) {
    return res.status(403).json({
      error: 'Tell us the name your matches are scored under',
      needsName: true,
      suggestedName: profile.name ?? '',
    })
  }

  const nameError = playerNameError(name)
  if (nameError) return res.status(400).json({ error: nameError })

  const code = normalizeInviteCode(req.body?.code)

  try {
    const player = await withTransaction(async (client) => {
      // Try the new-person case and let the unique index decide, for
      // the same reason /player/register does: a SELECT first would let
      // two people registering the same new name at the same instant
      // both pass the check.
      const inserted = await client.query(
        `INSERT INTO players (name, google_sub, google_email,
                              claimed_at, registered_at)
         VALUES ($1, $2, $3, now(), now())
         ON CONFLICT (lower(name)) DO NOTHING
         RETURNING id, name, claimed_at, username, google_email`,
        [name, profile.sub, profile.email],
      )
      if (inserted.rowCount === 1) return inserted.rows[0]

      const { rows } = await client.query(
        `SELECT id, name, claim_code, password_hash, google_sub, paused_at
           FROM players
          WHERE lower(name) = lower($1)`,
        [name],
      )
      if (!rows[0]) throw refusal(409, 'That name is taken. Try again.')

      // Someone already signs in as this player with a DIFFERENT Google
      // account. A claim code is not enough to override that: codes
      // stay valid after an account is set up (see schema.sql), so
      // holding one is not permission to take over a live account.
      // assertMayLinkTo says the same thing about a password below.
      if (rows[0].google_sub) {
        throw refusal(
          409,
          `${rows[0].name} already signs in with Google. If that is you, ` +
            'use that Google account.',
        )
      }

      assertMayLinkTo(rows[0], code)

      // deactivated_at (and closed_by_admin_at with it) clears for the
      // same reason it does in /player/claim and /player/register:
      // assertMayLinkTo has just checked a working claim code, which
      // only exists because an umpire minted one and handed it over.
      const updated = await client.query(
        `UPDATE players
            SET google_sub         = $2,
                google_email       = $3,
                claim_code         = NULL,
                registered_at      = COALESCE(registered_at, now()),
                claimed_at         = COALESCE(claimed_at, now()),
                deactivated_at     = NULL,
                closed_by_admin_at = NULL
          WHERE id = $1
          RETURNING id, name, claimed_at, username, google_email`,
        [rows[0].id, profile.sub, profile.email],
      )
      return updated.rows[0]
    })

    await noteSignIn(query, 'players', player.id)

    res.status(201).json({
      token: signPlayerToken(player),
      player: playerPayload(player),
    })
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message, ...error.extra })
    }
    // Two requests racing with the same Google account and different
    // new names: the name index let both through, this one did not.
    if (error.constraint === 'players_google_sub_idx') {
      return res.status(409).json({
        error: 'That Google account is already connected to another player',
      })
    }
    throw error
  }
})

/**
 * Connects Google to the account the caller already has.
 *
 * This is the path most people will actually take, because most people
 * arrive by scanning a code courtside and only think about signing in
 * again days later. Without it they would have to guess that "sign in
 * with Google" on the gate would find them, and it would not -- their
 * row has no Google account attached yet.
 *
 * currentPassword is required when the account HAS a password, and the
 * reasoning is /player/credentials' word for word: a phone left
 * unlocked on the settings screen must not be an account takeover.
 * Attaching a stranger's Google account here would hand them permanent
 * one-tap access, which is worse than changing the password, not
 * better -- the owner would not even be locked out to notice.
 *
 * Where there is no password there is nothing to ask for and the token
 * is the proof, the same rule DELETE /player/me already follows.
 */
router.post(
  '/player/google/link',
  requirePlayer,
  requireActivePlayer(query),
  async (req, res) => {
    let profile
    try {
      profile = await resolveGoogleProfile(req.body ?? {})
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message })
      }
      throw error
    }

    const { rows } = await query(
      `SELECT id, name, claimed_at, username, password_hash, google_sub
         FROM players WHERE id = $1`,
      [req.player.id],
    )
    if (!rows[0]) return res.status(401).json({ error: 'That player no longer exists' })
    const found = rows[0]

    if (found.password_hash) {
      const currentPassword = String(req.body?.currentPassword ?? '')
      if (!(await verifyPassword(currentPassword, found.password_hash))) {
        return res.status(403).json({
          error: 'Enter your password to connect a Google account',
          needsCurrentPassword: true,
        })
      }
    }

    // Already wearing a different Google account. Replacing it silently
    // would quietly cut off whoever had been signing in with the old
    // one -- /auth/google/link refuses this for umpires for the same
    // reason.
    if (found.google_sub && found.google_sub !== profile.sub) {
      return res.status(409).json({
        error: 'This account is already connected to a different Google account.',
      })
    }

    let updated
    try {
      ;({ rows: updated } = await query(
        `UPDATE players
            SET google_sub    = $2,
                google_email  = $3,
                claim_code    = NULL,
                registered_at = COALESCE(registered_at, now())
          WHERE id = $1
          RETURNING id, name, claimed_at, username, google_email`,
        [found.id, profile.sub, profile.email],
      ))
    } catch (error) {
      if (error.constraint === 'players_google_sub_idx') {
        return res.status(409).json({
          error: 'That Google account is already connected to another player.',
        })
      }
      throw error
    }

    res.json({ player: playerPayload(updated[0]) })
  },
)

/**
 * Disconnects Google.
 *
 * Refused when it would leave no way back in. An account whose only
 * credential is Google has no claim code either (connecting Google
 * cleared it), so it would be unreachable the moment this succeeded --
 * there is no email here and so no reset link, and the honest answer is
 * to say so rather than to strand someone politely.
 *
 * A claim code IS enough to allow it, when an umpire has made a new one
 * for them: that is this app's whole recovery path, and unlike a reset
 * email it has a trusted human in the loop.
 */
router.post(
  '/player/google/unlink',
  requirePlayer,
  requireActivePlayer(query),
  async (req, res) => {
    const { rows } = await query(
      `SELECT id, name, claimed_at, username, password_hash, claim_code, google_sub
         FROM players WHERE id = $1`,
      [req.player.id],
    )
    if (!rows[0]) return res.status(401).json({ error: 'That player no longer exists' })
    const found = rows[0]

    if (!found.google_sub) {
      return res.status(409).json({ error: 'No Google account is connected' })
    }

    if (found.password_hash) {
      const currentPassword = String(req.body?.currentPassword ?? '')
      if (!(await verifyPassword(currentPassword, found.password_hash))) {
        return res.status(403).json({
          error: 'Enter your password to disconnect Google',
          needsCurrentPassword: true,
        })
      }
    } else if (!found.claim_code) {
      return res.status(409).json({
        error:
          'Google is the only way into this account. Set up a username and ' +
          'password first, or ask whoever scores your matches for a code.',
      })
    }

    const { rows: updated } = await query(
      `UPDATE players SET google_sub = NULL, google_email = NULL
        WHERE id = $1
        RETURNING id, name, claimed_at, username, google_email`,
      [found.id],
    )

    res.json({ player: playerPayload(updated[0]) })
  },
)

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
      // With a password of their own, the code is no longer a way in.
      sets.push('claim_code = NULL')
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
    `SELECT id, name, claimed_at, username, google_email
       FROM players WHERE id = $1`,
    [req.player.id],
  )
  if (!rows[0]) return res.status(401).json({ error: 'That player no longer exists' })
  res.json({ player: playerPayload(rows[0]) })
})

export default router
