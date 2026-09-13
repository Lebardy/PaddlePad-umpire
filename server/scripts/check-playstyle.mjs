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
      { label: 'Streaky', feature: 'winner_rate_std', family: 'consistency', direction: 'above', neutral: false, you: 1.2, group: 2.8, other: 4.4 },
      { label: 'Dinker', feature: 'net_game_preference_rate_mean', family: 'identity', direction: 'above', neutral: false, you: 0.62, group: 0.465, other: 0.31 },
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
}

// ============================================================
section('the all-court noun is proven by both habits')
// ============================================================
{
  // The pipeline falls back to "All-Court Player" when neither
  // shot-selection habit stands out from the group. That is still a
  // claim about two measurements, so both are shown. This player's
  // style: net 0.50, 0.52, 0.54 (you 0.52). The other: 0.40, 0.42, 0.44.
  //   group (0.50+0.52+0.54+0.40+0.42+0.44)/6 = 0.47   other 0.42
  // Nobody here has a drop preference recorded, so that row is empty
  // rather than zero.
  const peers = [
    peer(0, 1.0, 0.5), peer(0, 1.2, 0.52), peer(0, 1.4, 0.54),
    peer(1, 4.0, 0.4), peer(1, 4.4, 0.42), peer(1, 4.8, 0.44),
  ]
  const mine = { playstyle_cluster: 0, evidence: peers[1].evidence }
  const proof = buildPlaystyleProof({
    traits: [
      { label: 'Steady', feature: 'winner_rate_std', family: 'consistency', direction: 'below', z: -0.9 },
      { label: 'All-Court Player', feature: null, family: 'identity', direction: 'above', z: 0 },
    ],
    mine,
    peers,
  })
  check('the adjective keeps its own row, then one row per habit',
    proof?.rows.map((r) => [r.label, r.feature, r.neutral]),
    [
      ['Steady', 'winner_rate_std', false],
      ['All-Court Player', 'drop_preference_rate_mean', true],
      ['All-Court Player', 'net_game_preference_rate_mean', true],
    ],
    'the noun was chosen BECAUSE neither habit stood out, so both habits are its proof')
  const net = proof?.rows.find((r) => r.feature === 'net_game_preference_rate_mean')
  check('the net habit row carries the same three columns as any other',
    net && [net.you, net.group, net.other], [0.52, 0.47, 0.42],
    'you, your group, and the style you were split from')
  const drop = proof?.rows.find((r) => r.feature === 'drop_preference_rate_mean')
  check('a habit with nothing recorded is empty, not zero',
    drop && [drop.you, drop.group, drop.other], [null, null, null],
    'no third shots logged is not the same as never dropping')

  check('the all-court noun alone still proves something',
    buildPlaystyleProof({
      traits: [{ label: 'All-Court Player', feature: null, family: 'identity', direction: 'above', z: 0 }],
      mine,
      peers,
    })?.rows.length,
    2,
    'a name that is only the noun used to show nothing at all')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
