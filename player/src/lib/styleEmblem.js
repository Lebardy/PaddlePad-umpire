// ============================================================
// What to draw for a playstyle name.
//
// A name is one identity with up to two trait words in front of it:
// "Clean Steady Net Player". The pipeline builds it from fixed lists
// (TRAIT_DESCRIPTORS and IDENTITY_DESCRIPTORS in ml/pipeline/
// clustering.py), so the name is read back against the same lists. A
// word that is on neither gets no mark, and a name whose identity is
// not recognised gets no emblem: nothing is drawn from a guess.
// ============================================================

const IDENTITIES = {
  'Net Player': 'net',
  'Power Player': 'power',
  'All-Court Player': 'all',
  Driver: 'driver',
  Dropper: 'dropper',
}

const TRAITS = ['Clean', 'Precise', 'Steady', 'Reliable', 'Consistent', 'Composed', 'Solid-Net', 'Unpredictable', 'Inconsistent', 'Streaky']

/** `{ identity, traits }` for a style name, or null when it has no identity to draw. */
export function emblemFor(name) {
  const noun = Object.keys(IDENTITIES).find((known) => name === known || name?.endsWith(` ${known}`))
  if (!noun) return null
  const words = name.slice(0, -noun.length).split(' ').filter((word) => TRAITS.includes(word))
  return { identity: IDENTITIES[noun], traits: [...new Set(words)].slice(0, 2) }
}
