import { defineConfig } from 'vite';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        // Isso garante que o cache encontre seus arquivos na Vercel
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,webmanifest}']
      },
      manifest: false
    })
  ]
});
