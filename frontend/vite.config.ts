import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/login': {
        target: 'http://127.0.0.1:3939',
        bypass: (req) => req.method === 'GET' ? req.url : undefined,
      },
      '/ws': {
        target: 'http://127.0.0.1:3939',
        ws: true,
        changeOrigin: true,
      },
      '/api': 'http://127.0.0.1:3939',
    },
  },
})
