import { links } from '../lib/links.js'
import Icon from './Icon.jsx'
import './Sections.css'

export default function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-row">
        <span className="brand">PaddlePad</span>
        <nav className="foot-links" aria-label="PaddlePad">
          <a href={links.player}><Icon name="player" size={20} />Player</a>
          <a href={links.umpire}><Icon name="whistle" size={20} />Umpire</a>
          <a href="#courts"><Icon name="court" size={20} />Courts</a>
          <a href={links.mailto}><Icon name="mail" size={20} />{links.mail}</a>
        </nav>
      </div>
    </footer>
  )
}
