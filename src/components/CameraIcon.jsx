import { useEffect, useState } from 'react'
import Icon from './Icon'
import { fetchCameraStatus } from '../lib/api'

const LABELS = { none: 'No camera', ready: 'Camera ready', filming: 'Camera is filming' }

/**
 * The scoring screen's camera icon, in the header: whether the phone
 * in the holder is there, and whether it is filming this match. An icon
 * and no words, so the screen still fits a tablet; shape as well as
 * colour says which (a crossed-out camera, a tick, a red dot).
 *
 * Asked for every 5 seconds. A failed ask reads as "no camera": the
 * umpire should never be shown a camera the server cannot vouch for.
 */
function CameraIcon() {
  const [camera, setCamera] = useState('none')

  useEffect(() => {
    let live = true
    const ask = () => fetchCameraStatus()
      .then((status) => { if (live) setCamera(LABELS[status] ? status : 'none') })
      .catch(() => { if (live) setCamera('none') })
    ask()
    const timer = setInterval(ask, 5_000)
    return () => { live = false; clearInterval(timer) }
  }, [])

  return (
    <span className={`camera-pill camera-pill--${camera}`} role="img" aria-label={LABELS[camera]} title={LABELS[camera]}>
      {camera === 'filming' && <span className="camera-dot" aria-hidden="true" />}
      <Icon name={camera === 'none' ? 'cameraOff' : 'camera'} size={18} />
      {camera === 'ready' && <Icon name="check" size={14} />}
    </span>
  )
}

export default CameraIcon
