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

import { buildPlaystyleProof, buildCorners, takeaway, standout, nextLevelStyle, MIN_STYLE_MEMBERS } from '../src/playstyle.js'

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
      { label: 'Streaky', feature: 'winner_rate_std', family: 'consistency', direction: 'above', neutral: false, you: 1.2, group: 2.8, other: 4.4, style: 1.2, center: null },
      { label: 'Dinker', feature: 'net_game_preference_rate_mean', family: 'identity', direction: 'above', neutral: false, you: 0.62, group: 0.465, other: 0.31, style: 0.62 },
    ],
    'the group column averages everyone in the group including this player; the other column averages only the other style; the style column averages this player\'s style, (1.0+1.2+1.4)/3 = 1.2 and (0.60+0.62+0.64)/3 = 0.62')
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
  // (0.50 + 0.52 + 0.54) / 3 = 0.52
  check('an all-court row also carries the style average the name describes',
    net?.style, 0.52,
    'the noun is chosen from the style, not the one player: on staging 8 of 17 all-court players\' own net share disagreed with "does not stand out", their style\'s never did')
  const drop = proof?.rows.find((r) => r.feature === 'drop_preference_rate_mean')
  check('a habit with nothing recorded is empty, not zero',
    drop && [drop.you, drop.style, drop.group, drop.other], [null, null, null, null],
    'no third shots logged is not the same as never dropping')

  // The pipeline stores a player with no third shots as 0, not missing.
  // A whole group of zeros is that, not a group that never drops.
  const zeroed = peers.map((p) => ({ ...p, evidence: { ...p.evidence, drop_preference_rate_mean: 0 } }))
  const zeroDrop = buildPlaystyleProof({
    traits: [{ label: 'All-Court Player', feature: null, family: 'identity', direction: 'above', z: 0 }],
    mine: { playstyle_cluster: 0, evidence: zeroed[1].evidence },
    peers: zeroed,
  })?.rows.find((r) => r.feature === 'drop_preference_rate_mean')
  check('a group where every value is zero counts as nothing recorded',
    zeroDrop && [zeroDrop.you, zeroDrop.style, zeroDrop.group, zeroDrop.other], [null, null, null, null],
    'on staging every group\'s drop preference is 0 because no third shots were logged; 0% bars would claim nobody drops')

  const tinyStyle = buildPlaystyleProof({
    traits: [{ label: 'All-Court Player', feature: null, family: 'identity', direction: 'above', z: 0 }],
    mine: { playstyle_cluster: 0, evidence: peers[1].evidence },
    peers: [peer(0, 1.2, 0.52), peer(0, 1.0, 0.5), peer(1, 4.0, 0.4), peer(1, 4.4, 0.42), peer(1, 4.8, 0.44)],
  })?.rows.find((r) => r.feature === 'net_game_preference_rate_mean')
  check('a style of fewer than three is never averaged',
    tinyStyle?.style, null,
    `under ${MIN_STYLE_MEMBERS} members a style average describes the other person in it`)

  check('the all-court noun alone still proves something',
    buildPlaystyleProof({
      traits: [{ label: 'All-Court Player', feature: null, family: 'identity', direction: 'above', z: 0 }],
      mine,
      peers,
    })?.rows.length,
    2,
    'a name that is only the noun used to show nothing at all')
}

console.log('\nswing rows carry the averages they move around')
{
  const evidenceOf = (mean, std) => ({ winner_rate_mean: mean, winner_rate_std: std })
  const peers = [
    { playstyle_cluster: 0, playstyle_archetype: 'Steady Dinker', evidence: evidenceOf(0.48, 0.06) },
    { playstyle_cluster: 0, playstyle_archetype: 'Steady Dinker', evidence: evidenceOf(0.42, 0.08) },
    { playstyle_cluster: 0, playstyle_archetype: 'Steady Dinker', evidence: evidenceOf(0.45, 0.07) },
    { playstyle_cluster: 1, playstyle_archetype: 'Streaky Dinker', evidence: evidenceOf(0.40, 0.12) },
  ]
  const traits = [{ label: 'Steady', feature: 'winner_rate_std', direction: 'below' }]
  const row = buildPlaystyleProof({ traits, mine: peers[0], peers }).rows[0]
  check('the player\'s own average sits beside their swing', row.center?.you, 0.48)
  check('the style\'s average is the members\' average', row.center?.style, 0.45)
  check('the group\'s average is everyone\'s', row.center?.group, 0.4375)
  const old = buildPlaystyleProof({
    traits,
    mine: { playstyle_cluster: 0, evidence: { winner_rate_std: 0.06 } },
    peers: peers.map((p) => ({ ...p, evidence: { winner_rate_std: p.evidence.winner_rate_std } })),
  })
  check('a run from before the averages has no center', old.rows[0].center, null)
  const gap = buildPlaystyleProof({
    traits,
    mine: peers[0],
    peers: [...peers.slice(0, 3), { ...peers[3], evidence: evidenceOf(null, 0.12) }],
  }).rows[0]
  check('a peer with a null average is left out of the group\'s average', gap.center?.group, 0.45,
    'Number(null) is 0, which would drag the average down')
  const noOwn = buildPlaystyleProof({ traits, mine: { ...peers[0], evidence: evidenceOf(null, 0.06) }, peers }).rows[0]
  check('a null own average gives no center', noOwn.center, null)
  const thin = buildPlaystyleProof({
    traits,
    mine: peers[0],
    peers: [peers[0], peers[1], { ...peers[2], evidence: evidenceOf(null, 0.07) }, peers[3]],
  }).rows[0]
  check('a style of three with one null average gives no style average', thin.center?.style, null,
    'two centres would be averaged, and a two-person average stays hidden')
  const pair = buildPlaystyleProof({ traits, mine: peers[0], peers: [peers[0], peers[1], peers[3]] }).rows[0]
  check('a style of two gives no style average', pair.center?.style, null)
  check('but the group average is still there', pair.center?.group != null, true)
}

// ============================================================
section('fingerprint corners')
// ============================================================
// Six players; values chosen so the averages are round.
//   drop preference .2 .4 .6 .8 .5 .5 -> mean .5, squared gaps .09 .01 .01 .09 0 0 -> /6 = .0333, sd .1826
//   drop efficiency .3 .4 .5 .6 .7 .5  -> mean .5, squared gaps .04 .01 0 .01 .04 0 -> /6 = .01667, sd .1291
const ev = (o) => ({ evidence: { error_to_winner_ratio: 1, drop_efficiency_mean: 0.5, drop_preference_rate_mean: 0.5,
  net_game_preference_rate_mean: 0.5, aggression_std: 0.2, winner_rate_std: 0.1, drop_efficiency_std: 0.3, ...o } })
const everyone = [[0.2, 0.3], [0.4, 0.4], [0.6, 0.5], [0.8, 0.6], [0.5, 0.7], [0.5, 0.5]]
  .map(([d, e]) => ev({ drop_preference_rate_mean: d, drop_efficiency_mean: e }))
const driverTraits = [
  { label: 'Clean', feature: 'error_to_winner_ratio', family: 'precision', direction: 'below', z: -0.4 },
  { label: 'Inconsistent', feature: 'drop_efficiency_std', family: 'consistency', direction: 'above', z: 0.5 },
  { label: 'Driver', feature: 'drop_preference_rate_mean', family: 'identity', direction: 'below', z: -0.6 },
]
const corners = buildCorners({ traits: driverTraits, mine: everyone[0], compare: everyone, sameStyle: everyone.slice(0, 3) })
check('six corners in the fixed order, name words flipped in',
  corners.map((c) => c.word), ['Clean', 'Precise', 'Driver', 'Net Player', 'Steady', 'Inconsistent'],
  'Driver replaces Dropper; Inconsistent (drop_efficiency_std) takes the sixth corner from Consistent')
check('a name word points its corner its own way', corners.map((c) => c.out),
  ['lower', 'higher', 'lower', 'higher', 'lower', 'higher'], 'further out = more of the word shown')
check('only the name words are boxed', corners.map((c) => c.inName), [true, false, true, false, false, true], '')
check('average and spread are everyone\'s', [corners[2].mean, corners[2].spread], [0.5, 0.1826],
  'mean of .2 .4 .6 .8 .5 .5 = .5; population sd = .1826')
check('the style average is the style\'s own', corners[2].style, 0.4, '(.2+.4+.6)/3 = .4')
check('the style average needs three players', buildCorners({ traits: driverTraits, mine: everyone[0], compare: everyone,
  sameStyle: everyone.slice(0, 2) }).every((c) => c.style === null), true, 'two players would give each other away')
check('All-Court boxes neither identity corner', buildCorners({ traits: [{ label: 'All-Court Player', family: 'identity' }],
  mine: everyone[0], compare: everyone, sameStyle: everyone }).map((c) => c.word),
  ['Clean', 'Precise', 'Dropper', 'Net Player', 'Steady', 'Consistent'], 'no feature, so the default words stay')

section('takeaway')
check('one sentence from the name words, in name order', takeaway(driverTraits),
  'Your style makes fewer mistakes, has drops that come and go and drives more than it drops.', '')
check('all-court gets its own phrase', takeaway([{ label: 'Steady', feature: 'aggression_std', direction: 'below' },
  { label: 'All-Court Player', family: 'identity' }]),
  'Your style finishes points the same way every match and plays every part of the court.', '')

section('standout')
const withYou = (you) => corners.map((c, i) => ({ ...c, you: i === 1 ? you : c.you }))
check('a corner not in the name, half a spread out or more', standout(withYou(0.7)), 'drops that land',
  'Precise is not in the name; (.7 - .5) / .1291 = 1.55 spreads out, 0.5 needed')
check('close to the average -> null', standout(withYou(0.52)), null, '(.52 - .5) / .1291 = .15, under half a spread')
check('nothing outside the name -> null', standout(corners.map((c) => ({ ...c, inName: true }))), null, '')

section('next level up')
const lv = [{ name: 'Developing', groups: ['A'] }, { name: 'Advanced', groups: ['B'] }]
const pl = (g, s) => ({ skill_group: g, playstyle_archetype: s })
const run = [pl('A', 'X'), pl('B', 'Y'), pl('B', 'Y'), pl('B', 'Z'), pl('B', 'Y')]
check('most common style one level up', nextLevelStyle({ peers: run, group: 'A', levels: lv }), { style: 'Y' }, 'Y 3, Z 1')
check('top level -> null', nextLevelStyle({ peers: run, group: 'B', levels: lv }), null, '')
check('fewer than three there -> null', nextLevelStyle({ peers: run.slice(0, 3), group: 'A', levels: lv }), null, '')
check('no levels -> null', nextLevelStyle({ peers: run, group: 'A', levels: [] }), null, '')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
