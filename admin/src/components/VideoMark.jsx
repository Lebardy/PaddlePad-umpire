import Icon from './Icon'

/** A match's camera mark. The icon is hidden from screen readers, so the name is the sr-only text. */
export default function VideoMark() {
  return <><Icon name="camera" size={16} className="icon-video" /><span className="sr-only">Has video</span></>
}
