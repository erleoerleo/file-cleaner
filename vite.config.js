import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Update `base` to match your GitHub repository name when deploying to GitHub Pages.
// e.g. if your repo is github.com/you/file-cleaner2, keep it as '/file-cleaner2/'
export default defineConfig({
  plugins: [react()],
  base: '/file-cleaner/',
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('pdf-lib'))  return 'vendor-pdf'
          if (id.includes('exifr'))    return 'vendor-exifr'
          if (id.includes('jszip'))    return 'vendor-jszip'
        },
      },
    },
  },
})
