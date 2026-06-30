import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/setup': 'http://127.0.0.1:3939',
      '/login': {
        target: 'http://127.0.0.1:3939',
        bypass: (req) => req.method === 'GET' ? req.url : undefined,
      },
      '/ws': {
        target: 'ws://127.0.0.1:3939',
        ws: true,
      },
      '/api': 'http://127.0.0.1:3939',
    },
  },
})
