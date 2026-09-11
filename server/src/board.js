// ============================================================
// This month on PaddlePad.
//
// A board that answers a request for a leaderboard without becoming
// one. Every row is something people DID this month -- played a lot,
// met a lot of people, played a great game, got better than they used
// to be. Nothing on it is the rating model's opinion of anyone, and
// nothing puts one player's number next to another's to be compared.
//
// Two rows that were planned and deliberately are not here:
//
//   "Steadiest" would publish the model's judgement of a named person's
//   consistency. Nowhere else in the app does anyone see what the model
//   thinks of someone else, and a public board is the worst place to
//   start.
//
//   "Most improved" by rating would be wrong in a way nobody could see.
//   The skill score is graded on a curve -- relative to whoever has
//   played -- so it rises when weaker players join, and the row could
//   crown someone who had not played at all. "Biggest step up" below
//   compares a player only with their own earlier matches, which no one
//   else's games can move.
//
// Split in two on purpose. getMonthlyBoard gathers rows from the
// database; buildBoard decides what the board says, from plain data,
// with no database in reach -- which is what lets scripts/check-board.mjs
// test every rule here without staging, credentials or a network.
// ============================================================

import { deriveMatchState } from './pickleball.js'
import { getPlayerMatches, scoreProgression } from './player-stats.js'

// The month turns over at midnight where the players are, not in UTC,
// where it would roll over at eight in the morning. One time zone
// because PaddlePad is used in one place; the day that stops being
// true, this becomes a setting.
export const BOARD_TIME_ZONE = 'Asia/Manila'

// "Biggest step up" needs enough matches on BOTH sides of the month
// boundary to be about the player rather than about one lucky game.
// Three is the smallest number where one outlier stops deciding it --
// a judgement call, like the thresholds in rating-gate.js.
export const STEP_UP_MIN_MATCHES = 3

// And a real change, not a wobble: this month's rate must beat their
// own earlier rate by at least this fraction. Below it, the honest
// thing is to leave the row empty.
export const STEP_UP_MIN_GAIN = 0.2

// A tie is shown as a tie. Past this many names it becomes "and N
// more", so a quiet month where six people played once each does not
// turn the row into a list.
const MAX_NAMES = 3

/**
 * Everyone tied at the top of a count, by name.
 *
 * Alphabetical, and only among a tie, so the order can never be read as
 * a ranking: everyone listed has the same number.
 */
function topOf(counts, visible, nameOf) {
  let best = 0
  for (const [id, n] of counts) {
    if (visible.has(id) && n > best) best = n
  }
  if (best === 0) return null

  const names = [...counts]
    .filter(([id, n]) => visible.has(id) && n === best)
    .map(([id]) => nameOf.get(id) ?? 'Unknown')
    .sort((a, b) => a.localeCompare(b))

  return {
    names: names.slice(0, MAX_NAMES),
    more: Math.max(names.length - MAX_NAMES, 0),
    count: best,
  }
}

/**
 * Winning shots per mistake, smoothed.
 *
 * The +1 on both sides keeps a player with no mistakes from scoring
 * infinity and one with no winners from scoring zero, both of which
 * would let a single quiet match decide the row. It is the same ratio
 * the overview shows, nudged towards 1 when there is little to go on.
 */
function shotRate({ winners, errors }) {
  return (winners + 1) / (errors + 1)
}

/**
 * What the board says, from plain data.
 *
 * @param {object} input
 * @param {Array<{id, teamA, teamB, score: {A,B}, endedAt, endedEarly}>} input.matches
 *   this month's finished, un-voided matches
 * @param {Set<string>} input.visible players who may be named
 * @param {Map<string,string>} input.nameOf id -> display name
 * @param {Array<{id, thisMonth: {winners, errors, matches}, before: {winners, errors, matches}}>} input.progress
 *   per-player totals for "biggest step up"; players outside `visible`
 *   are ignored even if present
 */
export function buildBoard({ matches, visible, nameOf, progress = [] }) {
  // ---- Played the most ----
  const played = new Map()
  // ---- Met the most people ----
  // Partners and opponents alike. Doubles puts three other people on
  // court and singles one, so a doubles regular will meet more people --
  // and that is the true thing this row celebrates, not a distortion of
  // it. It is a count of people, not a measure of play.
  const met = new Map()

  for (const match of matches) {
    const everyone = [...match.teamA, ...match.teamB]
    for (const id of everyone) {
      played.set(id, (played.get(id) ?? 0) + 1)
      if (!met.has(id)) met.set(id, new Set())
      for (const other of everyone) if (other !== id) met.get(id).add(other)
    }
  }

  const metCounts = new Map([...met].map(([id, people]) => [id, people.size]))

  // ---- Match of the month ----
  // The closest finished game, naming everyone in it, whoever won. A
  // match stopped early is not a finished game however close its score,
  // and a match with anyone in it who hides their name is passed over
  // entirely: naming three people and blanking the fourth tells anyone
  // who was there exactly who the fourth was.
  const candidates = matches
    .filter((m) => !m.endedEarly)
    .filter((m) => [...m.teamA, ...m.teamB].every((id) => visible.has(id)))
    .map((m) => ({
      ...m,
      margin: Math.abs(m.score.A - m.score.B),
      total: m.score.A + m.score.B,
    }))
    // Closest first; then the longer game, since 12-10 is a better game
    // than 11-9; then the most recent, so a tie has one answer.
    .sort(
      (a, b) =>
        a.margin - b.margin ||
        b.total - a.total ||
        new Date(b.endedAt) - new Date(a.endedAt),
    )

  const best = candidates[0]
  const matchOfTheMonth = best
    ? {
        // So the board can open it. Only this one match is ever
        // viewable this way -- see getMatchOfTheMonthStory.
        id: best.id,
        // Why it was picked, in numbers the page can say honestly. Read
        // across a real month, "the closest of 105" would have been
        // misleading: sixteen games were won by two, so the true claim is
        // "one of 16 won by two, and the one that went furthest". All
        // three are counted from the games it was chosen among, not every
        // match this month.
        outOf: candidates.length,
        sameMargin: candidates.filter((c) => c.margin === best.margin).length,
        wentFurthest: candidates.every(
          (c) => c === best || c.margin !== best.margin || c.total < best.total,
        ),
        teamA: best.teamA.map((id) => nameOf.get(id) ?? 'Unknown'),
        teamB: best.teamB.map((id) => nameOf.get(id) ?? 'Unknown'),
        score: best.score,
        endedAt: best.endedAt,
      }
    : null

  // ---- Biggest step up ----
  // Against their OWN earlier matches and nobody else's, which is what
  // makes it immune to the curve the rating is graded on.
  // A tolerance on every comparison, because these are ratios of
  // ratios and two players with the same real gain can differ in the
  // fifteenth decimal place -- which would silently break a tie.
  const EPSILON = 1e-9
  const gains = []
  for (const p of progress) {
    if (!visible.has(p.id)) continue
    if (p.thisMonth.matches < STEP_UP_MIN_MATCHES) continue
    if (p.before.matches < STEP_UP_MIN_MATCHES) continue

    const gain = shotRate(p.thisMonth) / shotRate(p.before) - 1
    if (gain + EPSILON >= STEP_UP_MIN_GAIN) gains.push({ id: p.id, gain })
  }
  const topGain = Math.max(...gains.map((g) => g.gain))
  const stepNames = gains
    .filter((g) => Math.abs(g.gain - topGain) <= EPSILON)
    .map((g) => nameOf.get(g.id) ?? 'Unknown')
    .sort((a, b) => a.localeCompare(b))

  return {
    playedMost: topOf(played, visible, nameOf),
    metMost: topOf(metCounts, visible, nameOf),
    matchOfTheMonth,
    // No number, on purpose. "Better than they used to be" is the
    // whole claim; a figure would invite comparing one person's
    // improvement with another's, which is the thing this avoids.
    biggestStepUp:
      stepNames.length > 0
        ? { names: stepNames.slice(0, MAX_NAMES), more: Math.max(stepNames.length - MAX_NAMES, 0) }
        : null,
  }
}

/** Sums one player's winning shots and mistakes over some matches. */
function totalsOf(playerMatches) {
  let winners = 0
  let errors = 0
  for (const m of playerMatches) {
    winners += m.stats.clean_winners + m.stats.dink_winners
    errors += m.stats.unforced_errors + m.stats.dink_errors
  }
  return { winners, errors, matches: playerMatches.length }
}

/**
 * Everything about the current month that both the board and its match
 * page need: the window, the finished matches in it with their scores,
 * and who may be named.
 *
 * Separate from getMonthlyBoard because "biggest step up" reads every
 * candidate's whole history, which the match page has no use for and
 * should not pay for.
 */
async function gatherMonth(query) {
  const { rows: bounds } = await query(
    `SELECT date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1 AS start_at,
            (date_trunc('month', now() AT TIME ZONE $1) + interval '1 month')
              AT TIME ZONE $1 AS end_at,
            to_char(date_trunc('month', now() AT TIME ZONE $1), 'YYYY-MM-DD') AS month_start,
            to_char(date_trunc('month', now() AT TIME ZONE $1) + interval '1 month',
                    'YYYY-MM-DD') AS resets_on`,
    [BOARD_TIME_ZONE],
  )
  const { start_at: startAt, end_at: endAt, month_start: monthStart, resets_on: resetsOn } =
    bounds[0]

  const { rows } = await query(
    `SELECT m.id, m.team_a, m.team_b, m.first_server_team, m.first_server_player,
            m.right_start_a, m.right_start_b, m.point_target, m.winner,
            m.started_at, m.ended_at, m.ended_early
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
      WHERE m.status = 'completed'
        AND m.ended_at IS NOT NULL
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL
        AND m.ended_at >= $1
        AND m.ended_at < $2`,
    [startAt, endAt],
  )

  const month = { monthStart, resetsOn, startAt, rows, eventsByMatch: new Map(), matches: [] }
  if (rows.length === 0) return { ...month, visible: new Set(), nameOf: new Map() }

  const { rows: events } = await query(
    `SELECT match_id, type, payload
       FROM match_events
      WHERE match_id = ANY($1::uuid[])
      ORDER BY match_id, seq`,
    [rows.map((r) => r.id)],
  )
  for (const e of events) {
    if (!month.eventsByMatch.has(e.match_id)) month.eventsByMatch.set(e.match_id, [])
    month.eventsByMatch.get(e.match_id).push({ type: e.type, ...e.payload })
  }

  // The score is not stored on the match row -- it is always derived
  // from the log, so this uses the same engine the server scores with.
  month.matches = rows.map((row) => {
    const derived = deriveMatchState({
      teamA: row.team_a,
      teamB: row.team_b,
      firstServer: { team: row.first_server_team, playerId: row.first_server_player },
      rightStart: { A: row.right_start_a, B: row.right_start_b },
      pointTarget: row.point_target,
      events: month.eventsByMatch.get(row.id) ?? [],
    })
    return {
      id: row.id,
      teamA: row.team_a,
      teamB: row.team_b,
      score: derived.score,
      endedAt: row.ended_at,
      endedEarly: row.ended_early,
    }
  })

  const everyone = [...new Set(month.matches.flatMap((m) => [...m.teamA, ...m.teamB]))]
  const { rows: people } = await query(
    `SELECT id, name, name_visible, deactivated_at
       FROM players WHERE id = ANY($1::uuid[])`,
    [everyone],
  )
  const nameOf = new Map(people.map((p) => [p.id, p.name]))
  // A closed account is never named, whatever its setting said.
  const visible = new Set(
    people.filter((p) => p.name_visible && !p.deactivated_at).map((p) => p.id),
  )

  return { ...month, visible, nameOf }
}

/**
 * The board for the current month, gathered from the database.
 *
 * Returns the month it covers and the day it resets, so the app can say
 * both -- a hierarchy that visibly expires is not much of a hierarchy.
 */
export async function getMonthlyBoard(query) {
  const month = await gatherMonth(query)
  const { matches, visible, nameOf, monthStart, resetsOn, startAt } = month

  // Only players who could qualify are looked up in full. Their whole
  // history is needed for "before", which is why this is not one query
  // over everyone.
  const monthCount = new Map()
  for (const m of matches) {
    for (const id of [...m.teamA, ...m.teamB]) monthCount.set(id, (monthCount.get(id) ?? 0) + 1)
  }
  const candidates = [...monthCount]
    .filter(([id, n]) => visible.has(id) && n >= STEP_UP_MIN_MATCHES)
    .map(([id]) => id)

  const progress = []
  const start = new Date(startAt)
  for (const id of candidates) {
    const history = await getPlayerMatches(query, id)
    progress.push({
      id,
      thisMonth: totalsOf(history.filter((m) => new Date(m.endedAt) >= start)),
      before: totalsOf(history.filter((m) => new Date(m.endedAt) < start)),
    })
  }

  return { monthStart, resetsOn, ...buildBoard({ matches, visible, nameOf, progress }) }
}

/**
 * The story of this month's match of the month, and of no other match.
 *
 * Returns null unless `matchId` IS the current match of the month. That
 * restriction is the point: an endpoint that told the story of any match
 * id would let a player read games they were not in and that were never
 * on the board -- including ones with a player who hides their name,
 * which the board passes over for exactly that reason.
 *
 * What it tells is the GAME, not the people in it: names, the score, and
 * how the lead moved. No one's winning shots, mistakes or drops. Leaving
 * a name visible agreed to being named on the board, not to having one's
 * mistakes shown to everyone.
 */
export async function getMatchOfTheMonthStory(query, matchId) {
  const month = await gatherMonth(query)
  const { matchOfTheMonth } = buildBoard({
    matches: month.matches,
    visible: month.visible,
    nameOf: month.nameOf,
  })
  if (!matchOfTheMonth || matchOfTheMonth.id !== matchId) return null

  const row = month.rows.find((r) => r.id === matchId)
  // Told from the winning side, so the chart reads "above the line, the
  // winners were ahead" -- a neutral page still needs one point of view.
  const winner = row.winner === 'B' ? 'B' : 'A'

  const events = month.eventsByMatch.get(row.id) ?? []

  // Both ends come from a device clock, so a phone set wrong would show
  // a game lasting minus ten minutes or nine hours. Out-of-range values
  // are dropped rather than shown -- the same bound the ML export clamps
  // to, for the same reason.
  const minutes = Math.round((new Date(row.ended_at) - new Date(row.started_at)) / 60_000)

  return {
    ...matchOfTheMonth,
    winner,
    isDoubles: row.team_a.length === 2,
    pointTarget: row.point_target,
    margins: scoreProgression(row, events, winner),
    // Every rally, including the ones that only changed the serve.
    // A count for the whole game, not split by anyone.
    rallies: events.filter((e) => e.type === 'rally').length,
    minutes: minutes > 0 && minutes <= 240 ? minutes : null,
  }
}
