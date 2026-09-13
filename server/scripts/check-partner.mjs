#!/usr/bin/env node
// ============================================================
// Is there enough repeat-partnership data for "partner fit" yet?
//
//   node server/scripts/check-partner.mjs <match-logs.json>
//   curl ... /export/match-logs.json | node server/scripts/check-partner.mjs
//
// Idea 7 in player/IDEAS.md wants to say "you play better with Gemma
// than with Josh, and fairly -- weighted by who you were both up
// against". Before any of that can be built, one thing has to be true
// of the data: THE SAME TWO PEOPLE HAVE TO PLAY TOGETHER OFTEN. A
// record of one match is 0% or 100% however cleverly it is adjusted.
//
// So this reads an export and asks two questions of it.
//
// 1. DO PARTNERS REPEAT? Counted against what pure chance would
//    produce. Throw N random pairings at a pool this size and a
//    predictable number of them collide; real players, who have
//    regular partners, produce far fewer distinct partnerships than
//    that, while a pool shuffled every round produces exactly that. The
//    gap between observed and expected is the whole signal, and it is
//    why a count of repeats alone would mislead -- fifteen repeats
//    sounds like something until you notice chance alone gives
//    fourteen.
//
// 2. IS ANY PARTNERSHIP BIG ENOUGH TO TALK ABOUT? A win rate over n
//    matches wanders by about +/- 98/sqrt(n) percentage points on luck
//    alone. The table at the end turns that into the only number that
//    matters for the feature: how many matches two people must have
//    played together before a real difference in how they gel is
//    visible through the noise.
//
// This is a readiness report, not a pass/fail test: the honest answer
// on a given pool may well be "not yet", which is not a failure of
// anything. Reads a file or stdin and talks to nothing.
// ============================================================

import { readFileSync } from 'node:fs'

const source = process.argv[2] ?? 0 // 0 is stdin
let parsed
try {
  parsed = JSON.parse(readFileSync(source, 'utf8'))
} catch (error) {
  console.error(`Could not read an export from ${source === 0 ? 'stdin' : source}: ${error.message}`)
  console.error('Expects the JSON from GET /export/match-logs.json (an object with `rows`).')
  process.exit(1)
}

const rows = Array.isArray(parsed) ? parsed : parsed.rows
if (!Array.isArray(rows) || rows.length === 0) {
  console.error('That export has no rows in it.')
  process.exit(1)
}

// One export row per SEAT, so four rows make one doubles match.
const seatsByMatch = new Map()
for (const row of rows) {
  if (!seatsByMatch.has(row.match_id)) seatsByMatch.set(row.match_id, [])
  seatsByMatch.get(row.match_id).push(row)
}
const everyMatch = [...seatsByMatch.values()]
const doubles = everyMatch.filter((seats) => seats.length === 4)
const players = new Set(rows.map((row) => row.player_id))

const partnershipOf = (row) => [row.player_id, row.partner_id].sort().join('|')

// Each doubles match holds two partnerships. Singles hold none, and are
// left out of every count here rather than being folded in -- a number
// mixing the two would answer no question anybody asked.
const partnerships = new Map()
for (const seats of doubles) {
  for (const seat of seats) {
    if (!seat.partner_id) continue
    const key = partnershipOf(seat)
    if (!partnerships.has(key)) partnerships.set(key, { played: 0, won: 0 })
    const record = partnerships.get(key)
    // Both seats of a side name the same partnership, so count the
    // side once: the first seat reached wins the toss.
    if (record.seen === seat.match_id) continue
    record.seen = seat.match_id
    record.played += 1
    if (Number(seat.won) === 1) record.won += 1
  }
}

console.log(`\n${everyMatch.length} completed matches: ${doubles.length} doubles, ` +
  `${everyMatch.length - doubles.length} singles, ${players.size} players`)

// ============================================================
console.log('\nDo the same people play together again?')
// ============================================================
const pairings = doubles.length * 2
const distinct = partnerships.size
const possible = (players.size * (players.size - 1)) / 2
// The birthday problem: how many distinct pairs survive when `pairings`
// draws are thrown at random into `possible` slots.
const expectedDistinct = possible * (1 - (1 - 1 / possible) ** pairings)

console.log(`  ${pairings} partnerships were played, and ${distinct} of them were different people`)
console.log(`  drawing partners out of a hat would have given about ${expectedDistinct.toFixed(0)} different`)
const repeats = pairings - distinct
const byChance = pairings - expectedDistinct
if (repeats <= byChance * 1.2) {
  console.log(`  => partners here repeat no more than chance (${repeats} repeats, chance gives ${byChance.toFixed(0)})`)
  console.log('     Nobody has a regular partner in this pool, so it cannot answer idea 7')
  console.log('     at all -- the question needs real players choosing who they play with.')
} else {
  console.log(`  => partners repeat ${(repeats / byChance).toFixed(1)}x more than chance would give`)
  console.log('     People here do have regular partners, so the question is worth asking.')
}

// ============================================================
console.log('\nIs any partnership big enough to say anything about?')
// ============================================================
const sizes = [...partnerships.values()].map((record) => record.played).sort((a, b) => b - a)
const atLeast = (n) => sizes.filter((size) => size >= n).length
for (const n of [2, 3, 5, 8, 12, 16]) {
  console.log(`  played together ${String(n).padStart(2)}+ times: ${atLeast(n)} partnerships`)
}
console.log(`  the biggest: ${sizes.slice(0, 8).join(', ') || 'none'}`)

// How many people would actually see the feature, which is the number
// that decides whether it is worth a screen.
const bestPartnerFor = new Map()
for (const [key, record] of partnerships) {
  for (const id of key.split('|')) {
    bestPartnerFor.set(id, Math.max(bestPartnerFor.get(id) ?? 0, record.played))
  }
}
const reach = (n) => [...bestPartnerFor.values()].filter((best) => best >= n).length
console.log(`  of ${bestPartnerFor.size} people who played doubles, ${reach(8)} have a partner` +
  ` they have played 8+ with, ${reach(16)} have one at 16+`)

// ============================================================
console.log('\nHow many matches together it would take')
// ============================================================
// A win rate is a coin with n flips: its standard error is 0.5/sqrt(n),
// and two rates have to differ by about two of those before the
// difference is anything but luck.
console.log('  how far a partner win rate wanders on luck alone, 19 times in 20:')
for (const n of [2, 4, 8, 16, 40]) {
  console.log(`    ${String(n).padStart(2)} together: +/- ${(100 * 1.96 * 0.5 / Math.sqrt(n)).toFixed(0)} points`)
}
console.log('  so, to see a real difference in how well two people gel:')
for (const difference of [0.1, 0.2, 0.3]) {
  console.log(`    a ${(100 * difference).toFixed(0)}-point difference needs about ` +
    `${Math.ceil((1.96 * 0.5 / difference) ** 2)} matches together`)
}

// Per-point material, which is the way out of that table: one match is
// one win or loss, but roughly thirty rally-ending shots.
let shots = 0
for (const seats of doubles) {
  for (const seat of seats) {
    shots += seat.clean_winners + seat.dink_winners + seat.unforced_errors + seat.dink_errors
  }
}
if (doubles.length > 0) {
  console.log(`\n  One match is a single win or loss -- but ${(shots / doubles.length).toFixed(0)} recorded shots.`)
  console.log('  A fit measured on HOW the pair played reaches usefulness far sooner')
  console.log('  than one measured on who won, and that is the shape idea 7 needs.')
}
console.log()
