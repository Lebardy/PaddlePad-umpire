#!/usr/bin/env node
// The People list merged with the rivals reply.
//
//   node player/scripts/check-people-tags.mjs

const { mergeRivals } = await import('../src/lib/peopleTags.js')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`)
}

const people = ['Ana', 'Ben', 'Cy', 'Di', 'Ed'].map((name) => ({ name }))
const reply = {
  rivals: [
    { kind: 'matches', name: 'Cy', won: 2, lost: 2 },
    { kind: 'rating', name: 'Ed' },
    { kind: 'rating', name: 'Stranger' },
  ],
  nearRating: 2,
  partners: [{ name: 'Ben', wins: 3 }, { name: 'Gone', wins: 1 }],
}
const merged = mergeRivals(people, reply)
check('pinned order: rivals then partners, strangers kept', merged.pinned.map((e) => e.name), ['Cy', 'Ed', 'Stranger', 'Ben'])
check('tag texts', merged.pinned.map((e) => e.tag.text), ['Rival 2–2', 'Near your rating', 'Near your rating', 'Partner 3 wins'])
check('stranger has no person', merged.pinned[2].person, null)
check('rest keeps list order, no repeats', merged.rest.map((p) => p.name), ['Ana', 'Di'])
check('partner not in the list is dropped', merged.pinned.some((e) => e.name === 'Gone'), false)
check('near rating count passes through', merged.nearRating, 2)
check('no reply, no pins', mergeRivals(people, null).rest.length, 5)
const twice = mergeRivals(people, { rivals: [{ kind: 'matches', name: 'Cy', won: 1, lost: 0 }, { kind: 'rating', name: 'Cy' }], partners: [{ name: 'Cy', wins: 2 }] })
check('a name is pinned once, with its first tag', twice.pinned.map((e) => e.tag.text), ['Rival 1–0'])
check('a pinned name is not in the rest', twice.rest.map((p) => p.name), ['Ana', 'Ben', 'Di', 'Ed'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
