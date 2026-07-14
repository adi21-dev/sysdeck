import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss(), VitePWA({
    registerType: 'autoUpdate',
    injectRegister: 'script-defer',
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
    },
    manifest: {
      name: 'SysDeck',
      short_name: 'SysDeck',
      description: 'Remote system monitoring and management',
      start_url: '/',
      display: 'standalone',
      background_color: '#000000',
      theme_color: '#000000',
      icons: [
        {
          src: '/icon-192.svg',
          sizes: '192x192',
          type: 'image/svg+xml',
          purpose: 'any maskable',
        },
        {
          src: '/icon-512.svg',
          sizes: '512x512',
          type: 'image/svg+xml',
          purpose: 'any maskable',
        },
      ],
    },
  })],
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
