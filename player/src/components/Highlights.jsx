import Icon from './Icon'

/**
 * The Highlights bar: play them all, or one numbered button per highlight.
 * `playing` lights the one on screen. Nothing when the umpire picked none.
 */
function Highlights({ count, playing, onPlay }) {
  if (!count) return null
  return (
    <div className="highlights" role="group" aria-label="Highlights">
      <button type="button" className="highlights-play" onClick={() => onPlay()} aria-label={`Play all ${count} highlight${count === 1 ? '' : 's'}`}>
        <Icon name="play" size={18} /><Icon name="star" size={16} />
      </button>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          className={`highlights-one${playing === i ? ' is-playing' : ''}`}
          onClick={() => onPlay(i)}
          aria-label={`Play highlight ${i + 1}`}
          aria-current={playing === i ? 'true' : undefined}
        >
          {i + 1}
        </button>
      ))}
    </div>
  )
}

export default Highlights
