// ============================================================
// Every word the page says about PaddlePad, in one place, so
// scripts/check-content.mjs can hold each fact to its source.
// System facts only: nothing here is a usage number, and nothing is
// about the visitor.
// ============================================================

import { links } from './links.js'

export const AUDIENCES = {
  players: {
    facts: [
      { icon: 'trend', title: 'A rating that explains itself', text: 'See what moves it and what the next level up does better.' },
      { icon: 'style', title: 'Your playstyle', text: 'Dropper, Driver, Net Player, Power Player or All-Court, once you have enough matches.' },
      { icon: 'target', title: 'What to work on', text: 'Your most common mistake, counted, match by match.' },
      { icon: 'film', title: 'Your highlights', text: 'When the court films, watch your best rallies back to back.' },
    ],
    actions: [
      { label: 'Open PaddlePad', href: links.player, kind: 'amber' },
      { label: 'Have a code?', href: links.claim, kind: 'ghost' },
    ],
  },
  umpires: {
    facts: [
      { icon: 'tap', title: '18 ways a rally ends', text: 'Tap what ended it, then who did it. Score and serve follow.' },
      { icon: 'offline', title: 'Keeps scoring offline', text: 'No signal at the court? Taps are saved and sent later.' },
      { icon: 'camera', title: 'Film the match', text: 'A phone in a holder records it, rally by rally.' },
      { icon: 'star', title: 'Star the highlights', text: 'Pick up to five rallies; players get them as a reel.' },
    ],
    actions: [{ label: 'Open Umpire', href: links.umpire, kind: 'green', note: 'Invite only' }],
  },
  courts: {
    facts: [
      { icon: 'tablet', title: 'Courtside scoring', text: 'Your umpires, your matches, one record.' },
      { icon: 'camera', title: 'Match video', text: 'Phones in holders at the courts can film each match.' },
      { icon: 'people', title: 'Open play', text: 'Spots, fees and who came, in one place.' },
      { icon: 'trophy', title: 'Match of the month', text: 'The best match on PaddlePad, with its highlights.' },
    ],
    actions: [{ label: 'Bring PaddlePad to your courts', href: links.mailto, kind: 'amber', note: links.mail }],
  },
}

export const TALLY = [
  { icon: 'tap', value: 2, label: 'Taps per rally' },
  { icon: 'target', value: 18, label: 'Ways a rally ends' },
  { icon: 'star', value: 5, label: 'Highlights per match' },
  { icon: 'moon', value: '3 AM', label: 'Skill groups refresh, Manila time' },
]

export const RATING_STEPS = [
  { icon: 'tap', title: 'Every rally scored', text: 'The umpire taps how it ended: 18 kinds of ending.' },
  { icon: 'trend', title: 'A chess-style rating', text: 'Worked out when the match ends.' },
  { icon: 'moon', title: 'Every night at 3 AM', text: 'A job refreshes the skill groups.' },
  { icon: 'style', title: 'Grouped by how you play', text: 'K-Means compares players in the same skill group: Dropper, Driver, Net Player, Power Player or All-Court Player.' },
]
