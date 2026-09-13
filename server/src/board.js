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

import { deriveMatchState, eventFromRow } from './pickleball.js'
import { getPlayerMatches, scoreProgression } from './player-stats.js'
import { DRAMA_ORDER, readGame } from './drama.js'

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

// A player's "usual" game needs this many other finished games behind
// it to mean anything; below it, this month's typical game stands in.
// Three, for the same reason as STEP_UP_MIN_MATCHES: one outlier stops
// deciding it.
export const USUAL_MIN_GAMES = 3

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

/** One drama fact for a game, or 0 when the game carries no reading. */
function dramaOf(match, of) {
  return match.game ? of(match.game) : 0
}

/**
 * What actually separated the chosen game from the next-best one won by
 * the same margin, so the page can say why it was picked and be right.
 *
 * 'margin' when no other game was as close; otherwise the first of
 * DRAMA_ORDER on which it beat the runner-up, then 'length', then
 * 'recency' for two games identical on everything that was counted.
 */
function decidedBy(best, candidates) {
  const runnerUp = candidates.find((c) => c !== best && c.margin === best.margin)
  if (!runnerUp) return 'margin'
  for (const { key, of } of DRAMA_ORDER) {
    if (dramaOf(best, of) > dramaOf(runnerUp, of)) return key
  }
  if (best.total > runnerUp.total) return 'length'
  return 'recency'
}

/** A share to three places -- a tenth of a percent, which is plenty. */
function roundShare(x) {
  return Math.round(x * 1000) / 1000
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * How clean these players usually play, and whether that is known.
 *
 * Their "usual" is the average cleanness of the OTHER finished games
 * each of them has played -- a history of games, never of anyone's own
 * shots. Anyone with fewer than USUAL_MIN_GAMES of those is judged
 * against the month's typical game instead, and `basis` says whether
 * every player had a history of their own ('players') or some did not
 * ('mixed'), so the page never claims more than was measured.
 */
function usualFor(match, history, typical) {
  let known = 0
  const each = [...match.teamA, ...match.teamB].map((id) => {
    const others = history.filter(
      (h) => h.id !== match.id && h.players.includes(id) && Number.isFinite(h.clean),
    )
    if (others.length >= USUAL_MIN_GAMES) {
      known += 1
      return mean(others.map((h) => h.clean))
    }
    return typical
  })
  return { usual: mean(each), basis: known === each.length ? 'players' : 'mixed' }
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
 * @param {Array<{id, players: string[], clean: number}>} input.history
 *   every finished game this month's players have played, all time, with
 *   its cleanness -- what "cleaner than they usually play" is judged on
 */
export function buildBoard({ matches, visible, nameOf, progress = [], history = [] }) {
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
  //
  // And it has to have been played CLEANER than its players usually
  // play. Picking on drama alone kept rewarding messy games, because
  // mistakes are exactly what make the lead swing: on staging the three
  // most back-and-forth games of the month were all messier than
  // average, one of them with three rallies in four ending in a mistake.
  // A single bar for everyone would have fixed that and shut beginners
  // out -- players' usual games ranged from 44% to 78% clean -- so each
  // game is measured against its own players instead. Everyone has the
  // same way in: play better than you usually do, in a close game.
  const finished = matches.filter((m) => !m.endedEarly)
  const cleans = finished
    .map((m) => m.clean)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  // The month's typical game, for players with no history of their own.
  const typical = cleans.length > 0 ? cleans[Math.floor(cleans.length / 2)] : null

  const candidates = finished
    .filter((m) => [...m.teamA, ...m.teamB].every((id) => visible.has(id)))
    .map((m) => ({
      ...m,
      margin: Math.abs(m.score.A - m.score.B),
      total: m.score.A + m.score.B,
      ...(Number.isFinite(m.clean) && typical !== null ? usualFor(m, history, typical) : {}),
    }))
    // A game with no rallies counted has nothing to judge, and is let
    // through rather than excluded on no evidence.
    .filter((m) => !Number.isFinite(m.usual) || m.clean + 1e-9 >= m.usual)
    // Closest first. Among games won by the same margin -- and in a real
    // month sixteen were won by two -- the most DRAMATIC, in the order
    // DRAMA_ORDER gives: the game the losers nearly won, then the one
    // that swung most, and so on. Only then the longer game, and last the
    // most recent, so a tie always has one answer.
    //
    // This used to go straight from margin to length, which picked a
    // 14-12 over a 12-10 that took 68 rallies, changed hands five times
    // and saw the losers miss two game points.
    .sort(
      (a, b) =>
        a.margin - b.margin ||
        DRAMA_ORDER.reduce((found, { of }) => found || dramaOf(b, of) - dramaOf(a, of), 0) ||
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
        decidedBy: decidedBy(best, candidates),
        // The share of rallies that ended with a winning shot, for the
        // whole game, and what these players usually manage -- the reason
        // it was eligible at all. Never broken down by person.
        // Rounded at the source, as the skill score is, so the page is
        // never handed 0.4000000000000001 for what it shows as 40%. The
        // eligibility test above compares the unrounded values.
        clean: Number.isFinite(best.clean) ? roundShare(best.clean) : null,
        usualClean: Number.isFinite(best.usual) ? roundShare(best.usual) : null,
        cleanBasis: best.basis ?? null,
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
  if (rows.length === 0) return { ...month, visible: new Set(), nameOf: new Map(), history: [] }

  const { rows: events } = await query(
    `SELECT match_id, id, type, payload
       FROM match_events
      WHERE match_id = ANY($1::uuid[])
      ORDER BY match_id, seq`,
    [rows.map((r) => r.id)],
  )
  for (const e of events) {
    if (!month.eventsByMatch.has(e.match_id)) month.eventsByMatch.set(e.match_id, [])
    month.eventsByMatch.get(e.match_id).push(eventFromRow(e))
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
    // Read from the winners' side, once, here -- the board ranks on it
    // and the match page shows it, and they must be the same numbers.
    // A match stopped early may have no winner, and is never a
    // candidate anyway.
    const winner = derived.winner ?? row.winner
    const margins = winner
      ? scoreProgression(row, month.eventsByMatch.get(row.id) ?? [], winner)
      : []
    const rallies = (month.eventsByMatch.get(row.id) ?? []).filter((e) => e.type === 'rally')
    return {
      id: row.id,
      teamA: row.team_a,
      teamB: row.team_b,
      score: derived.score,
      endedAt: row.ended_at,
      endedEarly: row.ended_early,
      winner,
      margins,
      game: winner ? readGame(margins, row.point_target) : null,
      // The share of rallies that ended with a winning shot rather than
      // a mistake -- for the whole game, never split by person.
      clean: rallies.length > 0
        ? rallies.filter((e) => e.outcome === 'winner').length / rallies.length
        : null,
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

  // Every finished game these players have ever played, with how clean
  // it was -- what "cleaner than they usually play" is measured against.
  // Worked out in the database rather than by loading every event of
  // everyone's whole history into memory. Stopped-early games are left
  // out: a game abandoned at 4-2 says nothing about how people play.
  const { rows: past } = await query(
    `SELECT m.id, m.team_a, m.team_b,
            count(*) FILTER (WHERE e.type = 'rally' AND e.payload->>'outcome' = 'winner')::float
              / NULLIF(count(*) FILTER (WHERE e.type = 'rally'), 0) AS clean
       FROM matches m
       JOIN sessions s ON s.id = m.session_id
       JOIN match_events e ON e.match_id = m.id
      WHERE m.status = 'completed'
        AND m.ended_at IS NOT NULL
        AND m.voided_at IS NULL
        AND s.voided_at IS NULL
        AND NOT m.ended_early
        AND (m.team_a && $1::uuid[] OR m.team_b && $1::uuid[])
      GROUP BY m.id`,
    [everyone],
  )
  const history = past.map((h) => ({
    id: h.id,
    players: [...h.team_a, ...h.team_b],
    clean: h.clean,
  }))

  return { ...month, visible, nameOf, history }
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

  return {
    monthStart,
    resetsOn,
    ...buildBoard({ matches, visible, nameOf, progress, history: month.history }),
  }
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
    history: month.history,
  })
  if (!matchOfTheMonth || matchOfTheMonth.id !== matchId) return null

  const row = month.rows.find((r) => r.id === matchId)
  const chosen = month.matches.find((m) => m.id === matchId)
  const events = month.eventsByMatch.get(row.id) ?? []

  // Both ends come from a device clock, so a phone set wrong would show
  // a game lasting minus ten minutes or nine hours. Out-of-range values
  // are dropped rather than shown -- the same bound the ML export clamps
  // to, for the same reason.
  const minutes = Math.round((new Date(row.ended_at) - new Date(row.started_at)) / 60_000)

  return {
    ...matchOfTheMonth,
    // Told from the winning side, so the chart reads "above the line,
    // the winners were ahead" -- a neutral page still needs one point
    // of view.
    winner: chosen.winner,
    isDoubles: row.team_a.length === 2,
    pointTarget: row.point_target,
    margins: chosen.margins,
    // The same reading the board ranked it on, so the page can never
    // show a different number from the one that got it picked.
    game: chosen.game,
    // Every rally, including the ones that only changed the serve.
    // A count for the whole game, not split by anyone.
    rallies: events.filter((e) => e.type === 'rally').length,
    minutes: minutes > 0 && minutes <= 240 ? minutes : null,
  }
}
