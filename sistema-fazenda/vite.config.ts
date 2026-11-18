import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Alvo compatível com o último Chrome do Windows 7 (109) e Firefox ESR 115.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: ['chrome109', 'firefox115', 'safari15', 'edge109'] },
})
