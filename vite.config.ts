import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Vite config — https://vitejs.dev/config/
//
// Note: this project was exported from Figma Make. The original config
// imported `./.figma/make/site.json` and wired up several dev-only plugins
// that only make sense inside Figma Make's hosted preview (story bootstrap,
// HMR error-overlay replay, etc.). That file isn't included in this export,
// so it would crash `vite dev` / `vite build` immediately. This is a plain,
// standalone config so the app runs anywhere (local machine, Vercel,
// Netlify, ...).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '5173'),
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '4173'),
  },
})
