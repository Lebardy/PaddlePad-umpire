import { useReducedMotion } from '../lib/hooks.js'

const TEXT = 'The score says who won. We show how.'

// Every character is its own lamp that lights in turn, like a board being
// switched on. Words stay whole (nowrap) so the line breaks between words,
// never inside one; the screen reader gets the plain sentence.
export default function LampHeadline() {
  const still = useReducedMotion()
  let n = 0
  return (
    <h1 className={`lamp-head${still ? ' still' : ''}`} aria-label={TEXT}>
      {TEXT.split(' ').map((word, w) => (
        <span key={w} aria-hidden="true">
          {w > 0 && ' '}
          <span className="lamp-word">
            {[...word].map((ch, c) => (
              <span className="lamp-ch" key={c} style={{ '--i': n++ }}>{ch}</span>
            ))}
          </span>
        </span>
      ))}
    </h1>
  )
}
