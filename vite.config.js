import { defineConfig } from 'vite';
import { resolve } from 'path';
// Removemos a importação do VitePWA para destravar a Vercel

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  },
  // Deixe os plugins vazios para o build passar limpo!
  plugins: []
});
