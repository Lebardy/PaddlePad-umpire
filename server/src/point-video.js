import { query } from './db.js'
import { bucketConfig, signedReadUrl } from './bucket.js'
import { highlightClips, rallySeconds } from './video-times.js'
import { pointRallyOrder } from './player-stats.js'
import { orderVideos, sideOf } from './video-sides.js'
import { displaySurname } from './video-name.js'

/** `(side) => surnames` of that side's players (`[]` for no side), for a row with `team_a` and `team_b`. */
export async function sideSurnames(matchRow) {
  const team = { A: matchRow.team_a, B: matchRow.team_b }
  const { rows: people } = await query('SELECT id, name FROM players WHERE id = ANY($1::uuid[])', [[...matchRow.team_a, ...matchRow.team_b]])
  const nameOf = new Map(people.map((p) => [p.id, p.name]))
  return (side) => (team[side] ?? []).map((id) => displaySurname(nameOf.get(id) ?? '')).filter(Boolean)
}

/**
 * A match's videos for the point boxes: `{ video, otherVideo }`, the one
 * to show first and the other side's, each null when there is none or
 * video is not set up here. Each is a link good for two hours, and for
 * each POINT the second its rally starts at -- null for a point the video
 * does not show -- and the umpire's highlights as clips (start and end
 * seconds). `row` is the match, `events` its rows in play order
 * (with `at`), `log` the same events as the scoring engine reads them.
 * `prefer` is the side shown first (default: the player's own); a facility
 * video always comes first. `mayRemove` is true only for the video this
 * player filmed. With `fileName` (players only), each also has a link that
 * saves the file under that name; with two videos each name ends with its
 * side's surnames, so the two files differ.
 */
export async function pointVideos(row, events, log, { playerId, fileName, prefer = sideOf(row, playerId) } = {}) {
  const none = { video: null, otherVideo: null }
  const config = bucketConfig()
  if (!config) return none
  const { rows } = await query(
    `SELECT v.*, m.highlights AS picked
       FROM match_videos v JOIN matches m ON m.id = v.match_id
      WHERE v.match_id = $1 AND v.state = 'ready'`,
    [row.id],
  )
  const [first, second] = orderVideos(rows, prefer)
  if (!first) return none
  const sideNames = await sideSurnames(row)

  const timed = events.filter((e) => e.type === 'rally').map((e) => ({ id: e.id, atMs: new Date(e.at).getTime() }))
  // For each point, which rally scored it.
  const order = pointRallyOrder(row, log)
  const one = (video) => {
    const timing = {
      startedAtMs: new Date(row.started_at).getTime(),
      offsetMs: row.clock_offset_ms,
      firstFrameAtMs: new Date(video.first_frame_at).getTime(),
      durationMs: video.duration_ms,
    }
    const everyRally = rallySeconds({ ...timing, rallies: timed })
    const names = sideNames(video.side)
    const name = second && fileName ? `${fileName} (${names.join('-')})` : fileName
    return {
      url: signedReadUrl(config, video.file_key),
      durationMs: video.duration_ms,
      width: video.width,
      height: video.height,
      repacked: video.repacked,
      side: video.side,
      sideNames: names,
      mayRemove: video.source === 'player' && video.player_id === playerId,
      seconds: order.map((rally) => everyRally[rally] ?? null),
      highlights: highlightClips({ ...timing, rallies: timed, picked: video.picked ?? [] })
        .map(({ id, start, end }) => ({ start, end, rally: id })),
      ...(name ? { fileName: name, downloadUrl: signedReadUrl(config, video.file_key, { download: `${name}.mp4` }) } : {}),
    }
  }
  return { video: one(first), otherVideo: second ? one(second) : null }
}
