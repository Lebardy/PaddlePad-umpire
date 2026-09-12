#!/usr/bin/env node
// ============================================================
// The proof behind a playstyle name, checked by hand.
//
//   node server/scripts/check-playstyle.mjs
//
// buildPlaystyleProof is pure -- rated rows in, three columns out -- so
// the arithmetic and, more importantly, the privacy rules can be proven
// here with no database and no network. Every expected average below was
// worked out from the numbers beside it before the code ran.
// ============================================================

import { buildPlaystyleProof, MIN_STYLE_MEMBERS } from '../src/playstyle.js'

let pass = 0
let fail = 0

function check(label, actual, expected, why) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) pass += 1
  else fail += 1
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label}` +
    (ok ? '' : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`) +
    `\n       ${why}`,
  )
}

function section(title) {
  console.log(`\n${title}`)
}

const TRAITS = [
  { label: 'Streaky', feature: 'winner_rate_std', family: 'consistency', direction: 'above', z: 0.8 },
  { label: 'Dinker', feature: 'net_game_preference_rate_mean', family: 'identity', direction: 'above', z: 0.7 },
]

/** A rated row: which style, and the two features we compare on. */
const peer = (cluster, swing, net, archetype = null) => ({
  playstyle_cluster: cluster,
  playstyle_archetype: archetype,
  evidence: { winner_rate_std: swing, net_game_preference_rate_mean: net },
})

// ============================================================
section('the three columns')
// ============================================================
{
  // Style 0 (this player's, three members): swings 1.0, 1.2, 1.4 and
  // net 0.60, 0.62, 0.64. Style 1 (three members): swings 4.0, 4.4, 4.8
  // and net 0.30, 0.31, 0.32.
  //   you            1.2            0.62
  //   group  (1.0+1.2+1.4+4.0+4.4+4.8)/6 = 2.8
  //          (0.60+0.62+0.64+0.30+0.31+0.32)/6 = 0.465
  //   other          (4.0+4.4+4.8)/3 = 4.4
  //                  (0.30+0.31+0.32)/3 = 0.31
  const peers = [
    peer(0, 1.0, 0.6, 'Intermediate Steady Dinker'),
    peer(0, 1.2, 0.62, 'Intermediate Steady Dinker'),
    peer(0, 1.4, 0.64, 'Intermediate Steady Dinker'),
    peer(1, 4.0, 0.3, 'Intermediate Streaky Driver'),
    peer(1, 4.4, 0.31, 'Intermediate Streaky Driver'),
    peer(1, 4.8, 0.32, 'Intermediate Streaky Driver'),
  ]
  const proof = buildPlaystyleProof({
    traits: TRAITS,
    mine: { playstyle_cluster: 0, evidence: { winner_rate_std: 1.2, net_game_preference_rate_mean: 0.62 } },
    peers,
  })

  check('this player, their group, and the style they were split from',
    proof.rows,
    [
      { label: 'Streaky', feature: 'winner_rate_std', family: 'consistency', direction: 'above', you: 1.2, group: 2.8, other: 4.4 },
      { label: 'Dinker', feature: 'net_game_preference_rate_mean', family: 'identity', direction: 'above', you: 0.62, group: 0.465, other: 0.31 },
    ],
    'the group column averages everyone in the group including this player; the other column averages only the other style')
  check('how many share this style, and which style the other is',
    [proof.styleSize, proof.other],
    [3, { archetype: 'Intermediate Streaky Driver', size: 3 }],
    'a count and a style name, never who is in it')
}

// ============================================================
section('a style too small to average is never shown')
// ============================================================
{
  const peers = [
    peer(0, 1.0, 0.6),
    peer(0, 1.2, 0.62),
    peer(0, 1.4, 0.64),
    // Two members: an average of two is nearly an average of one.
    peer(1, 4.0, 0.3, 'Intermediate Streaky Driver'),
    peer(1, 4.4, 0.31, 'Intermediate Streaky Driver'),
  ]
  const proof = buildPlaystyleProof({
    traits: TRAITS,
    mine: { playstyle_cluster: 0, evidence: { winner_rate_std: 1.2, net_game_preference_rate_mean: 0.62 } },
    peers,
  })
  check('no other column, and no mention of that style',
    [proof.other, proof.rows.map((r) => r.other)],
    [null, [null, null]],
    `under ${MIN_STYLE_MEMBERS} members an average describes individuals, so it is withheld — the group column still stands`)
  check('the group average still counts them',
    proof.rows[0].group, 2.4,
    '(1.0 + 1.2 + 1.4 + 4.0 + 4.4) / 5 = 2.4 — they are counted, just never named')
}

// ============================================================
section('the largest other style is the one shown')
// ============================================================
{
  const peers = [
    peer(0, 1.0, 0.6), peer(0, 1.2, 0.62), peer(0, 1.4, 0.64),
    peer(1, 4.0, 0.3, 'Streaky Driver'), peer(1, 4.0, 0.3, 'Streaky Driver'), peer(1, 4.0, 0.3, 'Streaky Driver'),
    peer(2, 9.0, 0.1, 'Wild Driver'), peer(2, 9.0, 0.1, 'Wild Driver'), peer(2, 9.0, 0.1, 'Wild Driver'), peer(2, 9.0, 0.1, 'Wild Driver'),
  ]
  const proof = buildPlaystyleProof({
    traits: TRAITS,
    mine: { playstyle_cluster: 0, evidence: { winner_rate_std: 1.2, net_game_preference_rate_mean: 0.62 } },
    peers,
  })
  check('the biggest one, named', proof.other, { archetype: 'Wild Driver', size: 4 },
    'with more than one other style, the largest is the fairest single comparison')
}

// ============================================================
section('nothing to prove')
// ============================================================
{
  const mine = { playstyle_cluster: 0, evidence: { winner_rate_std: 1.2 } }
  check('no traits at all -> nothing',
    buildPlaystyleProof({ traits: [], mine, peers: [peer(0, 1.2, 0.6)] }), null,
    'a run published before the pipeline recorded them; the page says so rather than inventing a reason')
  check('a trait with no measurement behind it is left out',
    buildPlaystyleProof({
      traits: [{ label: 'All-Court Player', feature: null, family: 'identity', direction: 'above', z: 0 }],
      mine,
      peers: [peer(0, 1.2, 0.6)],
    }),
    null,
    'the generic noun is what the pipeline picks when nothing stood out, so there is nothing to show columns for')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
