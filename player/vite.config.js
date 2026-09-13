import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Read once at config time so the About screen can show a real version
// rather than a number someone has to remember to bump by hand.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

// The player app is a SEPARATE deployable from the umpire app, with its
// own Railway service rooted at this directory. It deliberately shares
// no source with it: a Railway service only uploads what lives under
// its root directory, so an import reaching into ../src or ../server
// would work locally and then fail in production -- the same trap that
// forced the scoring engine to live inside server/.
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' here, unlike the umpire app's 'prompt'. That one
      // asks before applying an update purely so a service worker can
      // never reload the screen mid-rally while someone is scoring. A
      // read-only viewer has no such hazard, so it can just update.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'PaddlePad',
        short_name: 'PaddlePad',
        description: 'Your pickleball matches and stats',
        theme_color: '#12161c',
        background_color: '#e8e6e0',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Deliberately NO runtimeCaching for the API. A cached
        // /player/matches would render stale stats as though fresh,
        // which is worse than honestly showing nothing.
      },
    }),
  ],
})
