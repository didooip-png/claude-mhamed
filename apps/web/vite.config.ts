import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// SPA statique (pas de SSR) : le build s'empaquette tel quel dans Electron (étape 2, §14).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // Installation seulement : aucune donnée métier en cache (pas de mode hors ligne en v1).
      workbox: {
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      manifest: {
        id: '/',
        name: 'PharmaStock — Gestion de stock',
        short_name: 'PharmaStock',
        description: 'Gestion de stock de médicaments, ventes, clients et traçabilité',
        lang: 'fr',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['business', 'medical', 'productivity'],
        background_color: '#f8fafc',
        theme_color: '#0f766e',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Raccourcis (appui long sur l'icône, Android / Windows).
        shortcuts: [
          {
            name: 'Caisse',
            short_name: 'Caisse',
            url: '/pos',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Ventes',
            short_name: 'Ventes',
            url: '/sales',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'État du stock',
            short_name: 'Stock',
            url: '/stock',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@pharmastock/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
});
