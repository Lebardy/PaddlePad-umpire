import { readFileSync } from 'node:fs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The landing page is its own Railway service rooted at this directory,
// sharing no source with the other sites (a service only uploads what
// lives under its root).
//
// forwardNow puts src/lib/forward.js into index.html as a plain inline
// script, ahead of everything else. A QR printed for the old player app
// should not wait for React to download before it is sent on, and the
// rule stays in one file that a check script can test.
function forwardNow(playerUrl) {
  const rule = readFileSync(new URL('./src/lib/forward.js', import.meta.url), 'utf8').replace(/^export /m, '')
  const run = `;(function () {
  var to = forwardTarget({ pathname: location.pathname, search: location.search, hash: location.hash,
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true }, ${JSON.stringify(playerUrl)})
  if (to) { window.__forwarding = true; location.replace(to) }
})()`
  return {
    name: 'forward-now',
    transformIndexHtml: (html) => html.replace('<!-- forward-now -->', `<script>\n${rule}${run}\n</script>`),
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return { plugins: [react(), forwardNow(env.VITE_PLAYER_APP_URL ?? '')] }
})
