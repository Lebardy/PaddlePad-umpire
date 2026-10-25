// The score a Camera screen shows while it films: worked out from the
// match's events with the same engine the scoring tablet uses.
import { deriveMatchState } from './pickleball.js'

/** `events` are eventFromRow rows, as board.js feeds the engine. */
export function liveScore(row, events) {
  const derived = deriveMatchState({
    teamA: row.team_a,
    teamB: row.team_b,
    firstServer: { team: row.first_server_team, playerId: row.first_server_player },
    rightStart: { A: row.right_start_a, B: row.right_start_b },
    pointTarget: row.point_target,
    events,
  })
  return { a: derived.score.A, b: derived.score.B, serving: derived.servingTeam, server: derived.serverNumber }
}
