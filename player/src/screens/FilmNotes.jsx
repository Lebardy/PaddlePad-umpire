// ============================================================
// Before you film: the two things a phone on a tripod gets wrong, said
// once, then the camera. Two notes and no more; a third would not be read.
// ============================================================

import Icon from '../components/Icon'
import { Link } from '../components/Link'
import { navigate } from '../lib/router'

const ANGLE = [
  ['arrowDown', <><strong>Behind one end</strong>, in the middle</>],
  ['arrowUp', <><strong>1.5 m</strong> high or more</>],
  ['corners', <><strong>All four corners</strong> in the picture</>],
  ['phone', <>Phone <strong>sideways</strong>, held still</>],
]

function FilmNotes() {
  return (
    <div className="film-notes">
      <button type="button" className="back-link" onClick={() => (window.history.length > 1 ? window.history.back() : navigate('/'))}><Icon name="chevron" size={18} className="icon-back" />Back</button>
      <h1>Before you film</h1>

      <section className="film-note" aria-labelledby="film-court">
        <h2 id="film-court"><Icon name="court" size={17} className="head-icon" />Show the whole court</h2>
        <div className="film-angle">
          <CourtFromBehind />
          <ul>
            {ANGLE.map(([icon, words]) => <li key={icon}><Icon name={icon} size={24} /><span>{words}</span></li>)}
          </ul>
        </div>
      </section>

      <section className="film-note" aria-labelledby="film-connection">
        <h2 id="film-connection"><Icon name="upload" size={17} className="head-icon" />Use a strong connection</h2>
        <div className="film-connection">
          <p><Icon name="wifi" size={24} /><span><strong>Wifi</strong>, or strong mobile data</span></p>
          <p className="film-size"><strong>460 MB</strong><span>for 15 minutes</span></p>
        </div>
      </section>

      {/* Stays at the foot of the screen; on a short phone the notes scroll behind it. */}
      <div className="film-foot">
        <Link className="film-open" to="/film/camera"><Icon name="camera" size={22} />Open camera</Link>
      </div>
    </div>
  )
}

/** The court from above with the phone behind one end: copied from the approved mock-up, in the app's colours. */
function CourtFromBehind() {
  return (
    <svg className="film-court" role="img" aria-label="The phone goes behind one end of the court, in the middle, seeing all four corners" viewBox="0 0 128 220">
      <path className="film-court-view" d="M64 204 14 20h100z" />
      <rect className="film-court-floor" x="24" y="20" width="80" height="150" />
      <g className="film-court-lines"><rect x="24" y="20" width="80" height="150" /><path d="M24 70h80M24 120h80M64 20v50M64 120v50" /></g>
      <path className="film-court-net-edge" d="M24 95h80" />
      <path className="film-court-net" d="M18 95h92" />
      <g className="film-court-corners"><circle cx="24" cy="20" r="5" /><circle cx="104" cy="20" r="5" /><circle cx="24" cy="170" r="5" /><circle cx="104" cy="170" r="5" /></g>
      <rect className="film-court-phone" x="52" y="194" width="24" height="16" rx="3" />
      <circle className="film-court-lens" cx="64" cy="202" r="4" />
    </svg>
  )
}

export default FilmNotes
