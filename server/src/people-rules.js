// ============================================================
// Rules for the admin site's People pages that need no database:
// what state a person is in, what pausing and closing require, and
// what a person looks like to the site. Checked offline by
// scripts/check-people-rules.mjs.
// ============================================================

import { isUuid } from './validate.js'

export const PAUSED_MESSAGE = 'Your account is paused. Contact PaddlePad.'
export const CLOSED_MESSAGE = 'That account has been closed'
export const PAUSE_REASON_MAX = 300
export const PEOPLE_PAGE_SIZE = 50
export const PEOPLE_STATUSES = ['all', 'active', 'paused', 'closed']

/** Closed wins over paused: closing clears a pause, but never trust that alone. */
export function personStatus({ pausedAt, closedAt }) {
  if (closedAt) return 'closed'
  if (pausedAt) return 'paused'
  return 'active'
}

export function readPauseReason(value) {
  const reason = String(value ?? '').trim()
  if (!reason || reason.length > PAUSE_REASON_MAX) {
    return { error: `Write a short reason (up to ${PAUSE_REASON_MAX} characters)` }
  }
  return { reason }
}

export function confirmNameMatches(typed, name) {
  const clean = String(typed ?? '').trim().toLowerCase()
  return clean !== '' && clean === String(name ?? '').trim().toLowerCase()
}

/**
 * Closing an umpire frees their address so the same person can sign up
 * again with a new invite code. `.invalid` is reserved and can never
 * receive mail or be typed by accident into a real sign-up.
 */
export function closedUmpireEmail(id) {
  return `closed+${id}@paddlepad.invalid`
}

/** Closing cannot be undone, so it is the owner's alone. */
export function mayClose(admin) {
  return admin?.role === 'owner'
}

/**
 * Who may mint a new claim code for a player.
 *
 * Closing is the one action kept for the owner because it is meant to be
 * final, so reopening an OWNER-closed account needs the owner too --
 * everyone else, including the umpire route with no admin at all, is
 * refused while `closed_by_admin_at` is set. A player who closed their
 * own account (deactivated_at set, closed_by_admin_at not) keeps
 * today's recovery through any admin or an umpire.
 */
export function mayMintClaimCode(row, { isOwner = false } = {}) {
  if (row?.closed_by_admin_at) return isOwner
  return true
}

function refusalFor(row, closedColumn, statusCode) {
  if (!row || row[closedColumn]) return { statusCode, body: { error: CLOSED_MESSAGE, status: 'closed' } }
  if (row.paused_at) return { statusCode, body: { error: PAUSED_MESSAGE, status: 'paused' } }
  return null
}

/** For a signed-in request: 401, so the apps end the session. A missing row counts as closed. */
export function sessionRefusal(row, closedColumn) {
  return refusalFor(row, closedColumn, 401)
}

/** For a sign-in door that has found the person: 403, and no token. */
export function signInRefusal(row, closedColumn) {
  if (!row) return null
  return refusalFor(row, closedColumn, 403)
}

export function readStatusFilter(value) {
  return PEOPLE_STATUSES.includes(value) ? value : 'all'
}

/** A case-insensitive "contains" pattern for ILIKE, with the user's own % _ \ matched literally. */
export function likePattern(q) {
  const clean = String(q ?? '').trim().toLowerCase()
  if (!clean) return null
  return `%${clean.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Lists are newest first; the cursor is the last row shown, so ties on created_at still page cleanly. */
export function makeCursor(row) {
  return `${new Date(row.created_at).toISOString()}|${row.id}`
}

export function readCursor(value) {
  const [createdAt, id] = String(value ?? '').split('|')
  if (!createdAt || !id || !isUuid(id) || Number.isNaN(Date.parse(createdAt))) return null
  return { createdAt: new Date(createdAt).toISOString(), id }
}

export function playerListItem(row) {
  const signInMethods = []
  if (row.password_hash) signInMethods.push('password')
  if (row.google_sub) signInMethods.push('google')
  if (row.claim_code) signInMethods.push('claim code')
  return {
    id: row.id,
    name: row.name,
    username: row.username ?? null,
    signInMethods,
    claimed: Boolean(row.claimed_at),
    hiddenFromBoard: row.name_visible === false,
    joinedAt: row.created_at,
    lastSignedInAt: row.last_signed_in_at ?? null,
    status: personStatus({ pausedAt: row.paused_at, closedAt: row.deactivated_at }),
  }
}

export function umpireListItem(row) {
  const signInMethods = []
  if (row.password_hash) signInMethods.push('password')
  if (row.google_sub) signInMethods.push('google')
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    signInMethods,
    joinedAt: row.created_at,
    lastSignedInAt: row.last_signed_in_at ?? null,
    status: personStatus({ pausedAt: row.paused_at, closedAt: row.closed_at }),
  }
}
