// =====================================================================
//  vite.config.js  —  Banca Adair e Pedrina
//
//  MUDANÇA PRINCIPAL DESTA VERSÃO: fonte única do manifest do PWA.
//
//  Antes existiam DOIS manifests em desacordo:
//    - o arquivo manifest.json na raiz (short_name "Banca", cor #1b4332)
//    - o gerado por este arquivo        (short_name "Banca Adair", #1a3a2a)
//  Qual deles o celular usava dependia da ordem do build. Pior: o
//  manifest daqui NÃO declarava ícone nenhum, então quando ele vencia,
//  o atalho na tela de início ficava sem logo.
//
//  Agora: o manifest.json da raiz deve ser APAGADO e todo o conteúdo
//  vive aqui, com os ícones declarados.
// =====================================================================

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',

      // 'auto' faz o plugin injetar o registro do service worker no HTML.
      // Por isso o registro manual saiu do index.html: ter os dois fazia
      // dois service workers competirem e o site podia servir versão velha.
      injectRegister: 'auto',

      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],

        // Impede o PWA de "sequestrar" o painel admin com uma página em cache
        navigateFallbackDenylist: [/^\/admin/, /^\/api/],

        // O checkout, o cancelamento e o assistente NUNCA podem vir do
        // cache: uma resposta antiga de /api/checkout poderia mostrar
        // "pedido enviado" sem pedido nenhum ter sido criado.
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/[^/]+\/api\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            // Dados do Firestore: tenta a rede, cai no cache se offline
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'firebase-data-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            // Fotos dos produtos: servem do cache primeiro (rápido e
            // economiza dados da cliente), atualizando em segundo plano.
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'fotos-produtos',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Fontes do Google: mudam quase nunca, cache longo
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fontes-google',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },

      manifest: {
        name: 'Banca Adair e Pedrina',
        short_name: 'Banca Adair',
        description: 'Hortifruti fresco direto para sua casa, com entrega rápida e pagamento na porta.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1a3a2a',
        background_color: '#faf7f2',
        categories: ['shopping', 'food'],

        // ÍCONES — faltavam por completo na versão anterior deste arquivo.
        //
        // Sobre "maskable": o Android recorta o ícone em círculo, folha,
        // quadrado arredondado etc., dependendo do aparelho. Um ícone
        // comum acaba com as bordas cortadas. Um ícone "maskable" tem
        // margem de sobra desenhada de propósito para sobreviver ao corte.
        //
        // Só existem icon-192.png e icon-512.png no projeto, e eles não
        // têm essa margem. Estão declarados como 'any' (uso normal), que
        // é o correto. Se quiser o acabamento completo no Android, veja a
        // seção "ícone maskable" no guia.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
    }),
  ],

  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        admin: resolve(process.cwd(), 'admin.html'),
        privacidade: resolve(process.cwd(), 'privacidade.html'),
      },
    },
  },
});
