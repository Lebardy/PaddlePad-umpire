// ============================================================
// The owner's backup codes. Plain codes exist only in the response that
// makes them; the table holds hashes.
// ============================================================

import { hashPassword, verifyPassword } from './auth.js'
import { newBackupCodes, normalizeBackupCode } from './admin-rules.js'

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
 * Uses one matching unused code, inside the caller's transaction.
 * Returns true if a code matched and was marked used.
 */
export async function useBackupCode(client, adminId, typed) {
  const code = normalizeBackupCode(typed)
  if (!code) return false
  const { rows } = await client.query(
    'SELECT id, code_hash FROM admin_backup_codes WHERE admin_id = $1 AND used_at IS NULL FOR UPDATE',
    [adminId],
  )
  for (const row of rows) {
    if (await verifyPassword(code, row.code_hash)) {
      await client.query('UPDATE admin_backup_codes SET used_at = now() WHERE id = $1', [row.id])
      return true
    }
  }
  return false
}
