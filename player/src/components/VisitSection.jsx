// ============================================================
// "How was your visit?" on a match page, while it can still be rated:
// five faces, then what made it good (4-5) or what could be better
// (1-3). One rating per session, the same on each of its match pages;
// every tap saves it.
// ============================================================

import { useState } from 'react'
import { rateVisit } from '../lib/api'
import { usePlayerData } from '../lib/PlayerData'
import Avatar from './Avatar'
import Icon from './Icon'

const CHIPS = ['Courts', 'Staff', 'Waiting', 'Price', 'Cleanliness']

function VisitSection({ visit: given }) {
  const { refresh } = usePlayerData()
  // What the last save answered, until the history reloads with it.
  const [saved, setSaved] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const visit = saved?.sessionId === given.sessionId ? saved : given

  if (!visit.open) return null

  async function save(score, chips) {
    setSaving(true)
    setError(null)
    try {
      setSaved(await rateVisit(visit.sessionId, { score, chips }))
      // The session's other match pages ask the same question.
      refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // Crossing from good to could-be-better clears the chips: they answered the other question.
  const pickFace = (score) => save(score, (score >= 4) === (visit.score >= 4) ? visit.chips : [])
  const pickChip = (chip) => save(visit.score, visit.chips.includes(chip) ? visit.chips.filter((c) => c !== chip) : [...visit.chips, chip])

  return (
    <section className="visit" aria-label="How was your visit?">
      <div className="section-head">
        <h2><Icon name="pin" size={17} className="head-icon" />How was your visit?</h2>
        {visit.score && <span className="visit-saved"><Icon name="check" size={16} />Saved</span>}
      </div>
      <p className="visit-where"><Avatar name={visit.facilityName} size="sm" />{visit.facilityName}</p>
      <div className="visit-faces">
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            type="button"
            key={score}
            className={`visit-face${visit.score === score ? ' is-on' : ''}`}
            aria-label={`${score} out of 5`}
            aria-pressed={visit.score === score}
            disabled={saving}
            onClick={() => pickFace(score)}
          >
            <Icon name={`face${score}`} size={30} />
          </button>
        ))}
      </div>
      {visit.score && (
        <>
          <p className="visit-ask">{visit.score >= 4 ? 'What made it good?' : 'What could be better?'}</p>
          <div className="visit-chips">
            {CHIPS.map((chip) => (
              <button
                type="button"
                key={chip}
                className={`visit-chip${visit.chips.includes(chip) ? ' is-on' : ''}`}
                aria-pressed={visit.chips.includes(chip)}
                disabled={saving}
                onClick={() => pickChip(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="op-error" role="alert">{error}</p>}
    </section>
  )
}

export default VisitSection
