import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import { requireActivePlayer, requirePlayer, verifyPassword } from '../auth.js'
import {
  countMatchesInProgress,
  getPlayerMatches,
  getRatingState,
  summarisePlayer,
} from '../player-stats.js'
import { normalizePlayerName, playerNameError } from '../validate.js'

const router = Router()

// Every route here is scoped to the token's own player. A player can
// read their own history and nothing else -- there is deliberately no
// way to look up another player, browse the club, or reach anything an
// umpire can do.
//
// requireActivePlayer runs on all of them because a player token lasts
// 30 days: a closed account has to stop working the moment it is
// closed, not whenever the token happens to expire.
router.use(requirePlayer, requireActivePlayer(query))

/** The player half of a /player/me response, from a row. */
function profileOf(row) {
  return {
    id: row.id,
    name: row.name,
    claimedAt: row.claimed_at,
    // Null for a player who came in by claim code and has not set up
    // sign-in yet -- the profile screen reads this to offer it.
    username: row.username,
  }
}

router.get('/me', async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, claimed_at, username FROM players WHERE id = $1',
    [req.player.id],
  )
  if (!rows[0]) return res.status(401).json({ error: 'That player no longer exists' })

  const [matches, inProgress] = await Promise.all([
    getPlayerMatches(query, req.player.id),
    countMatchesInProgress(query, req.player.id),
  ])

  // Needs the match count, so it runs after the pair above rather than
  // alongside them. One extra query on the profile load, and only when
  // the player has no rating yet does it cost a second.
  const rating = await getRatingState(query, req.player.id, matches.length)

  res.json({
    player: profileOf(rows[0]),
    summary: summarisePlayer(matches),
    // Lets the empty state say "being scored right now" rather than the
    // flatly discouraging "no matches".
    inProgress,
    // Either a score with the pool it was measured against, or the
    // reason there isn't one yet. Never a bare null.
    rating,
  })
})

/**
 * Renames the player.
 *
 * This is allowed, and the comment it replaces said it was not, so it
 * is worth saying why the reversal is safe. The identity guard this
 * app is built around (schema.sql) is about one human ending up with
 * TWO player rows: matches point at players.id, so renaming a single
 * row moves no data and splits no history. What renaming genuinely
 * costs is that the umpire's roster label changes under them, which is
 * a usability cost -- the form warns about it in plain words -- not a
 * data-integrity one.
 *
 * No password required. A display name is a label, not a credential,
 * and demanding a password to fix a typo is friction with nothing
 * behind it.
 *
 * The token is deliberately NOT re-issued. signPlayerToken carries
 * `name` in the payload, but every response re-reads the name from the
 * database, so the copy in the token is display-only and never
 * authoritative.
 */
router.patch('/me', async (req, res) => {
  const name = normalizePlayerName(req.body?.name)
  const error = playerNameError(name)
  if (error) return res.status(400).json({ error })

  let rows
  try {
    // Catching the constraint rather than checking first, for the same
    // concurrency reason POST /players documents: two people claiming
    // the same free name at the same moment would both pass a check.
    //
    // Changing only the letter case of your own name is fine here --
    // the row keeps its own entry in players_name_lower_idx.
    ;({ rows } = await query(
      `UPDATE players SET name = $2
        WHERE id = $1
        RETURNING id, name, claimed_at, username`,
      [req.player.id, name],
    ))
  } catch (err) {
    if (err.constraint === 'players_name_lower_idx') {
      return res.status(409).json({
        error: 'Someone on the roster already has that name',
        nameTaken: true,
      })
    }
    throw err
  }

  if (!rows[0]) return res.status(401).json({ error: 'That player no longer exists' })
  res.json({ player: profileOf(rows[0]) })
})

/**
 * Deletes the player's profile -- as far as it can honestly go.
 *
 * Two outcomes, and which one happens is not a preference:
 *
 *   - Never appeared in a match: nothing points at the row, so it is
 *     really deleted. session_players and player_ratings cascade.
 *   - Has appeared in a match: the ACCOUNT is destroyed (username,
 *     password, claim code and claimed status all wiped) but the row
 *     stays, because the match record is not solely this player's. Their
 *     name is in their partners' and opponents' history, and team_a /
 *     team_b hold bare UUIDs with no foreign key to repair.
 *
 * The response says which happened, so the app reports the truth rather
 * than its own guess.
 */
router.delete('/me', async (req, res) => {
  const password = String(req.body?.password ?? '')

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT password_hash FROM players WHERE id = $1',
      [req.player.id],
    )
    if (!rows[0]) return { status: 401, body: { error: 'That player no longer exists' } }

    // Someone holding an unlocked phone must not be able to delete the
    // account off the profile screen. Where there is no password there
    // is no proof to ask for -- the token is it, and the app makes them
    // type their own name instead.
    const hash = rows[0].password_hash
    if (hash && !(await verifyPassword(password, hash))) {
      return {
        status: 403,
        body: { error: 'Enter your password to delete your profile', needsPassword: true },
      }
    }

    // Deliberately unfiltered, unlike getPlayerMatches. This is not
    // "what counts towards your record", it is "is anything pointing at
    // this row" -- and an in-progress or voided match points at it just
    // as hard as a completed one.
    const { rows: counted } = await client.query(
      `SELECT count(*)::int AS matches
         FROM matches
        WHERE team_a @> ARRAY[$1]::uuid[] OR team_b @> ARRAY[$1]::uuid[]`,
      [req.player.id],
    )
    const matches = counted[0].matches

    if (matches === 0) {
      // A match created between the count above and this delete would
      // leave a dangling id in a team array. The window is one
      // transaction wide and needs an umpire adding this exact player
      // to a match in that instant; locking the matches table to close
      // it would cost every scoring device more than the risk is worth.
      await client.query('DELETE FROM players WHERE id = $1', [req.player.id])
      return { status: 200, body: { deleted: true, matches: 0 } }
    }

    await client.query(
      `UPDATE players
          SET username       = NULL,
              password_hash  = NULL,
              claim_code     = NULL,
              claimed_at     = NULL,
              registered_at  = NULL,
              deactivated_at = now()
        WHERE id = $1`,
      [req.player.id],
    )
    return { status: 200, body: { deleted: false, matches } }
  })

  res.status(result.status).json(result.body)
})

router.get('/matches', async (req, res) => {
  res.json({ matches: await getPlayerMatches(query, req.player.id) })
})

export default router
