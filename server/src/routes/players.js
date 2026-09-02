import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../auth.js'
import { generateInviteCode } from '../invites.js'
import { normalizePlayerName, playerNameError } from '../validate.js'

const router = Router()
router.use(requireAuth)

const SEARCH_LIMIT = 50

// Every player response is built from this shape. `match_count` and
// `last_played_at` exist for one specific reason: when an umpire types
// a name that already exists, the app has to be able to say "Maria
// Santos -- 14 matches, last played Aug 12. Same person?" before
// reusing that record.
//
// Without that, an umpire silently attaches a stranger's match to an
// existing player, and the ML pipeline treats two people as one. That
// is the moment -- the only moment -- when a human can actually tell
// the difference, so the data to make the call has to be right there.
//
// NOTE: claim_code is deliberately absent. It is a bearer secret and
// the roster is the most screenshotted screen in the app.
const PLAYER_SELECT = `
  SELECT p.id,
         p.name,
         p.created_at,
         p.claimed_at IS NOT NULL                            AS claimed,
         count(m.id) FILTER (WHERE m.status = 'completed')::int AS match_count,
         max(m.ended_at)                                     AS last_played_at,
         u.name                                              AS created_by_name
    FROM players p
    LEFT JOIN matches m
      ON (p.id = ANY (m.team_a) OR p.id = ANY (m.team_b))
    LEFT JOIN umpires u ON u.id = p.created_by
`

/**
 * Search players by name fragment, or list all when `q` is empty.
 *
 * An exact (case-insensitive) name match is ordered first so the
 * confirm-this-person case is always the top result rather than
 * buried behind whoever happens to have played most.
 */
router.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim()

  const { rows } = await query(
    `${PLAYER_SELECT}
      WHERE $1 = '' OR p.name ILIKE '%' || $1 || '%'
      GROUP BY p.id, u.name
      ORDER BY (lower(p.name) = lower($1)) DESC, match_count DESC, p.name
      LIMIT $2`,
    [q, SEARCH_LIMIT],
  )

  res.json({ players: rows })
})

router.get('/:id', async (req, res) => {
  const { rows } = await query(
    `${PLAYER_SELECT} WHERE p.id = $1 GROUP BY p.id, u.name`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'No such player' })
  res.json({ player: rows[0] })
})

/**
 * Creates a player.
 *
 * Player ids are minted HERE rather than by the device, unlike sessions
 * and matches. Players are the one entity with a semantic unique key
 * (`players_name_lower_idx`), so if two offline devices each invented an
 * id for "Maria" only one could survive, and reconciling would mean
 * rewriting that id across sessions, matches, both team arrays and
 * every event payload on both devices. That rewrite is the single
 * largest correctness risk in the sync design, and it would reintroduce
 * exactly the fragmentation the shared players table exists to prevent.
 *
 * Adding a new human is a setup action, not a mid-rally one, so it is
 * allowed to require connectivity. Scoring stays fully offline.
 *
 * On a duplicate name this returns 409 WITH the existing player
 * attached, so the app can offer "use the existing Maria" without a
 * second round trip.
 */
router.post('/', async (req, res) => {
  const name = normalizePlayerName(req.body?.name)

  // The same rule the player's own rename uses, so an umpire and a
  // player cannot disagree about what a valid name is.
  const nameError = playerNameError(name)
  if (nameError) return res.status(400).json({ error: nameError })

  const inserted = await query(
    `INSERT INTO players (name, created_by, claim_code)
     VALUES ($1, $2, $3)
     ON CONFLICT (lower(name)) DO NOTHING
     RETURNING id`,
    [name, req.umpire.id, generateInviteCode()],
  )

  if (inserted.rowCount === 0) {
    const { rows } = await query(
      `${PLAYER_SELECT} WHERE lower(p.name) = lower($1) GROUP BY p.id, u.name`,
      [name],
    )
    return res.status(409).json({
      error: `A player called ${rows[0]?.name ?? name} already exists`,
      player: rows[0] ?? null,
    })
  }

  const { rows } = await query(
    `${PLAYER_SELECT} WHERE p.id = $1 GROUP BY p.id, u.name`,
    [inserted.rows[0].id],
  )
  res.status(201).json({ player: rows[0] })
})

/**
 * Returns a player's claim code -- the only endpoint that exposes it.
 *
 * Codes are minted lazily rather than backfilled, so rows created
 * before the column existed get one on first read instead of needing a
 * migration. Nothing consumes this yet; it is groundwork for letting a
 * player claim their own record (by QR or by typing it) and inherit the
 * history an umpire already logged for them.
 */
router.get('/:id/claim-code', async (req, res) => {
  const { rows } = await query(
    `UPDATE players
        SET claim_code = COALESCE(claim_code, $2)
      WHERE id = $1
      RETURNING claim_code`,
    [req.params.id, generateInviteCode()],
  )
  if (!rows[0]) return res.status(404).json({ error: 'No such player' })
  res.json({ claimCode: rows[0].claim_code })
})

export default router
