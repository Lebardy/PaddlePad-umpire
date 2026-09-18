// ============================================================
// Account changes shared by the player's own routes and the admin site.
// ============================================================

/**
 * Wipes every way into a player's account and marks it closed, keeping
 * the row because matches point at it (see the players.deactivated_at
 * comment in schema.sql). Also clears any pause: closed wins.
 *
 * google_sub goes with the rest. Leaving it behind would make "closed"
 * mean "closed except the one-tap way in".
 */
export async function wipePlayerCredentials(client, playerId) {
  await client.query(
    `UPDATE players
        SET username       = NULL,
            password_hash  = NULL,
            google_sub     = NULL,
            google_email   = NULL,
            claim_code     = NULL,
            claimed_at     = NULL,
            registered_at  = NULL,
            paused_at      = NULL,
            paused_reason  = NULL,
            deactivated_at = now()
      WHERE id = $1`,
    [playerId],
  )
}

/** Records a successful sign-in. `table` is 'umpires' or 'players', never user input. */
export async function noteSignIn(queryFn, table, id) {
  if (table !== 'umpires' && table !== 'players') throw new Error(`noteSignIn: unknown table ${table}`)
  await queryFn(`UPDATE ${table} SET last_signed_in_at = now() WHERE id = $1`, [id])
}
