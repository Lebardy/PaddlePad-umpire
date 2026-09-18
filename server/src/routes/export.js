import { Router } from 'express'
import { query } from '../db.js'
import { requireActiveUmpire, requireAuth } from '../auth.js'
import { buildMatchLogRows, matchLogsToCSV } from '../export.js'

const router = Router()
router.use(requireAuth, requireActiveUmpire(query))

function filename(extension) {
  const stamp = new Date().toISOString().slice(0, 10)
  return `paddlepad_match_logs_${stamp}.${extension}`
}

/** The CSV fed to the PaddlePad ML pipeline. Covers every umpire's matches. */
router.get('/match-logs.csv', async (_req, res) => {
  const rows = await buildMatchLogRows(query)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename('csv')}"`)
  res.send(matchLogsToCSV(rows))
})

/** Same rows as JSON, for checking the export without parsing CSV. */
router.get('/match-logs.json', async (_req, res) => {
  res.json({ rows: await buildMatchLogRows(query) })
})

export default router
