// ============================================================
// Loads the history the rally rating is replayed from, and keeps the
// result in memory until something changes it.
//
// Rebuilt from scratch rather than updated in place: at PaddlePad's
// size a full replay takes a fraction of a second, and a rebuild can
// never disagree with the history the way an incrementally patched
// number can after a void or an undo.
//
// Every route that can change a completed match, or whether it counts,
// calls invalidateRallyRatings(). A restart simply rebuilds on the first
// request.
// ============================================================

import { eventFromRow } from './pickleball.js'
import { rateHistory } from './rally-rating.js'

let cached = null

export function invalidateRallyRatings() {
  cached = null
}

export function getRallyRatings(query) {
  if (!cached) {
    const loading = loadRallyRatings(query)
    cached = loading
    // A failed load must not be cached, or one database hiccup would
    // break ratings until the next match finished.
    loading.catch(() => {
      if (cached === loading) cached = null
    })
  }
  return cached
}

async function loadRallyRatings(query) {
  // The same matches the export counts: completed, not voided, and not
  // in a voided session.
  const { rows: matches } = await query(
    `SELECT m.id, m.team_a, m.team_b, m.first_server_team, m.first_server_player,
            m.point_target, m.right_start_a, m.right_start_b, m.ended_at
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
      WHERE m.status = 'completed'
        AND m.ended_at IS NOT NULL
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL`,
  )
  if (matches.length === 0) return new Map()

  const { rows: events } = await query(
    `SELECT e.match_id, e.id, e.seq, e.type, e.payload
       FROM match_events e
       JOIN matches m ON m.id = e.match_id
       JOIN sessions s ON s.id = m.session_id
      WHERE m.status = 'completed'
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL
      ORDER BY e.match_id, e.seq`,
  )

  const eventsByMatch = new Map()
  for (const row of events) {
    if (!eventsByMatch.has(row.match_id)) eventsByMatch.set(row.match_id, [])
    eventsByMatch.get(row.match_id).push(eventFromRow(row))
  }

  return rateHistory(
    matches.map((m) => ({
      id: m.id,
      endedAt: m.ended_at,
      teamA: m.team_a,
      teamB: m.team_b,
      firstServer: { team: m.first_server_team, playerId: m.first_server_player },
      rightStart: { A: m.right_start_a, B: m.right_start_b },
      pointTarget: m.point_target,
      events: eventsByMatch.get(m.id) ?? [],
    })),
  )
}
