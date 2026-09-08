#!/usr/bin/env node
// ============================================================
// Who is serving, checked against the rule rather than the code.
//
//   node server/scripts/check-serving.mjs
//
// The engine used to hand the serve to `team[0]` at every side-out --
// the first player an umpire happened to tap in, which has nothing to
// do with where anyone is standing. On court the player on the RIGHT
// serves when a team gains the serve, and a pair swaps sides only when
// their own team scores, so the right-side player is decided by that
// team's score being even or odd.
//
// This walks whole games and names the expected server at every step,
// with the reason. It needs no database, no API and no credentials --
// deriveMatchState is pure -- so it is the part of that fix that can be
// proven before anything is deployed anywhere.
// ============================================================

import { deriveMatchState, currentServerPlayerId } from '../src/pickleball.js'

let pass = 0
let fail = 0

function section(title) {
  console.log(`\n${title}`)
}

/**
 * Plays `steps` through a match, checking who is serving after each.
 *
 * A step is `{ won, expect, why }`, or `{ correct, expect, why }` to
 * log an umpire's server correction instead of a rally.
 */
function walk(match, steps) {
  let seq = 0
  for (const step of steps) {
    if (step.correct) {
      match.events.push({
        id: `e${seq}`, seq: seq++, type: 'serverCorrection',
        at: Date.now(), playerId: step.correct,
      })
    } else {
      // The engine works out the rally winner from the acting player's
      // team and the outcome, so a winner by anyone on the winning team
      // says "this team won the rally".
      const actor = step.won === 'A' ? match.teamA[0] : match.teamB[0]
      match.events.push({
        id: `e${seq}`, seq: seq++, type: 'rally', at: Date.now(),
        actingPlayerId: actor, outcome: 'winner', zone: 'open',
      })
    }

    const derived = deriveMatchState(match)
    const server = currentServerPlayerId(derived, match)
    const ok = server === step.expect
    if (ok) pass += 1
    else fail += 1

    const what = step.correct ? `correct to ${step.correct}` : `rally to ${step.won}`
    console.log(
      `  ${ok ? 'ok  ' : 'FAIL'} ${what.padEnd(18)} ${derived.score.A}-${derived.score.B}` +
      `  serving ${String(server).padEnd(5)} (#${derived.serverNumber})` +
      `${ok ? '' : `  EXPECTED ${step.expect}`}\n       ${step.why}`,
    )
  }
}

// ============================================================
section('a doubles game, with nothing conveniently at index 0')
// ============================================================
// The first server is SECOND in team A's list and team B's right-side
// starter is second in theirs, so anything still assuming index 0 fails
// here rather than passing by luck.
walk(
  {
    teamA: ['Ana', 'Ben'],
    teamB: ['Cy', 'Dee'],
    firstServer: { team: 'A', playerId: 'Ben' },
    rightStart: { A: 'Ben', B: 'Dee' },
    pointTarget: 11,
    events: [],
  },
  [
    { won: 'A', expect: 'Ben', why: 'A scores, so Ben keeps serving — from the left now' },
    { won: 'B', expect: 'Dee', why: "the game's first service turn has one server, so this is a side out; B's score is 0, even, and Dee started on the right" },
    { won: 'B', expect: 'Dee', why: 'B scores and Dee serves on' },
    { won: 'A', expect: 'Cy', why: 'server 1 faulted, so the partner serves — not "the second player listed"' },
    { won: 'B', expect: 'Cy', why: 'B scores and Cy serves on' },
    { won: 'A', expect: 'Ana', why: "side out to A; A's score is 1, odd, so the pair has swapped once and Ana is on the right" },
    { won: 'B', expect: 'Ben', why: 'server 1 faulted, so the partner serves' },
    { won: 'B', expect: 'Dee', why: "side out to B; B's score is 2, even, so Dee is back on the right" },
  ],
)

// ============================================================
section('an umpire correcting the server, and it staying corrected')
// ============================================================
walk(
  {
    teamA: ['Ana', 'Ben'],
    teamB: ['Cy', 'Dee'],
    firstServer: { team: 'A', playerId: 'Ana' },
    rightStart: { A: 'Ana', B: 'Cy' },
    pointTarget: 11,
    events: [],
  },
  [
    { won: 'B', expect: 'Cy', why: 'side out to B; setup said Cy started on the right' },
    { correct: 'Dee', expect: 'Dee', why: 'the umpire says it is actually Dee — setup had that pair the wrong way round' },
    { won: 'A', expect: 'Cy', why: 'server 1 faulted, so the partner serves' },
    { won: 'A', expect: 'Ana', why: 'side out to A' },
    { won: 'B', expect: 'Ben', why: "A's server 1 faulted, so A's partner serves — a team gets two servers before it loses serve" },
    { won: 'B', expect: 'Dee', why: 'side out back to B, and THIS is the point: the correction flipped their sides for good, so it does not need making again' },
  ],
)

// ============================================================
section('a match recorded before setup asked (no rightStart)')
// ============================================================
// Nothing recorded depends on the answer -- serverIndex only ever
// reaches the "Serving:" line, which a finished match does not show --
// so the fallback just has to be the best guess available and must not
// throw.
walk(
  {
    teamA: ['Ana', 'Ben'],
    teamB: ['Cy', 'Dee'],
    firstServer: { team: 'A', playerId: 'Ben' },
    pointTarget: 11,
    events: [],
  },
  [
    { won: 'B', expect: 'Cy', why: "B's right-side starter is unknown, so index 0 stands in, exactly as this engine always assumed" },
    { won: 'A', expect: 'Dee', why: "B's server 1 faulted, so B's partner serves" },
    { won: 'A', expect: 'Ben', why: "now the side out; A's right-side starter IS known even without the field — the first server was on the right at 0-0" },
  ],
)

// ============================================================
section('singles, where none of this applies')
// ============================================================
walk(
  {
    teamA: ['Ana'],
    teamB: ['Cy'],
    firstServer: { team: 'A', playerId: 'Ana' },
    pointTarget: 11,
    events: [],
  },
  [
    { won: 'A', expect: 'Ana', why: 'A scores and serves on' },
    { won: 'B', expect: 'Cy', why: 'side out; there is no second server in singles' },
    { won: 'A', expect: 'Ana', why: 'and straight back' },
  ],
)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
