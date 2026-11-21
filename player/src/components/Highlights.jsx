import Icon from './Icon'

/**
 * The Highlights bar: play them all, or one numbered button per highlight.
 * `playing` lights the one on screen. Nothing when the umpire picked none.
 * On a player's own match page it also offers Share and Download, which always save
 * all the highlights as one file.
 */
function Highlights({ count, playing, onPlay, onShare, onDownload, busy = null, progress = 0, ready = false }) {
  if (!count) return null
  const ring = (kind) => busy === kind && (
    <svg className="save-ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="16" pathLength="100" strokeDasharray={`${Math.max(4, progress * 100)} 100`} />
    </svg>
  )
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
      {(onShare || onDownload) && (
        <span className="highlights-save">
          {onShare && (
            <button type="button" className={`highlights-icon${ready ? ' is-ready' : ''}`} aria-label="Share highlights" aria-disabled={busy !== null} onClick={() => busy === null && onShare()}>
              {ring('share')}<Icon name="share" size={20} />
            </button>
          )}
          {onDownload && (
            <button type="button" className="highlights-icon" aria-label="Download highlights" aria-disabled={busy !== null} onClick={() => busy === null && onDownload()}>
              {ring('download')}<Icon name="download" size={20} />
            </button>
          )}
        </span>
      )}
    </div>
  )
}

export default Highlights
