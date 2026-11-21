// The name a match video is saved under: PaddlePad <day> <side A surnames> vs <side B surnames>.
// Plain letters, digits, spaces and dashes only, so every phone and chat app keeps it as it is.

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' })

const plain = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 -]/g, '')
const surname = (name) => plain(name).trim().split(/\s+/).pop()
const side = (names) => names.map((n) => surname(n ?? '')).filter(Boolean).join('-')

export function videoFileName({ startedAt, sideA, sideB }) {
  return `PaddlePad ${DAY.format(new Date(startedAt))} ${side(sideA)} vs ${side(sideB)}`
}
