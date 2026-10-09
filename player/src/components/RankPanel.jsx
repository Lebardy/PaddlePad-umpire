// ============================================================
// Your place and the whole PPR ranking, in one panel.
//
// The ranking is a ladder: rows sit apart by the real gap in PPR, so a
// close race looks close. It scrolls inside the panel, and when the tab
// opens it glides from 1st down to the reader's own row -- unless they
// asked for less motion, in which case it simply opens there.
// ============================================================

import { useEffect, useRef } from 'react'
import { easeInOutCubic, gapBefore, glideDuration, glideTarget, standingWords } from '../lib/leaderboard'

const fmt = new Intl.NumberFormat('en-US')
const GLIDE_DELAY_MS = 450

function Row({ row }) {
  return (
    <li className={`rank-row${row.place <= 3 ? ' rank-top' : ''}${row.you ? ' rank-you' : ''}`}>
      <span className="rank-place">{row.place}</span>
      <span className="rank-who">
        {row.name}
        {row.you && <span className="rank-you-tag">You</span>}
        <small>{row.matches} matches</small>
      </span>
      <span className="rank-ppr">
        {fmt.format(row.points)}
        <small>PPR</small>
      </span>
    </li>
  )
}

function useGlideToYou(boxRef) {
  useEffect(() => {
    const box = boxRef.current
    const me = box?.querySelector('.rank-you')
    if (!box || !me) return undefined
    const target = glideTarget(me.offsetTop, me.offsetHeight, box.clientHeight, box.scrollHeight - box.clientHeight)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || target === 0) {
      box.scrollTop = target
      return undefined
    }
    box.scrollTop = 0
    let frame = 0
    let stopped = false
    const stop = () => {
      stopped = true
      cancelAnimationFrame(frame)
    }
    // A thumb on the list takes over at once.
    box.addEventListener('pointerdown', stop, { once: true })
    box.addEventListener('wheel', stop, { once: true, passive: true })
    box.addEventListener('keydown', stop, { once: true })
    const ms = glideDuration(target)
    const wait = setTimeout(() => {
      const t0 = performance.now()
      const step = (now) => {
        if (stopped) return
        const t = Math.min(1, (now - t0) / ms)
        box.scrollTop = target * easeInOutCubic(t)
        if (t < 1) frame = requestAnimationFrame(step)
      }
      frame = requestAnimationFrame(step)
    }, GLIDE_DELAY_MS)
    return () => {
      clearTimeout(wait)
      stop()
      box.removeEventListener('pointerdown', stop)
      box.removeEventListener('wheel', stop)
      box.removeEventListener('keydown', stop)
    }
  }, [boxRef])
}

function RankPanel({ ranking, you }) {
  const boxRef = useRef(null)
  useGlideToYou(boxRef)
  const words = standingWords(you)

  return (
    <section className="rank-panel" aria-label="PaddlePad Rating ranking">
      {words && (
        <div className="rank-board">
          <p className="rank-place-big">
            {words.place}
            <small>of {words.of}</small>
          </p>
          <p className="rank-line">{words.line}</p>
        </div>
      )}

      <div className="rank-scroll-wrap">
        <ol className="rank-ladder" ref={boxRef} tabIndex={0} aria-label="Everyone on the ranking">
          {ranking.map((row, i) => {
            const gap = i > 0 ? gapBefore(ranking[i - 1].points, row.points) : null
            return [
              gap && gap.px > 0 && (
                <li key={`gap-${i}`} className="rank-gap" style={{ height: `${gap.px}px` }} aria-hidden="true">
                  {gap.label && <span>{gap.label}</span>}
                </li>
              ),
              <Row key={`${row.place}-${row.name}`} row={row} />,
            ]
          })}
        </ol>
      </div>

      <p className="rank-foot">
        On the board: 10+ matches, one in the last 60 days.
      </p>
    </section>
  )
}

export default RankPanel
