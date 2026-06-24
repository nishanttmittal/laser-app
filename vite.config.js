import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages project site -> served at /laser-app/
export default defineConfig({
  base: '/laser-app/',
  plugins: [react()],
})
