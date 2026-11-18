import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Alvo compatível com o último Chrome do Windows 7 (109) e Firefox ESR 115.
// O "service worker" guarda o app no aparelho para abrir sem internet.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // usamos public/manifest.webmanifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        navigateFallback: 'index.html',
        // dados do Supabase nunca ficam no cache do service worker: quem guarda é o próprio app (IndexedDB)
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
      },
    }),
  ],
  base: './',
  // aceita as variáveis criadas automaticamente pela integração Supabase do Vercel (NEXT_PUBLIC_*)
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: { target: ['chrome109', 'firefox115', 'safari15', 'edge109'] },
})
