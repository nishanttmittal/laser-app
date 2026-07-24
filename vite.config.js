import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages project site -> served at /laser-app/
export default defineConfig({
  base: '/laser-app/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Stable framework/vendor chunks stay browser-cached when only app code changes.
        manualChunks: {
          react: ['react', 'react-dom'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
  },
})
