import { Router } from 'express'
import { query, withTransaction } from '../db.js'
import {
  requireActivePlayer,
  requirePlayer,
  signPlayerToken,
  verifyPassword,
} from '../auth.js'
import {
  countMatchesInProgress,
  getPlayerMatches,
  getRatingState,
  summarisePlayer,
} from '../player-stats.js'
import { normalizeInviteCode } from '../invites.js'
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

/**
 * Links a claim code to the account the caller already has.
 *
 * The gap this fills: the two ways into this app only ever met BEFORE
 * you had one. /auth/player/claim and the needsCode branch of
 * /auth/player/register both run with no token. So a player who signed
 * up first, and was later handed a code for the record an umpire had
 * been building under a different spelling of their name, had nowhere
 * to enter it. Signing out and claiming made it worse rather than
 * better: that issues a token for the OTHER row and strands the
 * username and password on the one they left behind, where the unique
 * index then stops them ever reusing either.
 *
 * So the two rows become one. Which survives is not arbitrary -- the
 * umpire's does. It is the row every partner's and opponent's history
 * already names, the row the umpire keeps typing on the roster, and the
 * row far more likely to carry rating snapshots. The caller's ACCOUNT
 * moves onto it and their own row is deleted.
 *
 * The visible cost is that the caller's display name becomes the
 * umpire's spelling. The app states that before confirming and offers
 * the rename above straight afterwards, so it is a choice rather than a
 * surprise.
 */
router.post('/link', async (req, res) => {
  const code = normalizeInviteCode(req.body?.code)
  if (!code) return res.status(400).json({ error: 'Enter your code to continue' })

  const result = await withTransaction(async (client) => {
    // Locked because this rewrites match history: two links racing on
    // the same pair would interleave into a half-merge that no single
    // statement could undo.
    const { rows: sources } = await client.query(
      'SELECT id, name, password_hash FROM players WHERE claim_code = $1 FOR UPDATE',
      [code],
    )
    const source = sources[0]
    if (!source) {
      return { status: 404, body: { error: "That code doesn't match any player" } }
    }

    // Someone pasting their own code has simply done nothing. That is
    // not a mistake worth an error screen.
    if (source.id === req.player.id) {
      return { status: 200, body: { alreadyYours: true } }
    }

    // A claim code deliberately keeps working after its owner sets a
    // password, because an umpire re-minting it is the whole
    // forgotten-password path (see schema.sql). Holding one is
    // therefore NOT permission to absorb a real account.
    if (source.password_hash) {
      return {
        status: 409,
        body: {
          error:
            `${source.name} already has an account. ` +
            "If that's you, sign in as them instead.",
        },
      }
    }

    const { rows: targets } = await client.query(
      `SELECT id, name, username, password_hash, registered_at
         FROM players WHERE id = $1 FOR UPDATE`,
      [req.player.id],
    )
    const target = targets[0]
    if (!target) return { status: 401, body: { error: 'That player no longer exists' } }

    // If the two ids ever shared a match they partnered or played each
    // other, which makes them two people rather than one. Merging
    // anyway would put a single id in two slots of one team, where
    // deriveMatchState's indexOf (pickleball.js) would silently
    // mis-attribute every rally from that point on. No rewrite is safe,
    // so this one is refused.
    const { rows: shared } = await client.query(
      `SELECT count(*)::int AS n FROM matches
        WHERE (team_a @> ARRAY[$1]::uuid[] OR team_b @> ARRAY[$1]::uuid[])
          AND (team_a @> ARRAY[$2]::uuid[] OR team_b @> ARRAY[$2]::uuid[])`,
      [target.id, source.id],
    )
    if (shared[0].n > 0) {
      return {
        status: 409,
        body: {
          error:
            `You and ${source.name} have played in the same match, so you ` +
            "can't be the same person. Ask whoever scores your matches to check.",
          sharedMatches: shared[0].n,
        },
      }
    }

    // Counted before anything moves, because the confirm screen has to
    // be able to state what will happen using real numbers rather than
    // its own guess. Disjoint by the check above, so they simply add.
    const countMatches = async (id) => {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM matches
          WHERE team_a @> ARRAY[$1]::uuid[] OR team_b @> ARRAY[$1]::uuid[]`,
        [id],
      )
      return rows[0].n
    }
    const theirs = await countMatches(source.id)
    const yours = await countMatches(target.id)

    // A dry run. Every refusal above has already been evaluated, so a
    // preview that comes back clean is a merge that will go through --
    // which is the point of offering one at all.
    if (req.body?.confirm !== true) {
      return {
        status: 200,
        body: {
          preview: true,
          name: source.name,
          previousName: target.name,
          theirs,
          yours,
          matches: theirs + yours,
        },
      }
    }

    // --- Everything that can hold a player id, in order. ---

    await client.query(
      `UPDATE matches
          SET team_a = array_replace(team_a, $1, $2),
              team_b = array_replace(team_b, $1, $2)
        WHERE team_a @> ARRAY[$1]::uuid[] OR team_b @> ARRAY[$1]::uuid[]`,
      [target.id, source.id],
    )

    // The foreign key with no ON DELETE, which would otherwise refuse
    // the delete below outright.
    await client.query(
      'UPDATE matches SET first_server_player = $2 WHERE first_server_player = $1',
      [target.id, source.id],
    )

    // The tap log. This is the ONE place in the app that rewrites
    // recorded events, and it should stay the only one -- but skipping
    // it is not an option: every per-player stat is derived by replaying
    // these payloads, so leaving them pointing at a deleted id would
    // quietly zero the merged player's winners, errors and drop rate
    // while the match list still looked right.
    //
    // `payload || jsonb_build_object(...)` overwrites the key and needs
    // no branching per event type. Neither key is indexed, so both
    // statements scan match_events -- accepted, because a merge is rare
    // and deliberate and nothing on the scoring path waits on it.
    await client.query(
      `UPDATE match_events
          SET payload = payload || jsonb_build_object('actingPlayerId', $2::text)
        WHERE payload->>'actingPlayerId' = $1::text`,
      [target.id, source.id],
    )
    await client.query(
      `UPDATE match_events
          SET payload = payload || jsonb_build_object('playerId', $2::text)
        WHERE payload->>'playerId' = $1::text`,
      [target.id, source.id],
    )

    await client.query(
      `INSERT INTO session_players (session_id, player_id)
       SELECT session_id, $2 FROM session_players WHERE player_id = $1
       ON CONFLICT DO NOTHING`,
      [target.id, source.id],
    )

    // Re-counted after the rewrite rather than trusting theirs + yours:
    // this is the number the app tells the player they now have, and it
    // should come from the rows as they actually stand.
    const total = await countMatches(source.id)

    // Order matters. The account row still holds the username, and
    // players_username_lower_idx would reject the UPDATE below while it
    // does. Deleting also drops that row's player_ratings by cascade,
    // which is correct rather than lossy: those snapshots were computed
    // against a pool and an id that no longer exist, and the next
    // pipeline run recomputes. Where both ids scored in the same run the
    // survivor's row is the one kept, and it was drawn from more matches.
    await client.query('DELETE FROM players WHERE id = $1', [target.id])

    const { rows: merged } = await client.query(
      `UPDATE players
          SET username       = $2,
              password_hash  = $3,
              registered_at  = COALESCE(registered_at, $4),
              claimed_at     = COALESCE(claimed_at, now()),
              deactivated_at = NULL
        WHERE id = $1
        RETURNING id, name, claimed_at, username`,
      [source.id, target.username, target.password_hash, target.registered_at],
    )

    return {
      status: 200,
      body: {
        // The caller's player id has changed, so their old token now
        // names a row that is gone -- requireActivePlayer will refuse it
        // on the next request. This is the replacement.
        token: signPlayerToken(merged[0]),
        player: profileOf(merged[0]),
        matches: total,
        // Said out loud by the app rather than left to be discovered.
        previousName: target.name,
      },
    }
  })

  res.status(result.status).json(result.body)
})

router.get('/matches', async (req, res) => {
  res.json({ matches: await getPlayerMatches(query, req.player.id) })
})

export default router
