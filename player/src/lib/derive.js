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

/**
 * How often a record was actually decided, and how much of it was won.
 *
 * The denominator is won + lost, NOT played. A match stopped early is
 * stored as completed with no winner (see player-stats.js), so tallyBy
 * counts it as played while counting it as neither -- dividing by
 * `played` would quietly score every retirement as a loss.
 *
 * Null rather than 0 when nothing has been decided, the same
 * distinction Meter relies on to render a dash instead of claiming 0%.
 */
export function decidedRate(person) {
  const decided = person.won + person.lost
  return decided > 0 ? person.won / decided : null
}

// Below this, a win rate is noise dressed as insight: at one match
// together everybody is either 100% or 0%. The app already reasons this
// way -- ratings gate at five matches, and personalBests refuses a
// "cleanest match" that never made a mistake.
const MIN_SHARED = 3

/**
 * The two people worth naming at the top of the People tab.
 *
 * Deliberately a DIFFERENT fact from the overview's "Most played with"
 * (topPartner, below). That one is a count, this is a rate, and they are
 * frequently different people -- the partner you play every week is not
 * necessarily the one you win with. Do not collapse them into one.
 *
 * Either may be null when nobody has played enough, in which case the
 * screen leaves the card out rather than showing a best of nothing --
 * the same shape personalBests uses.
 */
export function peopleHighlights(matches) {
  const eligible = (people) =>
    people.filter((p) => p.won + p.lost >= MIN_SHARED)

  const partners = eligible(partnerRecords(matches))
  const opponents = eligible(opponentRecords(matches))

  // Two candidates, not one. "Best" and "toughest" are superlatives, and
  // a superlative over a set of one says nothing -- it would happily
  // label the only person you have faced your "toughest opponent" while
  // showing 6-1 and 86% underneath it, which reads as a broken app
  // rather than a thin history. With nobody to compare against, the
  // lists below already say everything there is to say.
  const pick = (people, better) =>
    people.length >= 2 ? people.reduce(better) : null

  const bestPartner = pick(partners, (a, b) =>
    decidedRate(b) > decidedRate(a) ? b : a,
  )

  // "Toughest" is the one you win LEAST against, so this is a minimum.
  const toughestOpponent = pick(opponents, (a, b) =>
    decidedRate(b) < decidedRate(a) ? b : a,
  )

  return { bestPartner, toughestOpponent }
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

  // A raw count is not comparable between formats. In singles you take
  // every shot on your side; in doubles you take roughly half. So one
  // maximum across both would land on a singles match nearly every time
  // and quietly bury a good doubles one -- the card would really be
  // saying "your best singles match" while claiming to say more.
  //
  // Each format gets its own record instead. A player who only plays one
  // still sees exactly one card, now correctly labelled.
  //
  // The other two entries need no such treatment: a margin is a score,
  // and games go to the same target either way, while the ratio below
  // divides the player's share of the shots out of both halves.
  const mostWinnersIn = (isDoubles) => {
    const pool = withStats.filter((m) => m.isDoubles === isDoubles)
    if (pool.length === 0) return null
    const top = pool.reduce((a, b) => (winnersIn(b) > winnersIn(a) ? b : a))
    return winnersIn(top) > 0 ? top : null
  }
  const winnersCard = (match, format) =>
    match && {
      key: `winners-${format}`,
      label: 'Most winning shots',
      value: String(winnersIn(match)),
      detail: `in one ${format} match`,
      matchId: match.id,
    }
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
    winnersCard(mostWinnersIn(false), 'singles'),
    winnersCard(mostWinnersIn(true), 'doubles'),
    bestRatio && {
      key: 'ratio',
      label: 'Cleanest match',
      value: (winnersIn(bestRatio) / errorsIn(bestRatio)).toFixed(1),
      detail: 'winning shots per mistake',
      matchId: bestRatio.id,
    },
  ].filter(Boolean)
}
