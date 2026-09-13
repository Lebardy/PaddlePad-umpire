import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Read once at config time so the account screen can show a real
// version rather than a number someone has to remember to bump by hand.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)))

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate'. An auto-updating service worker
      // swaps itself in without asking, which for a courtside scoring
      // app could reload the screen mid-rally. The umpire is told an
      // update is ready and picks the moment instead.
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'PaddlePad Umpire',
        short_name: 'PP Umpire',
        description: 'Courtside pickleball match tracking for umpires',
        theme_color: '#1b6e4c',
        background_color: '#f2f4f1',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
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
      },
    }),
  ],
})
