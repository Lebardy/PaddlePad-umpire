import { useRef, useState } from 'react'
import Icon from './Icon.jsx'
import './Sections.css'

// The launch video. It loads nothing until the lamp button is pressed
// (preload none), and never autoplays or starts muted.
export default function Watch() {
  const video = useRef(null)
  const [started, setStarted] = useState(false)

  return (
    <section className="watch" aria-labelledby="watch-title">
      <div className="wrap">
        <h2 id="watch-title" className="watch-title">Watch</h2>
        <div className="watch-frame">
          <video ref={video} src="/launch.mp4" poster="/launch.jpg" controls preload="none" playsInline width="1920" height="1080" onPlay={() => setStarted(true)} />
          {!started && (
            <button type="button" className="watch-play" aria-label="Play the launch video" onClick={() => video.current.play()}>
              <Icon name="play" size={44} />
            </button>
          )}
        </div>
        <p className="watch-line"><Icon name="film" size={22} /> One rally, three apps. 30 seconds.</p>
      </div>
    </section>
  )
}
