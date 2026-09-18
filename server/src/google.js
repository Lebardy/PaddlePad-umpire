// ============================================================
// Verifying a Google sign-in.
//
// The browser gets a signed statement from Google saying who just
// signed in. This checks that signature and hands back who it names.
// It does not talk to Google on every sign-in -- only to fetch the
// public keys, which are cached for as long as Google's own
// cache-control header says.
//
// No dependency for this. Node accepts a JWK directly
// (crypto.createPublicKey with format 'jwk'), and jsonwebtoken -- which
// is already here for the app's own tokens -- verifies with the key
// object that produces. An SDK would earn its place if this did OAuth
// redirects and refresh tokens; it does neither.
// ============================================================

import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'

// Google signs with one of a small set of keys and rotates them. Which
// key signed a given token is named in its header (`kid`).
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com']

let cache = { keys: new Map(), expiresAt: 0 }
// Guards against a stampede of re-fetches when an unknown kid shows up.
let refetchingAt = 0

/** An error the route can turn into a status code. */
function refusal(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

// The message a network-level failure to reach Google is turned into --
// fetch throws a plain TypeError with no statusCode for a DNS failure, a
// refused connection or similar, and that would otherwise fall through
// as a generic 500 instead of the 503 an unreachable Google deserves.
const GOOGLE_UNREACHABLE = 'Google sign-in is unavailable right now. Try again in a moment.'

async function fetchKeys() {
  let res
  try {
    res = await fetch(CERTS_URL)
  } catch {
    throw refusal(503, GOOGLE_UNREACHABLE)
  }
  if (!res.ok) throw refusal(503, 'Could not reach Google to verify that sign-in')

  const { keys } = await res.json()
  const parsed = new Map()
  for (const jwk of keys) {
    // Throwing here would poison the whole set over one bad key, and
    // Google occasionally publishes formats we do not care about.
    try {
      parsed.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }))
    } catch {
      // Skip it; the kid we actually need is probably fine.
    }
  }

  // Google says how long these are good for. Reading it beats inventing
  // a number that is either needlessly chatty or dangerously stale.
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')
  const ttl = maxAge ? Number(maxAge[1]) * 1000 : 60 * 60 * 1000

  cache = { keys: parsed, expiresAt: Date.now() + ttl }
  return parsed
}

async function keyFor(kid) {
  if (cache.expiresAt < Date.now()) await fetchKeys()
  if (cache.keys.has(kid)) return cache.keys.get(kid)

  // An unknown kid usually means Google rotated early. Re-fetch once,
  // but not more than every 60 seconds -- otherwise a stream of junk
  // tokens with invented kids becomes a way to make this server hammer
  // Google on demand.
  if (Date.now() - refetchingAt > 60_000) {
    refetchingAt = Date.now()
    await fetchKeys()
  }
  return cache.keys.get(kid) ?? null
}

/**
 * Checks a Google credential and returns who it names.
 *
 * SECURITY: `audience` is the whole security of this, and it looks like
 * optional strictness. A Google ID token is a signed statement from
 * Google, and tokens minted for EVERY OTHER application on the internet
 * are signed just as validly by the same keys. Without pinning the
 * audience to our own client id, anyone could present a token from any
 * Google-connected app and be signed in here as whoever that token
 * names. Do not relax this to get a test passing.
 *
 * Refusing outright when GOOGLE_CLIENT_ID is unset is deliberate for
 * the same reason: an unset audience would mean no audience check.
 *
 * @returns {Promise<{sub: string, email: string, name: string}>}
 */
export async function verifyGoogleToken(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw refusal(503, 'Google sign-in is not configured on this server')
  if (!credential) throw refusal(400, 'Missing Google credential')

  const decoded = jwt.decode(credential, { complete: true })
  const kid = decoded?.header?.kid
  if (!kid) throw refusal(401, 'That Google sign-in could not be verified')

  const key = await keyFor(kid)
  if (!key) throw refusal(401, 'That Google sign-in could not be verified')

  let payload
  try {
    payload = jwt.verify(credential, key, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: ISSUERS,
    })
  } catch {
    // One message for a bad signature, a wrong audience and an expired
    // token alike. Which one it was is not the caller's business.
    throw refusal(401, 'That Google sign-in could not be verified')
  }

  // An unverified address must never be trusted, because the route
  // below uses the email to link a Google account to an existing
  // umpire. Without this check, anyone could claim any address.
  if (payload.email_verified !== true || !payload.email) {
    throw refusal(401, 'That Google account has no verified email address')
  }

  return {
    sub: payload.sub,
    email: String(payload.email).toLowerCase(),
    name: payload.name || payload.email,
  }
}

/**
 * Checks a Google ACCESS token and returns who it names.
 *
 * The custom sign-in button hands back an access token rather than the
 * signed ID token Google's own button produces, so this is the other
 * half. An access token carries no signature we can check ourselves --
 * it is an opaque string -- so the only way to learn anything about it
 * is to ask Google, which is why this costs a round trip where
 * verifyGoogleToken costs none.
 *
 * SECURITY: `aud` is the whole security of this, exactly as the
 * audience check is for an ID token. An access token minted for any
 * other application is just as real; without confirming it was issued
 * to OUR client id, anyone could present a token from any Google app
 * and be signed in here as whoever it names.
 *
 * @returns {Promise<{sub: string, email: string, name: string}>}
 */
export async function verifyGoogleAccessToken(accessToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw refusal(503, 'Google sign-in is not configured on this server')
  if (!accessToken) throw refusal(400, 'Missing Google credential')

  let res
  try {
    res = await fetch(`${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`)
  } catch {
    throw refusal(503, GOOGLE_UNREACHABLE)
  }
  if (!res.ok) throw refusal(401, 'That Google sign-in could not be verified')

  const info = await res.json()
  if (info.aud !== clientId) {
    throw refusal(401, 'That Google sign-in could not be verified')
  }
  // tokeninfo answers with strings, not JSON booleans, so `=== true`
  // alone would silently reject every verified address.
  const verified = info.email_verified === true || info.email_verified === 'true'
  if (!verified || !info.email) {
    throw refusal(401, 'That Google account has no verified email address')
  }

  // The display name is not in tokeninfo, and it is the only reason to
  // make a second call -- so a failure here falls back to the address
  // rather than failing the sign-in over a nicety.
  let name = info.email
  try {
    const who = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (who.ok) {
      const profile = await who.json()
      if (profile.name) name = profile.name
    }
  } catch {
    // Keep the email as the name.
  }

  return { sub: info.sub, email: String(info.email).toLowerCase(), name }
}

/**
 * Whichever kind of token the app sent.
 *
 * Both doors end in the same three facts, so nothing downstream has to
 * know which button someone pressed.
 */
export async function resolveGoogleProfile({ credential, accessToken }) {
  if (accessToken) return verifyGoogleAccessToken(accessToken)
  return verifyGoogleToken(credential)
}

/** Whether the server can do Google sign-in at all. */
export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID)
}
