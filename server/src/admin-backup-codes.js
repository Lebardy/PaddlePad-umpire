// ============================================================
// The owner's backup codes. Plain codes exist only in the response that
// makes them; the table holds hashes.
// ============================================================

import { NO_SUCH_ACCOUNT_HASH, hashPassword, verifyPassword } from './auth.js'
import { newBackupCodes, normalizeBackupCode, paddedCodeHashes } from './admin-rules.js'

/** Replaces the admin's codes with a fresh set and returns the plain codes. */
export async function replaceBackupCodes(client, adminId) {
  const codes = newBackupCodes()
  await client.query('DELETE FROM admin_backup_codes WHERE admin_id = $1', [adminId])
  for (const code of codes) {
    await client.query(
      'INSERT INTO admin_backup_codes (admin_id, code_hash) VALUES ($1, $2)',
      [adminId, await hashPassword(normalizeBackupCode(code))],
    )
  }
  return codes
}

export async function countBackupCodesLeft(queryFn, adminId) {
  const { rows } = await queryFn(
    'SELECT count(*)::int AS n FROM admin_backup_codes WHERE admin_id = $1 AND used_at IS NULL',
    [adminId],
  )
  return rows[0].n
}

/**
 * Checks `value` against every hash in `hashes`, in order, stopping at
 * the first match and saying which index matched (-1 for none).
 *
 * Shared by useBackupCode (real, padded hashes) and
 * dummyBackupCodeCheck (all-dummy hashes), so a check that can never
 * match costs exactly the same as one that might: the same fixed
 * number of scrypt comparisons every time, whether the account is
 * real, has codes left, or doesn't exist at all.
 */
async function matchIndex(value, hashes) {
  for (let i = 0; i < hashes.length; i += 1) {
    if (await verifyPassword(value, hashes[i])) return i
  }
  return -1
}

/**
 * Uses one matching unused code, inside the caller's transaction.
 * Returns true if a code matched and was marked used.
 *
 * Always makes exactly BACKUP_CODE_COUNT scrypt comparisons (see
 * paddedCodeHashes), whether the typed code is well-formed and whether
 * ten codes are left or none -- otherwise an owner with codes left
 * would take measurably longer to refuse a wrong code than one with
 * none, and that difference is exactly what an attacker probing emails
 * and codes would be timing for.
 */
export async function useBackupCode(client, adminId, typed) {
  // A badly-formed code still has to cost a full check: falling back to
  // a placeholder rather than returning early keeps that check running.
  const code = normalizeBackupCode(typed) || 'x'
  const { rows } = await client.query(
    'SELECT id, code_hash FROM admin_backup_codes WHERE admin_id = $1 AND used_at IS NULL FOR UPDATE',
    [adminId],
  )
  const hashes = paddedCodeHashes(rows.map((row) => row.code_hash), NO_SUCH_ACCOUNT_HASH)
  const index = await matchIndex(code, hashes)
  if (index === -1 || index >= rows.length) return false
  await client.query('UPDATE admin_backup_codes SET used_at = now() WHERE id = $1', [rows[index].id])
  return true
}

/**
 * Spends exactly the time a real check would, when there is no real
 * account -- or none eligible -- to check a typed code against: no
 * admin matched the email, the admin isn't the owner, or the owner is
 * switched off. Without this, those refusals answer near-instantly
 * next to a real wrong-code check, which is its own timing tell.
 */
export async function dummyBackupCodeCheck() {
  await matchIndex('x', paddedCodeHashes([], NO_SUCH_ACCOUNT_HASH))
}
