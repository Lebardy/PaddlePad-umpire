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
  getClubStanding,
  getPlayerMatches,
  getRatingState,
  scoreProgression,
  summarisePlayer,
} from '../player-stats.js'
import { normalizeInviteCode } from '../invites.js'
import { getMatchOfTheMonthStory, getMonthlyBoard } from '../board.js'
import { isUuid, normalizePlayerName, playerNameError } from '../validate.js'
import { readGame } from '../drama.js'

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
    // Null unless a Google account is connected. Display only: the
    // settings screen says which account it is so someone can tell
    // whether it is still theirs. Never matched on -- see schema.sql.
    googleEmail: row.google_email,
  }
}

router.get('/me', async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, claimed_at, username, google_email, name_visible
       FROM players WHERE id = $1`,
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
    // Beside the profile rather than inside it. profileOf feeds half a
    // dozen responses built from different RETURNING lists, and a field
    // one of them forgot to select would come back undefined and wipe
    // the setting on screen -- which is exactly what happened to
    // googleEmail after a rename. This has one reader and one writer.
    nameVisible: rows[0].name_visible,
  })
})

/**
 * Where this player sits in the club, and who else is in their group.
 *
 * Its own route rather than part of /me, which is this app's hot path:
 * the overview loads on every launch and should not pay for two extra
 * aggregate queries that only matter once someone taps through to ask.
 *
 * Nothing here identifies anybody. It is counts and a shape -- see
 * getClubStanding for why a ranked list would be a worse answer than
 * this one even setting competitiveness aside.
 */
router.get('/standing', async (req, res) => {
  res.json({ standing: await getClubStanding(query, req.player.id) })
})

/**
 * This month on PaddlePad -- the board at the top of People.
 *
 * Every signed-in player sees the same board; nothing on it depends on
 * who is asking. What it is made of, and the two rows deliberately left
 * out, are explained at the top of board.js.
 */
router.get('/board', async (req, res) => {
  res.json({ board: await getMonthlyBoard(query) })
})

/**
 * How this month's match of the month went -- that match and no other.
 *
 * A 404 for any other id, including last month's winner once the month
 * turns: see getMatchOfTheMonthStory for why this must never become a
 * way to read arbitrary matches.
 */
router.get('/board/match/:id', async (req, res) => {
  const story = await getMatchOfTheMonthStory(query, req.params.id)
  if (!story) return res.status(404).json({ error: 'That is not this month\'s match of the month' })
  res.json({ match: story })
})

/**
 * Shows or hides this player's name on the monthly board.
 *
 * A display setting only: turning it off leaves their matches, their
 * rating and their share of the ML export exactly as they were. So it
 * asks for no password -- it cannot lock anyone out or move any data,
 * and a privacy switch that is hard to reach is one people do not use.
 */
router.put('/me/visibility', async (req, res) => {
  if (typeof req.body?.nameVisible !== 'boolean') {
    return res.status(400).json({ error: 'nameVisible must be true or false' })
  }
  const { rows } = await query(
    'UPDATE players SET name_visible = $2 WHERE id = $1 RETURNING name_visible',
    [req.player.id, req.body.nameVisible],
  )
  if (!rows[0]) return res.status(401).json({ error: 'That player no longer exists' })
  res.json({ nameVisible: rows[0].name_visible })
})

/**
 * How one of this player's own matches went, point by point.
 *
 * Its own call rather than part of /player/matches: a reading like this
 * for every match in a long history would be tens of kilobytes on every
 * launch, and only the match actually opened needs one.
 *
 * Told from THIS player's side -- their points are the ones filled in on
 * the ribbon -- so "winners" in the reading means their team here,
 * whether they won or lost. Only matches they played in: the guard is
 * the same one getPlayerMatches uses, so this can never become a way to
 * read somebody else's game.
 */
router.get('/matches/:id/game', async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'No such match' })

  const { rows } = await query(
    `SELECT m.id, m.team_a, m.team_b, m.first_server_team, m.first_server_player,
            m.right_start_a, m.right_start_b, m.point_target
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
      WHERE m.id = $1
        AND m.status = 'completed'
        AND m.ended_at IS NOT NULL
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL
        AND (m.team_a @> ARRAY[$2]::uuid[] OR m.team_b @> ARRAY[$2]::uuid[])`,
    [req.params.id, req.player.id],
  )
  const row = rows[0]
  if (!row) return res.status(404).json({ error: 'No such match' })

  const { rows: events } = await query(
    `SELECT type, payload FROM match_events WHERE match_id = $1 ORDER BY seq`,
    [row.id],
  )
  const log = events.map((e) => ({ type: e.type, ...e.payload }))
  const team = row.team_a.includes(req.player.id) ? 'A' : 'B'
  const margins = scoreProgression(row, log, team)

  res.json({ margins, game: readGame(margins, row.point_target) })
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
        RETURNING id, name, claimed_at, username, google_email`,
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

    // google_sub goes with the rest of it. Leaving it behind would
    // make "delete my profile" mean "delete every way in except the
    // one-tap one", and the closed account would sign straight back in.
    await client.query(
      `UPDATE players
          SET username       = NULL,
              password_hash  = NULL,
              google_sub     = NULL,
              google_email   = NULL,
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
      `SELECT id, name, password_hash, google_sub
         FROM players WHERE claim_code = $1 FOR UPDATE`,
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
    //
    // google_sub counts as a real account for exactly the same reason a
    // password does: somebody signs in as this player. Checking only
    // the password would have left a Google-only account absorbable by
    // anyone holding its code.
    if (source.password_hash || source.google_sub) {
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
      `SELECT id, name, username, password_hash, google_sub, google_email,
              registered_at
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
              google_sub     = $5,
              google_email   = $6,
              registered_at  = COALESCE(registered_at, $4),
              claimed_at     = COALESCE(claimed_at, now()),
              deactivated_at = NULL
        WHERE id = $1
        RETURNING id, name, claimed_at, username, google_email`,
      // Google moves across with the username and password because the
      // row being deleted is the one holding it. The guard above
      // guarantees the surviving row has none of its own, so nothing is
      // overwritten. Left behind, it would vanish with the DELETE and
      // the player's one-tap sign-in would simply stop working.
      [
        source.id,
        target.username,
        target.password_hash,
        target.registered_at,
        target.google_sub,
        target.google_email,
      ],
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
