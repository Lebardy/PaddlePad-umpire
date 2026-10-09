// ============================================================
// Figures derived on the client from what the server already sent.
//
// Everything here is a plain count or ratio over this player's own
// matches. Nothing needs other players to exist, which is what makes it
// safe to show from the very first match -- unlike a skill rating,
// which is scaled against every other player and would visibly move because
// SOMEONE ELSE played.
// ============================================================

/** Results of the most recent matches, newest first. */
export function recentForm(matches, count = 5) {
  return matches.slice(0, count).map((m) => ({ id: m.id, won: m.won }))
}

/**
 * The current run of wins or losses.
 *
 * Counts from the newest match backwards and stops at the first
 * different result. A match with no result (stopped at a tie) breaks a
 * streak rather than extending it either way.
 */
export function currentStreak(matches) {
  if (matches.length === 0 || matches[0].won === null) return null
  const won = matches[0].won
  let length = 0
  for (const match of matches) {
    if (match.won !== won) break
    length += 1
  }
  return { won, length }
}

/** The win with the biggest points margin, if there is one. */
export function bestWin(matches) {
  const wins = matches.filter((m) => m.won === true)
  if (wins.length === 0) return null
  return wins.reduce((best, m) =>
    m.yourScore - m.theirScore > best.yourScore - best.theirScore ? m : best,
  )
}

/**
 * The match won from furthest behind.
 *
 * Read off `progression`, the per-point score margin from this player's
 * side that the server already sends with every match, so this costs no
 * request and no new endpoint.
 *
 * It exists because the card it replaced showed the same number as
 * "Biggest win" in Your best -- both called bestWin(), and the two sat
 * next to each other on the overview showing one score twice under two
 * labels. A comeback is the honest opposite of a biggest win: one is how
 * well it can go, the other is how badly it can go and still be won.
 *
 * Null when no won match was ever behind, rather than a comeback of
 * zero, so the card is left out instead of claiming one.
 */
export function biggestComeback(matches) {
  let best = null

  for (const match of matches) {
    if (match.won !== true) continue
    const margins = match.progression ?? []
    if (margins.length === 0) continue

    const lowest = Math.min(...margins)
    // Never actually trailed, so nothing was come back from.
    if (lowest >= 0) continue

    if (!best || -lowest > best.deficit) best = { match, deficit: -lowest }
  }

  return best
}

/**
 * Everyone this player has shared a court with, each appearing ONCE.
 *
 * Replaces the old partner list plus opponent list, which drew anybody
 * who had been both -- four of twenty-four people in real data -- twice,
 * and which together produced twenty-eight near-identical rows out of
 * fifteen matches.
 *
 * Both roles travel on one entry because they are facts about the same
 * relationship: "we won two together, and you beat me once" is a
 * sentence about one person, not two list items.
 *
 * Keyed by NAME, because names are all the server sends for partners
 * and opponents: it resolves ids to names before responding, so two
 * players sharing a name are counted as one person. Written down as a
 * known limit rather than left to be discovered.
 */
export function peopleTogether(matches) {
  const blank = () => ({ played: 0, won: 0, lost: 0 })
  const people = new Map()

  const entry = (name) => {
    if (!people.has(name)) {
      people.set(name, {
        name,
        together: blank(),
        faced: blank(),
        total: 0,
        lastPlayed: null,
        form: [],
      })
    }
    return people.get(name)
  }

  const record = (side, match) => {
    side.played += 1
    if (match.won === true) side.won += 1
    else if (match.won === false) side.lost += 1
  }

  // Matches arrive newest first, so `form` comes out newest first for
  // free and lastPlayed is simply the first one seen.
  for (const match of matches) {
    const roles = [
      [match.partner, 'together'],
      ...(match.opponents ?? []).map((name) => [name, 'faced']),
    ]
    for (const [name, role] of roles) {
      if (!name) continue
      const person = entry(name)
      record(person[role], match)
      person.total += 1
      if (!person.lastPlayed) person.lastPlayed = match.endedAt
      person.form.push({ id: match.id, won: match.won })
    }
  }

  return [...people.values()].sort(
    (a, b) =>
      b.total - a.total ||
      String(b.lastPlayed ?? '').localeCompare(String(a.lastPlayed ?? '')) ||
      a.name.localeCompare(b.name),
  )
}

/**
 * The facts that survive a long tail of one-match relationships.
 *
 * This is what replaced a "best partner" win rate. Where
 * partners rotate every match almost nobody reaches three matches with
 * the same person, so a rate was either meaningless or -- once gated to
 * stop it being meaningless -- absent entirely, which is exactly what
 * happened. A count is true and worth reading at any sample size.
 *
 * `beaten` and `lostTo` count distinct PEOPLE, not matches: "you have
 * beaten nine people" is the fact, and beating one of them four times
 * does not make it nine.
 */
export function peopleSummary(matches) {
  const people = peopleTogether(matches)
  const beaten = new Set()
  const lostTo = new Set()

  for (const match of matches) {
    for (const name of match.opponents ?? []) {
      if (match.won === true) beaten.add(name)
      else if (match.won === false) lostTo.add(name)
    }
  }

  return {
    people: people.length,
    partners: people.filter((p) => p.together.played > 0).length,
    faced: people.filter((p) => p.faced.played > 0).length,
    beaten: beaten.size,
    lostTo: lostTo.size,
    playedMost: people[0] ?? null,
  }
}

/**
 * Win rate over a sliding window, oldest first, for the form chart.
 *
 * Returns an empty array until there are enough matches to fill one
 * window. A "trend" drawn from two matches is a straight line between
 * two coin flips, and showing it would invite a player to read
 * improvement into noise.
 */
export function rollingWinRate(matches, window = 5) {
  if (matches.length < window) return []
  const oldestFirst = [...matches].reverse()
  const points = []
  for (let i = window - 1; i < oldestFirst.length; i += 1) {
    const slice = oldestFirst.slice(i - window + 1, i + 1)
    const decided = slice.filter((m) => m.won !== null)
    if (decided.length === 0) continue
    points.push({
      matchNumber: oldestFirst[i].matchNumber,
      value: decided.filter((m) => m.won === true).length / decided.length,
    })
  }
  return points
}

/**
 * "Your best": the biggest win, the biggest comeback and the cleanest
 * match -- one row of three on the Overview, each one a way into its
 * match. A tile with nothing to show is left out.
 *
 * The "most winning shots" cards that stood here counted raw shots, which
 * had to be split by singles and doubles to be fair and still said less
 * than the ratio below; the comeback moved in from the Highlights row the
 * Overview no longer has.
 */
export function personalBests(matches) {
  if (matches.length === 0) return []

  const winnersIn = (m) => m.stats.clean_winners + m.stats.dink_winners
  const errorsIn = (m) => m.stats.unforced_errors + m.stats.dink_errors

  const best = bestWin(matches)
  const comeback = biggestComeback(matches)
  // Only matches with at least one error, so this is a real ratio rather
  // than a division by zero dressed up as perfection.
  const cleanest = matches.filter((m) => m.stats && errorsIn(m) > 0)
  const bestRatio = cleanest.length
    ? cleanest.reduce((a, b) => (winnersIn(b) / errorsIn(b) > winnersIn(a) / errorsIn(a) ? b : a))
    : null

  return [
    best && {
      key: 'margin',
      label: 'Biggest win',
      value: `${best.yourScore}–${best.theirScore}`,
      detail: `vs ${(best.opponents ?? []).join(' & ')}`,
      matchId: best.id,
    },
    comeback && {
      key: 'comeback',
      label: 'Biggest comeback',
      value: `${comeback.deficit} down`,
      detail: `won ${comeback.match.yourScore}–${comeback.match.theirScore}`,
      matchId: comeback.match.id,
    },
    bestRatio && {
      key: 'ratio',
      label: 'Cleanest match',
      value: (winnersIn(bestRatio) / errorsIn(bestRatio)).toFixed(1),
      detail: 'winning shots per mistake',
      matchId: bestRatio.id,
    },
  ].filter(Boolean)
}
