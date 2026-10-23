import Icon from './Icon'

/** The Highlights reel's button: play, a star and how many. Nothing when the umpire picked none. */
function Highlights({ count, reel, onPlay }) {
  if (!count) return null
  return (
    <div className="highlights">
      <button type="button" className="highlights-play" onClick={onPlay} aria-label={`Play ${count} highlight${count === 1 ? '' : 's'}`}>
        <Icon name="play" size={18} /><Icon name="star" size={16} />{count}
      </button>
      {reel && <span className="highlights-at" aria-live="polite">{reel.at} of {reel.of}</span>}
    </div>
  )
}

export default Highlights
