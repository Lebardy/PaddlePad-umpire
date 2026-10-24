#!/usr/bin/env node
// ============================================================
// The landing page on a real address (staging), seen by a real browser.
//
//   node landing/scripts/staging-check.mjs <landing-url> <player-url> <umpire-url> <profile-dir|-> <out-dir>
//
// <umpire-url> is the address the page's umpire links should go to.
// <profile-dir> must be a browser profile where the OLD player app was
// opened from <landing-url> (so it holds that app's service worker); the
// check retires it, so the profile is good for one run. Pass - to skip
// that part (a service that never had the old app). Pictures of each
// section go to <out-dir>. Not named check-*.mjs, so `pnpm test` skips it.
// Every browser is started muted.
// ============================================================

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [landingArg, playerArg, umpireArg, profileDir, outDir] = process.argv.slice(2)
if (!outDir) {
  console.error('usage: staging-check.mjs <landing-url> <player-url> <umpire-url> <profile-dir|-> <out-dir>')
  process.exit(2)
}
const LANDING = landingArg.replace(/\/$/, '')
const PLAYER = playerArg.replace(/\/$/, '')
const UMPIRE = umpireArg.replace(/\/$/, '')
const MAIL = 'mailto:jhlibrando.student@asiancollege.edu.ph'
mkdirSync(outDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
function check(label, ok, detail = '') {
  if (ok) pass += 1
  else fail += 1
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`)
}

// One headless browser, started muted on a given profile, driven over CDP.
async function launch(profile, port = 9366) {
  const proc = spawn('/usr/bin/helium-browser', ['--headless=new', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' })
  const exited = new Promise((r) => proc.on('exit', r))
  let target
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250)
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page') } catch { /* not up yet */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let seq = 0
  const waiting = new Map()
  const events = []
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg.result ?? msg); waiting.delete(msg.id) }
    else if (msg.method) events.push(msg)
  }
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) console.log('  JS ERROR', JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result?.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  // Headless reloads its first page once after start-up: open, wait, open again.
  const open = async (url, wait = 2500) => { await send('Page.navigate', { url }); await sleep(wait) }
  const close = async () => { ws.close(); proc.kill(); await exited; if (profile.startsWith(tmpdir())) rmSync(profile, { recursive: true, force: true }) }
  return { send, js, open, close, events }
}

async function until(js, expression, ms = 15000) {
  for (let t = 0; t < ms; t += 250) {
    if (await js(expression)) return true
    await sleep(250)
  }
  return false
}

const HEADLINE = `document.querySelector('h1.lamp-head')?.getAttribute('aria-label') === 'The score says who won. We show how.'`

// 1. The old player app's worker, planted in the given profile.
console.log('1. Old worker')
if (profileDir === '-') console.log('  skipped (no profile given)')
else {
  // Look before opening the page: opening it lets the new worker retire the old one.
  // Caches are counted on disk (the profile has only ever seen the landing address);
  // the browser only lists them from a page already on that address.
  const cacheDir = join(profileDir, 'Default', 'Service Worker', 'CacheStorage')
  const cacheFolders = existsSync(cacheDir) ? readdirSync(cacheDir).length : 0
  const b = await launch(profileDir)
  await b.send('ServiceWorker.enable')
  await sleep(1500)
  const reg = b.events.some((e) => e.method === 'ServiceWorker.workerRegistrationUpdated' && e.params.registrations.some((r) => r.scopeURL.startsWith(LANDING) && !r.isDeleted))
  check('the profile starts with the old worker and caches', reg && cacheFolders > 0, JSON.stringify({ reg, cacheFolders }))
  await b.send('ServiceWorker.disable')
  await b.open(LANDING + '/', 4000)
  await b.open(LANDING + '/', 1500)
  const gone = await until(b.js, `(async () => !(await navigator.serviceWorker.getRegistration()) && (await caches.keys()).length === 0)()`)
  check('within 15 s the registration is gone and caches are empty', gone)
  await sleep(1500)
  check('afterwards the page shows the lamp headline', await b.js(HEADLINE), await b.js('location.href'))
  const after = await b.js(`(async () => ({ reg: !!(await navigator.serviceWorker.getRegistration()), caches: (await caches.keys()).length }))()`)
  check('registration and caches stay gone', !after.reg && after.caches === 0, JSON.stringify(after))
  await b.close()
}

// 2 and 3. Forwarding, from a fresh profile.
console.log('2. Forwarding')
{
  const b = await launch(mkdtempSync(join(tmpdir(), 'pp-fwd-')))
  await b.open('about:blank', 4000)
  const land = async (path) => {
    await b.open(LANDING + path, 500)
    await until(b.js, `location.origin !== ${JSON.stringify(LANDING)}`, 8000)
    await sleep(500)
    return b.js('location.href')
  }
  for (const path of ['/claim/AB12?x=1', '/matches/0b6e', '/rating']) {
    const got = await land(path)
    check(`${path} goes to the player app, same path and query`, got === PLAYER + path, got)
  }
  await b.open(LANDING + '/', 4000)
  check('/ stays on the landing page', (await b.js('location.href')) === LANDING + '/' && (await b.js(HEADLINE)), await b.js('location.href'))

  console.log('3. Standalone')
  // Headless ignores an emulated display-mode, so act as an iPhone home-screen app instead.
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true })` })
  const got = await land('/')
  check('/ as an installed app goes to the player app', new URL(got).origin === PLAYER && new URL(got).pathname === '/', got)
  await b.close()
}

// 4 and 5. The page itself, at both sizes.
console.log('4. The page')
const SIZES = [[390, 844, 'phone'], [1440, 900, 'desktop']]
const rules = {}
{
  const b = await launch(mkdtempSync(join(tmpdir(), 'pp-page-')))
  await b.open('about:blank', 4000)
  for (const [w, h, name] of SIZES) {
    console.log(`  -- ${name} ${w}x${h}`)
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 })
    await b.open(LANDING + '/', 1500)
    await until(b.js, HEADLINE, 10000)
    await sleep(2500)

    const wide = await b.js(`document.documentElement.scrollWidth - document.documentElement.clientWidth`)
    check(`${name}: no horizontal scroll`, wide <= 0, `overflow ${wide}px`)

    await b.js(`document.querySelector('#tab-see-it').focus()`)
    for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
    await sleep(300)
    const arrow = await b.js(`({ hash: location.hash, selected: document.querySelector('[role=tab][aria-selected=true]')?.id, shown: !document.querySelector('#players').hidden })`)
    check(`${name}: ArrowRight from See it selects Players and sets #players`, arrow.hash === '#players' && arrow.selected === 'tab-players' && arrow.shown, JSON.stringify(arrow))

    // A fresh load, not a hash change on the open page: a shared /#courts link starts cold.
    await b.open('about:blank', 300)
    await b.open(LANDING + '/#courts', 1500)
    await sleep(1000)
    const courts = await b.js(`({ selected: document.querySelector('[role=tab][aria-selected=true]')?.id, shown: !document.querySelector('#courts').hidden })`)
    check(`${name}: /#courts opens Courts`, courts.selected === 'tab-courts' && courts.shown, JSON.stringify(courts))

    await b.js(`document.querySelector('.tally').scrollIntoView({ block: 'center' })`)
    await sleep(2200)
    const strip = await b.js(`[...document.querySelectorAll('.tally-cell b')].map((e) => e.textContent)`)
    check(`${name}: the strip reads 2 / 18 / 5 / 3 AM`, JSON.stringify(strip) === JSON.stringify(['2', '18', '5', '3 AM']), JSON.stringify(strip))

    const hrefs = await b.js(`[...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))]`)
    const okHref = (x) => [PLAYER + '/', PLAYER + '/claim', UMPIRE + '/'].includes(x) || x.startsWith(MAIL) || x.startsWith('#')
    const bad = hrefs.filter((x) => !okHref(x))
    check(`${name}: every link goes where it should`, bad.length === 0, bad.length ? `unexpected ${JSON.stringify(bad)}` : `${hrefs.length} distinct`)

    // Pictures: the full page, then each section on its own (tabs one by one).
    await b.open(LANDING + '/#see-it', 1500)
    await sleep(1500)
    const shot = async (file, selector, upTo) => {
      // At the top, so the sticky bar is drawn there and not over the section.
      await b.js('scrollTo(0, 0)')
      await sleep(300)
      const box = await b.js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); const to = ${upTo ? `document.querySelector(${JSON.stringify(upTo)}).getBoundingClientRect().bottom + scrollY` : 'null'}; return { x: 0, y: ${upTo ? '0' : 'r.top + scrollY'}, w: document.documentElement.clientWidth, h: ${upTo ? 'to' : 'r.height'} } })()`)
      const r = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: box.x, y: box.y, width: box.w, height: Math.max(1, box.h), scale: 1 } })
      writeFileSync(join(outDir, `${name}-${file}.png`), Buffer.from(r.data, 'base64'))
    }
    for (const id of ['see-it', 'players', 'umpires', 'courts']) {
      await b.js(`document.querySelector('#tab-${id}').click()`)
      await sleep(900)
      await shot(`1-top-${id}`, 'header.topbar', 'main')
    }
    await b.js(`document.querySelector('#tab-see-it').click()`)
    await sleep(500)
    await shot('2-number-strip', '.tally')
    await shot('3-watch', '.watch')
    await shot('4-rating', '.rating')
    await shot('5-footer', '.foot')
    await b.js('scrollTo(0, 0)')
    await sleep(300)
    const full = await b.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    writeFileSync(join(outDir, `${name}-0-full.png`), Buffer.from(full.data, 'base64'))

    // Numbers for the picture review: small tap targets, small text, wide words.
    rules[name] = await b.js(`(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const small = [...document.querySelectorAll('a[href], button')].filter((e) => vis(e)).map((e) => { const r = e.getBoundingClientRect(); return { el: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) } }).filter((x) => x.w < 44 || x.h < 44)
      const sizes = {}
      for (const e of document.querySelectorAll('#root *')) { if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || !vis(e)) continue; const s = Math.round(parseFloat(getComputedStyle(e).fontSize)); sizes[s] = (sizes[s] || 0) + 1 }
      return { smallTargets: small, fontSizes: sizes, pageHeight: document.documentElement.scrollHeight }
    })()`)
  }

  // Reduced motion: See it's step does not move on its own.
  console.log('  -- reduced motion')
  await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await b.open(LANDING + '/', 1500)
  await until(b.js, HEADLINE, 10000)
  await sleep(1500)
  const step = () => b.js(`document.querySelector('.story-label')?.textContent`)
  const first = await step()
  await sleep(10000)
  const later = await step()
  check('reduced motion: the step is unchanged after 10 s', !!first && first === later, `${JSON.stringify(first)} -> ${JSON.stringify(later)}`)
  await b.close()
}
writeFileSync(join(outDir, 'rules.json'), JSON.stringify(rules, null, 2))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
