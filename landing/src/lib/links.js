// Every address the page links to, in one place. The two app addresses
// are build-time settings so staging links to staging.
const trim = (url) => (url ?? '').replace(/\/$/, '')

// `?.` because check scripts import this under node, where import.meta.env is undefined.
const player = trim(import.meta.env?.VITE_PLAYER_APP_URL)
const mail = 'jhlibrando.student@asiancollege.edu.ph'

export const links = {
  player: `${player}/`,
  // A bare /claim opens the player app's code panel, empty.
  claim: `${player}/claim`,
  umpire: `${trim(import.meta.env?.VITE_UMPIRE_APP_URL)}/`,
  mail,
  mailto: `mailto:${mail}?subject=${encodeURIComponent('PaddlePad at our courts')}`,
}
