import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The admin site is its own Railway service rooted at this directory, so
// it shares no source with the other apps: a service only uploads what
// lives under its root. No offline support: admins work online.
export default defineConfig({
  plugins: [react()],
})
