/**
 * People and the rivals reply, merged: who is pinned (in the server's
 * order: rivals, then partners), who is left, and the rival names that
 * are not in the list at all (a stranger who turned the name switch on).
 * A rival or partner missing from the list is dropped: every tag belongs
 * to someone you have played, except 'rating' ones.
 */
export function mergeRivals(people, reply) {
  const byName = new Map(people.map((person) => [person.name, person]))
  const pinned = []
  const seen = new Set()
  const add = (name, tag) => {
    if (seen.has(name)) return
    seen.add(name)
    const person = byName.get(name)
    if (person) pinned.push({ name, person, tag })
    else if (tag.icon === 'equals') pinned.push({ name, person: null, tag })
  }
  for (const rival of reply?.rivals ?? []) {
    add(rival.name, rival.kind === 'matches'
      ? { icon: 'target', text: `Rival ${rival.won}–${rival.lost}` }
      : { icon: 'equals', text: 'Near your rating' })
  }
  for (const partner of reply?.partners ?? []) {
    add(partner.name, { icon: 'swap', text: `Partner ${partner.wins} wins` })
  }
  return {
    pinned,
    rest: people.filter((person) => !seen.has(person.name)),
    nearRating: reply?.nearRating ?? 0,
  }
}
