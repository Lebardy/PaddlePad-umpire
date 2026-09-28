// ============================================================
// The People tab's title line and its name search.
//
//   node player/scripts/check-people-words.mjs
// ============================================================

/** "21 people · 15 partnered · beaten 10 of 18 faced". */
export function peopleLine({ people, partners, faced, beaten }) {
  return [
    `${people} ${people === 1 ? 'person' : 'people'}`,
    partners > 0 ? `${partners} partnered` : null,
    faced > 0 ? `beaten ${beaten} of ${faced} faced` : null,
  ].filter(Boolean).join(' · ')
}

// Accents off, so "nino" finds Niño: nobody types the tilde into a search.
const plain = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Everyone whose name contains the search, in list order. */
export function findPeople(people, query) {
  const q = plain(query.trim())
  if (!q) return people
  return people.filter((person) => plain(person.name).includes(q))
}
