// ============================================================
// Figures derived on the client from what the server already sent.
//
// Everything here is a plain count or ratio over this player's own
// matches. Nothing needs other players to exist, which is what makes it
// safe to show from the very first match -- unlike a skill rating,
// which is scaled against the whole club and would visibly move because
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
 * A win/loss record against every name in a list drawn from each match.
 *
 * People are keyed by NAME, because names are all the server sends for
 * partners and opponents -- it resolves ids to names before responding.
 * Two players sharing a name would therefore be tallied as one person.
 * Fixing that would mean the server sending ids as well, which is not
 * worth a round of API changes for a club this size; it is written down
 * here so it is a known limit rather than a surprise later.
 */
function tallyBy(matches, namesOf) {
  const tally = new Map()
  for (const match of matches) {
    for (const name of namesOf(match)) {
      if (!name) continue
      const entry = tally.get(name) ?? { name, played: 0, won: 0, lost: 0 }
      entry.played += 1
      if (match.won === true) entry.won += 1
      else if (match.won === false) entry.lost += 1
      tally.set(name, entry)
    }
  }
  return [...tally.values()].sort((a, b) => b.played - a.played || a.name.localeCompare(b.name))
}

/** Everyone this player has partnered, most-played first. */
export function partnerRecords(matches) {
  return tallyBy(matches, (m) => [m.partner])
}

/**
 * Everyone this player has faced, most-played first.
 *
 * A doubles match contributes to BOTH opponents, so the totals here add
 * up to more than the number of matches played. That is the honest
 * reading of "how do I do against this person" and is what the screen
 * says: matches faced, not matches played.
 */
export function opponentRecords(matches) {
  return tallyBy(matches, (m) => m.opponents ?? [])
}

/** Who this player has partnered most, and how it went. */
export function topPartner(matches) {
  return partnerRecords(matches)[0] ?? null
}

/**
 * The longest run of wins this player has ever put together.
 *
 * Uses the same rule as currentStreak: a match with no result breaks a
 * run rather than extending it.
 */
export function longestWinStreak(matches) {
  let best = 0
  let run = 0
  // Oldest first, so a run reads in the direction it was played.
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    if (matches[i].won === true) {
      run += 1
      best = Math.max(best, run)
    } else {
      run = 0
    }
  }
  return best
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
 * Standout single matches, each one a door into the match detail.
 *
 * Every entry is null when it cannot be computed rather than zero, so
 * the screen can leave it out instead of claiming a best of nothing.
 */
export function personalBests(matches) {
  if (matches.length === 0) return []

  const withStats = matches.filter((m) => m.stats)
  const winnersIn = (m) => m.stats.clean_winners + m.stats.dink_winners
  const errorsIn = (m) => m.stats.unforced_errors + m.stats.dink_errors

  const best = bestWin(matches)
  const mostWinners = withStats.length
    ? withStats.reduce((a, b) => (winnersIn(b) > winnersIn(a) ? b : a))
    : null
  // Only matches with at least one error, so this is a real ratio rather
  // than a division by zero dressed up as perfection.
  const cleanest = withStats.filter((m) => errorsIn(m) > 0)
  const bestRatio = cleanest.length
    ? cleanest.reduce((a, b) =>
        winnersIn(b) / errorsIn(b) > winnersIn(a) / errorsIn(a) ? b : a,
      )
    : null

  return [
    best && {
      key: 'margin',
      label: 'Biggest win',
      value: `${best.yourScore}\u2013${best.theirScore}`,
      detail: `vs ${(best.opponents ?? []).join(' & ')}`,
      matchId: best.id,
    },
    mostWinners &&
      winnersIn(mostWinners) > 0 && {
        key: 'winners',
        label: 'Most winning shots',
        value: String(winnersIn(mostWinners)),
        detail: `in one match`,
        matchId: mostWinners.id,
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
