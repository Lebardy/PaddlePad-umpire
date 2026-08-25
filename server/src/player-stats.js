// ============================================================
// A single player's own history.
//
// Deliberately NOT built on buildMatchLogRows(). That function takes no
// filter and assigns match_number in a second pass over the entire
// club's history, so filtering its output would mean scanning every
// match ever played on each page view. It also returns partners and
// opponents as UUIDs, and a player wants names.
//
// The exclusions here mirror the export exactly -- completed, not
// voided, not in a voided session. A match an umpire threw out for a
// wrong pairing must not appear in a player's history either; showing
// someone a match they were wrongly credited with is worse than showing
// them nothing.
// ============================================================

import { deriveMatchState } from './pickleball.js'

/**
 * Every completed match this player appeared in, newest first.
 *
 * `matchNumber` is "this player's Nth match", computed with a window
 * function scoped to them rather than the export's global count.
 */
export async function getPlayerMatches(query, playerId) {
  const { rows } = await query(
    `SELECT m.id,
            m.team_a,
            m.team_b,
            m.stacking_a,
            m.stacking_b,
            m.first_server_team,
            m.first_server_player,
            m.winner,
            m.started_at,
            m.ended_at,
            m.ended_early,
            s.name AS session_name,
            row_number() OVER (ORDER BY m.ended_at) AS match_number
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
      WHERE (m.team_a @> ARRAY[$1]::uuid[] OR m.team_b @> ARRAY[$1]::uuid[])
        AND m.status = 'completed'
        AND m.ended_at IS NOT NULL
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL
      ORDER BY m.ended_at`,
    [playerId],
  )
  if (rows.length === 0) return []

  const matchIds = rows.map((r) => r.id)

  const { rows: events } = await query(
    `SELECT match_id, type, payload
       FROM match_events
      WHERE match_id = ANY($1::uuid[])
      ORDER BY match_id, seq`,
    [matchIds],
  )

  const eventsByMatch = new Map()
  for (const event of events) {
    if (!eventsByMatch.has(event.match_id)) eventsByMatch.set(event.match_id, [])
    eventsByMatch.get(event.match_id).push({ type: event.type, ...event.payload })
  }

  // Resolve every id on court to a name in one query -- a player reading
  // their history wants "with Gemma, against Josh and Alice", not UUIDs.
  const everyone = new Set()
  for (const row of rows) {
    for (const id of [...row.team_a, ...row.team_b]) everyone.add(id)
  }
  const { rows: people } = await query(
    'SELECT id, name FROM players WHERE id = ANY($1::uuid[])',
    [[...everyone]],
  )
  const nameOf = new Map(people.map((p) => [p.id, p.name]))

  const result = rows.map((row) => {
    const derived = deriveMatchState({
      teamA: row.team_a,
      teamB: row.team_b,
      firstServer: {
        team: row.first_server_team,
        playerId: row.first_server_player,
      },
      events: eventsByMatch.get(row.id) ?? [],
    })

    const team = row.team_a.includes(playerId) ? 'A' : 'B'
    const ownTeam = team === 'A' ? row.team_a : row.team_b
    const opponents = team === 'A' ? row.team_b : row.team_a

    return {
      id: row.id,
      matchNumber: Number(row.match_number),
      sessionName: row.session_name,
      endedAt: row.ended_at,
      startedAt: row.started_at,
      endedEarly: row.ended_early,
      isDoubles: row.team_a.length === 2,
      // From this player's point of view, not team A's.
      won: row.winner === null ? null : row.winner === team,
      yourScore: derived.score[team],
      theirScore: derived.score[team === 'A' ? 'B' : 'A'],
      partner: ownTeam
        .filter((id) => id !== playerId)
        .map((id) => nameOf.get(id) ?? 'Unknown')[0] ?? null,
      opponents: opponents.map((id) => nameOf.get(id) ?? 'Unknown'),
      usedStacking: team === 'A' ? row.stacking_a : row.stacking_b,
      stats: derived.stats[playerId],
    }
  })

  return result.reverse() // newest first for display
}

/**
 * Headline totals across a player's whole history.
 *
 * Only raw counts and simple ratios -- nothing here needs a population
 * to be meaningful. The skill score and playstyle archetype from the ML
 * pipeline deliberately are NOT computed here: those need many matches
 * per player and many players before they say anything true, and a
 * rating that moves because someone else played would destroy trust in
 * it immediately.
 */
export function summarisePlayer(matches) {
  const totals = {
    matches: matches.length,
    wins: 0,
    losses: 0,
    cleanWinners: 0,
    dinkWinners: 0,
    unforcedErrors: 0,
    dinkErrors: 0,
    dropAttempts: 0,
    dropSuccesses: 0,
    driveAttempts: 0,
  }

  for (const match of matches) {
    if (match.won === true) totals.wins += 1
    else if (match.won === false) totals.losses += 1

    const s = match.stats
    totals.cleanWinners += s.clean_winners
    totals.dinkWinners += s.dink_winners
    totals.unforcedErrors += s.unforced_errors
    totals.dinkErrors += s.dink_errors
    totals.dropAttempts += s.drop_attempts
    totals.dropSuccesses += s.drop_successes
    totals.driveAttempts += s.drive_attempts
  }

  const decided = totals.wins + totals.losses
  const thirdShots = totals.dropAttempts + totals.driveAttempts

  return {
    ...totals,
    totalWinners: totals.cleanWinners + totals.dinkWinners,
    totalErrors: totals.unforcedErrors + totals.dinkErrors,
    // Null rather than 0 when there's nothing to divide by, so the app
    // can say "not enough matches yet" instead of showing a confident 0%.
    winRate: decided > 0 ? totals.wins / decided : null,
    dropSuccessRate:
      totals.dropAttempts > 0 ? totals.dropSuccesses / totals.dropAttempts : null,
    dropPreference: thirdShots > 0 ? totals.dropAttempts / thirdShots : null,
  }
}

/**
 * How many matches this player is in that haven't finished yet.
 *
 * Exists purely for the empty state. "No matches yet" and "a match of
 * yours is being scored right now" feel completely different to someone
 * who just claimed their code: the first reads like the app is broken,
 * the second reads like it is working and waiting. Without this the app
 * cannot tell them apart.
 */
export async function countMatchesInProgress(query, playerId) {
  const { rows } = await query(
    `SELECT count(*)::int AS n
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
      WHERE (m.team_a @> ARRAY[$1]::uuid[] OR m.team_b @> ARRAY[$1]::uuid[])
        AND m.status = 'in_progress'
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL`,
    [playerId],
  )
  return rows[0].n
}
