import { Router } from 'express'
import { query } from '../db.js'
import { requirePlayer } from '../auth.js'
import {
  countMatchesInProgress,
  getPlayerMatches,
  summarisePlayer,
} from '../player-stats.js'

const router = Router()

// Every route here is scoped to the token's own player. A player can
// read their own history and nothing else -- there is deliberately no
// way to look up another player, browse the club, or reach anything an
// umpire can do.
router.use(requirePlayer)

router.get('/me', async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, claimed_at FROM players WHERE id = $1',
    [req.player.id],
  )
  if (!rows[0]) return res.status(401).json({ error: 'That player no longer exists' })

  const [matches, inProgress] = await Promise.all([
    getPlayerMatches(query, req.player.id),
    countMatchesInProgress(query, req.player.id),
  ])

  res.json({
    player: { id: rows[0].id, name: rows[0].name, claimedAt: rows[0].claimed_at },
    summary: summarisePlayer(matches),
    // Lets the empty state say "being scored right now" rather than the
    // flatly discouraging "no matches".
    inProgress,
  })
})

router.get('/matches', async (req, res) => {
  res.json({ matches: await getPlayerMatches(query, req.player.id) })
})

export default router
