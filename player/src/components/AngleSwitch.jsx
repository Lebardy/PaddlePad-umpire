import Icon from './Icon'

/**
 * Which side's camera is on screen: one pill each, the pressed one is showing.
 * Nothing when only one side filmed.
 */
function AngleSwitch({ videos: [first, other], on, onChange }) {
  if (!other) return null
  return (
    <div className="angle-switch" role="group" aria-label="Camera">
      {[first, other].map((video, i) => (
        <button key={i} type="button" className="angle-pill" aria-pressed={on === i} onClick={() => on !== i && onChange(i)}>
          <Icon name="camera" size={18} /><span>{video.sideNames.join(' · ') || `Camera ${i + 1}`}</span>
        </button>
      ))}
    </div>
  )
}

export default AngleSwitch
