#!/usr/bin/env node
// ============================================================
// Open play and visit ratings: every rule, with no database.
//
//   node server/scripts/check-visits.mjs
// ============================================================

import {
  manilaHour, manilaDayStart, weekEnd, readOpenPlay, readRating, ratingOpen,
  joinRefusal, openPlayRow, visitSummary, guestsTotals, openPlayWhen,
} from '../src/visit-rules.js'

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

// Thursday 15 October 2026, 7:30 am in Manila.
const now = new Date('2026-10-15T07:30:00+08:00')

console.log('\nManila time')
check('the hour of the day', manilaHour(now), 7)
check('midnight today', manilaDayStart(now).toISOString(), '2026-10-14T16:00:00.000Z')
check('this week ends at midnight after the seventh day', weekEnd(now).toISOString(), '2026-10-21T16:00:00.000Z')

console.log('\nan open play from the admin form')
const base = { startsAt: '2026-10-17T06:00:00+08:00', endsAt: '2026-10-17T09:00:00+08:00', courts: 2, spots: 16, fee: '150', umpire: true, note: ' Beginners welcome ' }
const op = (change) => readOpenPlay({ ...base, ...change }, now)
check('a good one', op({}), { values: { startsAt: '2026-10-16T22:00:00.000Z', endsAt: '2026-10-17T01:00:00.000Z', courts: 2, spots: 16, feeCentavos: 15000, umpire: true, note: 'Beginners welcome' } })
check('a start that is not a time', op({ startsAt: 'nonsense' }), { error: 'Pick a day and a start hour' })
check('a start off the hour', op({ startsAt: '2026-10-17T06:30:00+08:00' }), { error: 'Pick a day and a start hour' })
check('no end', op({ endsAt: undefined }), { error: 'Pick an end hour' })
check('a start already past', op({ startsAt: '2026-10-15T07:00:00+08:00', endsAt: '2026-10-15T09:00:00+08:00' }), { error: 'That time has passed' })
check('the eighth day is out', op({ startsAt: '2026-10-22T06:00:00+08:00', endsAt: '2026-10-22T09:00:00+08:00' }), { error: 'Pick a day in the next 7 days' })
check('the seventh day is in', Boolean(op({ startsAt: '2026-10-21T18:00:00+08:00', endsAt: '2026-10-21T20:00:00+08:00' }).values), true)
check('before 6 am', op({ startsAt: '2026-10-17T05:00:00+08:00' }), { error: 'Start at 6 am or later' })
check('an end at the start', op({ endsAt: '2026-10-17T06:00:00+08:00' }), { error: 'End after it starts' })
check('nine hours', op({ endsAt: '2026-10-17T15:00:00+08:00' }), { error: 'Open play can last up to 8 hours' })
check('past 11 pm', op({ startsAt: '2026-10-17T22:00:00+08:00', endsAt: '2026-10-18T00:00:00+08:00' }), { error: 'End by 11 pm' })
check('ending at 11 pm is fine', Boolean(op({ startsAt: '2026-10-17T22:00:00+08:00', endsAt: '2026-10-17T23:00:00+08:00' }).values), true)
check('no courts', op({ courts: 0 }), { error: 'Courts: 1 to 20' })
check('courts as text', op({ courts: '2' }), { error: 'Courts: 1 to 20' })
check('one spot', op({ spots: 1 }), { error: 'Spots: 2 to 200' })
check('an empty fee is free', op({ fee: '' }).values.feeCentavos, null)
check('a zero fee is free', op({ fee: '0' }).values.feeCentavos, null)
check('a fee with a peso sign and comma', op({ fee: '₱1,500' }).values.feeCentavos, 150000)
check('a fee that is not money', op({ fee: 'abc' }), { error: 'Enter the fee in pesos, or leave it empty for free' })
check('a fee past ₱100,000', op({ fee: '100001' }), { error: 'Enter the fee in pesos, or leave it empty for free' })
check('no umpire answer', op({ umpire: undefined }), { error: 'Say whether an umpire is on duty' })
check('a note of 61 characters', op({ note: 'x'.repeat(61) }), { error: 'Keep the note to 60 characters' })
check('a blank note is none', op({ note: '   ' }).values.note, null)

console.log('\na visit rating')
check('chips de-duplicated, in the usual order', readRating({ score: 5, chips: ['Staff', 'Courts', 'Staff'] }), { values: { score: 5, chips: ['Courts', 'Staff'] } })
check('no chips is fine', readRating({ score: 2 }), { values: { score: 2, chips: [] } })
for (const score of [0, 6, 4.5, '5']) check(`score ${JSON.stringify(score)} refused`, readRating({ score }), { error: 'Pick a face' })
check('a chip not on the list', readRating({ score: 3, chips: ['Parking'] }), { error: 'Pick from Courts, Staff, Waiting, Price and Cleanliness' })
check('chips not a list', readRating({ score: 3, chips: 'Courts' }), { error: 'Pick from Courts, Staff, Waiting, Price and Cleanliness' })

console.log('\nwhen a visit can be rated')
const visit = { facilityId: 'f1', voided: false, lastPlayedAt: '2026-10-09T08:00:00+08:00' }
check('six days after', ratingOpen(visit, now), true)
check('eight days after', ratingOpen({ ...visit, lastPlayedAt: '2026-10-08T07:00:00+08:00' }, now), false)
check('a voided session', ratingOpen({ ...visit, voided: true }, now), false)
check('a session with no place', ratingOpen({ ...visit, facilityId: null }, now), false)
check('never played in it', ratingOpen({ ...visit, lastPlayedAt: null }, now), false)

console.log('\njoining')
const play = { endsAt: '2026-10-17T09:00:00+08:00', spots: 16, count: 12, you: false }
check('a spot left', joinRefusal(play, now), null)
check('full', joinRefusal({ ...play, count: 16 }, now), 'This open play is full')
check('full but already in', joinRefusal({ ...play, count: 16, you: true }, now), null)
check('over', joinRefusal({ ...play, endsAt: '2026-10-15T07:00:00+08:00' }, now), 'This open play is over')
check('under way still takes drop-ins', joinRefusal({ ...play, endsAt: '2026-10-15T09:00:00+08:00' }, now), null)

console.log("\nwho's coming")
const sat = { id: 'op1', facilityId: 'f1', facilityName: 'Boulevard Paddle Courts', startsAt: '2026-10-17T06:00:00+08:00', endsAt: '2026-10-17T09:00:00+08:00', courts: 2, spots: 16, feeCentavos: 15000, umpire: true, note: null }
const LEVEL = { me: 'Developing', paolo: 'Developing', bea: 'Advanced', stranger: 'Developing', newbie: null }
const levelOf = (id) => LEVEL[id] ?? null
const named = new Map([['paolo', 'Paolo Garcia'], ['bea', 'Bea Mendoza']])
const joined = ['me', 'paolo', 'bea', 'stranger', 'newbie', 'paolo']
check('the viewer at a level', openPlayRow(sat, { joined, viewerId: 'me', levelOf, levelsShown: true, named }), {
  id: 'op1', facility: { id: 'f1', name: 'Boulevard Paddle Courts' },
  startsAt: '2026-10-16T22:00:00.000Z', endsAt: '2026-10-17T01:00:00.000Z',
  courts: 2, spots: 16, feeCentavos: 15000, umpire: true, note: null,
  count: 5, atYourLevel: 2, levels: [{ name: 'Advanced', count: 1 }, { name: 'Developing', count: 2 }], newCount: 1,
  names: ['Bea Mendoza', 'Paolo Garcia'], you: true,
})
const noLevels = openPlayRow(sat, { joined, viewerId: 'me', levelOf, levelsShown: false, named })
check('no clear levels: no level words at all', [noLevels.levels, noLevels.newCount, noLevels.atYourLevel], [null, 0, null])
const withExpert = openPlayRow(sat, { joined: ['me', 'ace'], viewerId: 'me', levelOf: (id) => (id === 'ace' ? 'Expert' : levelOf(id)), levelsShown: true, named })
check('your own level is not who is coming', [withExpert.levels, withExpert.newCount], [[{ name: 'Expert', count: 1 }], 0])
check('a viewer with no level', openPlayRow(sat, { joined, viewerId: 'newbie', levelOf, levelsShown: true, named }).atYourLevel, null)
check('nobody yet', openPlayRow(sat, { joined: [], viewerId: 'me', levelOf, levelsShown: true, named }).count, 0)
check('a stranger is never named', openPlayRow(sat, { joined: ['stranger'], viewerId: 'me', levelOf, levelsShown: true, named }).names, [])

console.log('\nhow visits went')
check('four ratings', visitSummary([
  { score: 5, chips: ['Courts', 'Staff'] }, { score: 4, chips: ['Courts'] }, { score: 2, chips: ['Waiting', 'Price'] }, { score: 5, chips: [] },
]), { rated: 4, average: 4, faces: [0, 1, 0, 1, 2], good: { Courts: 2, Staff: 1 }, better: { Waiting: 1, Price: 1 } })
check('two ratings: no score yet', visitSummary([{ score: 5, chips: [] }, { score: 3, chips: [] }]).average, null)
check('one decimal', visitSummary([{ score: 5, chips: [] }, { score: 5, chips: [] }, { score: 4, chips: [] }]).average, 4.7)

console.log('\nthe Guests totals')
check('two open plays', guestsTotals([
  { startsAt: '2026-10-17T06:00:00+08:00', endsAt: '2026-10-17T09:00:00+08:00', spots: 16, joined: ['a', 'b', 'c'] },
  { startsAt: '2026-10-18T06:00:00+08:00', endsAt: '2026-10-18T10:00:00+08:00', spots: 24, joined: ['b', 'd'] },
]), { coming: 4, openPlays: 2, taken: 5, spots: 40, next: { startsAt: '2026-10-16T22:00:00.000Z', endsAt: '2026-10-17T01:00:00.000Z', count: 3, spots: 16 } })
check('none', guestsTotals([]), { coming: 0, openPlays: 0, taken: 0, spots: 0, next: null })

console.log('\nan open play in the activity record')
check('a morning', openPlayWhen(base.startsAt, base.endsAt), 'Sat, Oct 17 · 6–9 AM')
check('across noon', openPlayWhen('2026-10-17T10:00:00+08:00', '2026-10-17T14:00:00+08:00'), 'Sat, Oct 17 · 10 AM–2 PM')
check('an evening to 11 pm', openPlayWhen('2026-10-21T18:00:00+08:00', '2026-10-21T23:00:00+08:00'), 'Wed, Oct 21 · 6–11 PM')

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
