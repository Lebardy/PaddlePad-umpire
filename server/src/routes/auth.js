import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import {
  MIN_PASSWORD_LENGTH,
  NO_SUCH_ACCOUNT_HASH,
  hashPassword,
  requireActiveUmpire,
  requireAuth,
  requireActivePlayer,
  requirePlayer,
  signPlayerToken,
  signToken,
  verifyPassword,
} from '../auth.js'
import { generateInviteCode, normalizeInviteCode } from '../invites.js'
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

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * The umpire half of every auth response, built from a row.
 *
 * `hasPassword` rather than the hash: the account screen has to know
 * whether to ask for a current password, and whether disconnecting
 * Google would strand the account. Neither question needs the hash to
 * leave the server.
 *
 * `googleEmail` is display only -- see the schema comment on
 * umpires.google_email. Nothing signs in on the strength of it.
 */
function umpirePayload(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    googleEmail: row.google_email ?? null,
    hasPassword: Boolean(row.password_hash),
  }
}

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
 * @returns {Promise<{error: string} | {facilityId: string|null}>}
 */
async function claimInvite(client, rawCode, umpireId) {
  const code = normalizeInviteCode(rawCode)

  if (BOOTSTRAP_INVITE_CODE) {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM umpires')
    // The new umpire is already inserted at this point, so "empty
    // before this registration" means exactly one row.
    if (rows[0].n === 1 && code === normalizeInviteCode(BOOTSTRAP_INVITE_CODE)) {
      // Lets the very first umpire in. Admin powers live on the admin
      // site now, so this makes no one an admin. There is no invite
      // code to read a facility from, so the new umpire joins the only
      // facility if there is exactly one, and otherwise joins none yet.
      const { rows: facilities } = await client.query('SELECT id FROM facilities')
      return { facilityId: facilities.length === 1 ? facilities[0].id : null }
    }
  }

  if (!code) return { error: 'An invite code is required' }

  const { rows } = await client.query(
    `UPDATE invites
        SET used_by = $2, used_at = now()
      WHERE code = $1
        AND used_by IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING facility_id`,
    [code, umpireId],
  )

  // One message for "wrong", "already used" and "expired" alike, so
  // the endpoint can't be used to probe which codes exist.
  if (rows.length !== 1) return { error: 'That invite code is not valid' }
  return { facilityId: rows[0].facility_id }
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
         RETURNING id, email, name, password_hash, google_email`,
        [email, name, password_hash],
      )
      const created = rows[0]

      const claimed = await claimInvite(client, invite, created.id)
      if (claimed.error) {
        // Rolls back the umpire insert above.
        throw refusal(403, claimed.error)
      }
      await client.query('UPDATE umpires SET facility_id = $2 WHERE id = $1', [created.id, claimed.facilityId])

      return created
    })

    // A new account is never paused, so there is nothing to refuse here.
    await noteSignIn(query, 'umpires', umpire.id)

    res.status(201).json({ token: signToken(umpire), umpire: umpirePayload(umpire) })
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
 *      BOOTSTRAP_INVITE_CODE first-umpire path working unchanged.
 *
 * The response is the same shape login and register return, so nothing
 * downstream can tell which door was used.
 */
router.post('/google', async (req, res) => {
  let profile
  try {
    profile = await resolveGoogleProfile(req.body ?? {})
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    throw error
  }

  // An UPDATE rather than a SELECT so a Google address that has since
  // changed is kept current -- it is shown on the account screen, and a
  // stale one would have someone looking at an address that is no
  // longer theirs. google_sub, which is what actually matched, never
  // changes.
  const linked = await query(
    `UPDATE umpires SET google_email = $2
      WHERE google_sub = $1
      RETURNING id, email, name, password_hash, google_email, paused_at, closed_at`,
    [profile.sub, profile.email],
  )
  if (linked.rows[0]) {
    if (refuseSignIn(res, linked.rows[0], 'closed_at')) return
    await noteSignIn(query, 'umpires', linked.rows[0].id)
    return res.json({
      token: signToken(linked.rows[0]),
      umpire: umpirePayload(linked.rows[0]),
    })
  }

  // A SELECT first, refusing a paused or closed umpire before anything
  // is written -- unlike the `linked` branch above, this one would
  // otherwise attach a brand-new Google link to the account, which is a
  // new way IN, not just a display refresh. A pause made because an
  // account looked taken over must not hand it one anyway.
  const { rows: byEmailFound } = await query(
    `SELECT id, email, name, password_hash, google_email, paused_at, closed_at
       FROM umpires WHERE lower(email) = $1 AND google_sub IS NULL`,
    [profile.email],
  )
  if (byEmailFound[0]) {
    if (refuseSignIn(res, byEmailFound[0], 'closed_at')) return
    // AND google_sub IS NULL guards the same race the SELECT above
    // does: if a concurrent request already linked a Google account to
    // this row between that SELECT and this UPDATE, this one matches no
    // row rather than overwriting it. Falls through to the invite path
    // below exactly as if nobody had matched by email at all.
    const { rows: byEmail } = await query(
      `UPDATE umpires SET google_sub = $2, google_email = $3
        WHERE id = $1 AND google_sub IS NULL
        RETURNING id, email, name, password_hash, google_email`,
      [byEmailFound[0].id, profile.sub, profile.email],
    )
    if (byEmail[0]) {
      await noteSignIn(query, 'umpires', byEmail[0].id)
      return res.json({
        token: signToken(byEmail[0]),
        umpire: umpirePayload(byEmail[0]),
      })
    }
  }

  try {
    const umpire = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO umpires (email, name, google_sub, google_email)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, password_hash, google_email`,
        [profile.email, profile.name, profile.sub, profile.email],
      )
      const created = rows[0]

      const claimed = await claimInvite(client, req.body?.invite, created.id)
      // Rolls back the insert above, so a refused invite leaves no
      // half-made account behind.
      if (claimed.error) throw refusal(403, claimed.error)
      await client.query('UPDATE umpires SET facility_id = $2 WHERE id = $1', [created.id, claimed.facilityId])

      return created
    })

    // A new account is never paused, so there is nothing to refuse here.
    await noteSignIn(query, 'umpires', umpire.id)

    res.status(201).json({ token: signToken(umpire), umpire: umpirePayload(umpire) })
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

/**
 * Connects a Google account to an umpire account that already exists,
 * proved with that account's own password.
 *
 * The gap this closes: /auth/google links automatically when the Google
 * address matches an umpire's email, which covers most people. It
 * cannot help someone whose account here is one address and whose
 * Google account is another -- a work email and a personal Gmail, say.
 * They would have been asked for an invite they do not need, having
 * been an umpire all along, and would have gone on typing a password
 * forever.
 *
 * The password is what makes this safe. Google has proved they own the
 * Google account; the password proves they own the one here. Neither
 * alone would be enough, and an endpoint that linked on the strength of
 * a Google sign-in alone would let anyone attach themselves to any
 * account whose email they could guess.
 */
router.post('/google/link', async (req, res) => {
  let profile
  try {
    profile = await resolveGoogleProfile(req.body ?? {})
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    throw error
  }

  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password ?? '')

  const { rows } = await query(
    `SELECT id, email, name, password_hash, google_sub, google_email, paused_at, closed_at
       FROM umpires WHERE lower(email) = $1`,
    [email],
  )
  const found = rows[0]

  // Same constant-time shape as /auth/login: do the scrypt work in
  // every branch, because verifyPassword returns instantly on a
  // malformed hash and a fast "no" would say which accounts exist and
  // which are Google-only.
  const ok = found?.password_hash
    ? await verifyPassword(password, found.password_hash)
    : await verifyPassword(password, NO_SUCH_ACCOUNT_HASH)

  if (!found || !found.password_hash || !ok) {
    return res.status(401).json({ error: 'Incorrect email or password' })
  }

  if (refuseSignIn(res, found, 'closed_at')) return

  // Already wearing a different Google account. Silently replacing it
  // would quietly lock out whoever had been using the old one.
  if (found.google_sub && found.google_sub !== profile.sub) {
    return res.status(409).json({
      error: 'That account is already connected to a different Google account.',
    })
  }

  let linked
  try {
    ;({ rows: linked } = await query(
      `UPDATE umpires SET google_sub = $2, google_email = $3 WHERE id = $1
        RETURNING id, email, name, password_hash, google_email`,
      [found.id, profile.sub, profile.email],
    ))
  } catch (error) {
    // 23505 on umpires_google_sub_idx: this Google account is already
    // attached to somebody else here.
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'That Google account is already connected to another umpire.',
      })
    }
    throw error
  }

  await noteSignIn(query, 'umpires', linked[0].id)

  res.json({ token: signToken(linked[0]), umpire: umpirePayload(linked[0]) })
})

router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email)
  const password = String(req.body?.password ?? '')

  const { rows } = await query(
    `SELECT id, email, name, password_hash, google_email, paused_at, closed_at
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

  // Comes after the password check, so a wrong password still answers
  // "Incorrect email or password" and pausing reveals nothing to
  // someone who doesn't know it.
  if (refuseSignIn(res, found, 'closed_at')) return
  await noteSignIn(query, 'umpires', found.id)

  res.json({ token: signToken(found), umpire: umpirePayload(found) })
})

// Lets the app confirm a stored token is still valid on launch, so an
// expired session shows the login screen instead of failing later on
// the first real request mid-match.
router.get('/me', requireAuth, requireActiveUmpire(query), async (req, res) => {
  const { rows } = await query(
    `SELECT id, email, name, password_hash, google_email
       FROM umpires WHERE id = $1`,
    [req.umpire.id],
  )
  if (!rows[0]) return res.status(401).json({ error: 'Account no longer exists' })
  res.json({ umpire: umpirePayload(rows[0]) })
})

/**
 * ============================================================
 * The umpire's own account.
 *
 * Everything below acts on the token's own umpire and nothing else.
 * Until these existed a signed-in umpire could change nothing at all:
 * connecting Google meant signing OUT, taking the refusal branch on the
 * gate and proving the account with its password -- and signing out is
 * the one thing an umpire with unsynced matches must not do.
 *
 * The rule they share: when the account has a password, changing
 * anything that could become a way in asks for that password first.
 * Google has proved someone owns a Google account; only the password
 * proves they own THIS one. Without that, a phone left unlocked on the
 * account screen is an account takeover, and a quiet one -- the owner is
 * never locked out, so nothing tells them it happened.
 * ============================================================
 */

/** The signed-in umpire's row, or null if the account is gone. */
async function loadUmpire(id) {
  const { rows } = await query(
    `SELECT id, email, name, password_hash, google_sub, google_email
       FROM umpires WHERE id = $1`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * Verifies the current password when the account has one.
 *
 * Returns true when the caller may proceed. Where there is no password
 * there is nothing to ask for and the token is the proof, the same rule
 * /player/google/link follows.
 */
async function confirmedWithPassword(row, req, res, action) {
  if (!row.password_hash) return true
  const currentPassword = String(req.body?.currentPassword ?? '')
  if (await verifyPassword(currentPassword, row.password_hash)) return true
  res.status(403).json({
    error: `Enter your password to ${action}`,
    needsCurrentPassword: true,
  })
  return false
}

/**
 * Changes the name, the email, or both.
 *
 * Changing the email is confirmed with the password and changing the
 * name is not, because they are not the same kind of change. A name is what
 * other umpires see against a session. An email is a way in: /auth/google
 * links a Google account to an umpire whose email MATCHES, so an
 * attacker who could quietly move this account to an address they own
 * could then walk in through Google without ever knowing the password.
 */
router.patch('/me', requireAuth, requireActiveUmpire(query), async (req, res) => {
  const found = await loadUmpire(req.umpire.id)
  if (!found) return res.status(401).json({ error: 'Account no longer exists' })

  const name =
    req.body?.name === undefined ? found.name : String(req.body.name).trim()
  const email =
    req.body?.email === undefined ? found.email : normalizeEmail(req.body.email)

  if (!name) return res.status(400).json({ error: 'Name is required' })
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Email looks invalid' })
  }

  const emailChanged = email !== normalizeEmail(found.email)
  if (emailChanged && !(await confirmedWithPassword(found, req, res, 'change your email'))) {
    return
  }

  let updated
  try {
    ;({ rows: updated } = await query(
      `UPDATE umpires SET name = $2, email = $3 WHERE id = $1
        RETURNING id, email, name, password_hash, google_email`,
      [found.id, name, email],
    ))
  } catch (error) {
    // 23505 on umpires_email_lower_idx: somebody else already has it.
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That email is already registered' })
    }
    throw error
  }

  // A fresh token because the old one carries the old name in its
  // claims. Nothing authorises on that claim -- only `sub` is used --
  // but a token that disagrees with the account it belongs to is a trap
  // for whatever reads it next.
  res.json({ token: signToken(updated[0]), umpire: umpirePayload(updated[0]) })
})

/**
 * Changes the password, or sets the first one.
 *
 * An umpire who signed up through Google has no password at all, and
 * this is how they get one -- which is also the only way they can ever
 * disconnect Google, since that is refused while it is their only way
 * in.
 */
router.post('/me/password', requireAuth, requireActiveUmpire(query), async (req, res) => {
  const found = await loadUmpire(req.umpire.id)
  if (!found) return res.status(401).json({ error: 'Account no longer exists' })

  const password = String(req.body?.password ?? '')
  if (password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    })
  }

  if (!(await confirmedWithPassword(found, req, res, 'change your password'))) return

  const { rows: updated } = await query(
    `UPDATE umpires SET password_hash = $2 WHERE id = $1
      RETURNING id, email, name, password_hash, google_email`,
    [found.id, await hashPassword(password)],
  )

  res.json({ token: signToken(updated[0]), umpire: umpirePayload(updated[0]) })
})

/**
 * Connects a Google account to the account already signed in.
 *
 * The same job as /auth/google/link, from the other side of the door:
 * that one is for someone at the gate who has typed their email and
 * password, this one for someone already inside. Both exist because
 * neither can stand in for the other -- an umpire mid-session must not
 * have to sign out, and someone who cannot get in has no token to use.
 */
router.post('/google/connect', requireAuth, requireActiveUmpire(query), async (req, res) => {
  // Google first, before a single row is read, so this can never be
  // used to ask questions about accounts.
  let profile
  try {
    profile = await resolveGoogleProfile(req.body ?? {})
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message })
    }
    throw error
  }

  const found = await loadUmpire(req.umpire.id)
  if (!found) return res.status(401).json({ error: 'Account no longer exists' })

  if (!(await confirmedWithPassword(found, req, res, 'connect a Google account'))) return

  // Already wearing a different one. Replacing it silently would cut
  // off whoever had been signing in with the old one.
  if (found.google_sub && found.google_sub !== profile.sub) {
    return res.status(409).json({
      error: 'This account is already connected to a different Google account.',
    })
  }

  let updated
  try {
    ;({ rows: updated } = await query(
      `UPDATE umpires SET google_sub = $2, google_email = $3 WHERE id = $1
        RETURNING id, email, name, password_hash, google_email`,
      [found.id, profile.sub, profile.email],
    ))
  } catch (error) {
    if (error.constraint === 'umpires_google_sub_idx') {
      return res.status(409).json({
        error: 'That Google account is already connected to another umpire.',
      })
    }
    throw error
  }

  res.json({ token: signToken(updated[0]), umpire: umpirePayload(updated[0]) })
})

/**
 * Disconnects Google.
 *
 * Refused outright when there is no password, and this is stricter than
 * the player rule on purpose. A player who strands themselves can be
 * let back in by an umpire re-minting their claim code -- a recovery
 * path with a trusted human in it. An umpire has nothing of the kind:
 * no code, and no password-reset email anywhere in this system. So a
 * Google-only umpire who disconnected would be locked out for good, and
 * the honest answer is to refuse and say what to do first.
 */
router.post('/google/disconnect', requireAuth, requireActiveUmpire(query), async (req, res) => {
  const found = await loadUmpire(req.umpire.id)
  if (!found) return res.status(401).json({ error: 'Account no longer exists' })

  if (!found.google_sub) {
    return res.status(409).json({ error: 'No Google account is connected.' })
  }

  if (!found.password_hash) {
    return res.status(409).json({
      error:
        'Set a password first — Google is the only way into this account, and there are no reset emails here.',
      needsPassword: true,
    })
  }

  if (!(await confirmedWithPassword(found, req, res, 'disconnect Google'))) return

  const { rows: updated } = await query(
    `UPDATE umpires SET google_sub = NULL, google_email = NULL WHERE id = $1
      RETURNING id, email, name, password_hash, google_email`,
    [found.id],
  )

  res.json({ token: signToken(updated[0]), umpire: umpirePayload(updated[0]) })
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
        `INSERT INTO players (name, username, password_hash, claim_code,
                              claimed_at, registered_at)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (lower(name)) DO NOTHING
         RETURNING id, name, claimed_at, username, google_email`,
        [name, username, password_hash, generateInviteCode()],
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
 * a club roster this human is.
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
        `INSERT INTO players (name, google_sub, google_email, claim_code,
                              claimed_at, registered_at)
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (lower(name)) DO NOTHING
         RETURNING id, name, claimed_at, username, google_email`,
        [name, profile.sub, profile.email, generateInviteCode()],
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
 * credential is Google, and whose claim code has been wiped by a
 * previous deletion, would be unreachable the moment this succeeded --
 * there is no email here and so no reset link, and the honest answer is
 * to say so rather than to strand someone politely.
 *
 * A claim code IS enough to allow it: an umpire re-minting one is this
 * app's whole recovery path, and unlike a reset email it has a trusted
 * human in the loop.
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
