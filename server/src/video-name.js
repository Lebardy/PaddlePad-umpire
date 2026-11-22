// The name a match video is saved under: PaddlePad <day> <side A surnames> vs <side B surnames>.
// Plain letters, digits, spaces and dashes only, so every phone and chat app keeps it as it is.

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })

const plain = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 -]/g, '')
const PARTICLES = new Set(['de', 'del', 'dela', 'delos', 'san', 'sta', 'santa'])
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])
// The last word, with the particles before it ("de los Santos") and without a trailing Jr, III and the like.
export function surname(name) {
  const words = plain(name).trim().split(/\s+/)
  while (words.length > 1 && SUFFIXES.has(words.at(-1).toLowerCase())) words.pop()
  let from = words.length - 1
  for (;;) {
    const before = words[from - 1]?.toLowerCase()
    if (from >= 2 && ['la', 'los'].includes(before) && words[from - 2].toLowerCase() === 'de') from -= 2
    else if (from >= 1 && PARTICLES.has(before)) from -= 1
    else break
  }
  return words.slice(from).join(' ')
}
const side = (names) => names.map((n) => surname(n ?? '')).filter(Boolean).join('-')

export function videoFileName({ startedAt, sideA, sideB }) {
  return `PaddlePad ${DAY.format(new Date(startedAt))} ${side(sideA)} vs ${side(sideB)}`
}
