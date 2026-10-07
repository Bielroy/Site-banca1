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
import { existsSync, readFileSync } from 'fs';

const raiz = process.cwd();

// ---------------------------------------------------------------------
// PÁGINAS DO SITE
//
// O build parava TODO quando uma página desta lista não existia no
// repositório — foi o que aconteceu com o privacidade.html: de 24/07 em
// diante nenhum deploy entrou no ar. Agora só entra na lista a página que
// existe de verdade; a que faltar fica de fora e o resto do site sobe.
// ---------------------------------------------------------------------
const PAGINAS = { main: 'index.html', admin: 'admin.html', privacidade: 'privacidade.html', plataforma: 'plataforma.html' };
const paginasExistentes = Object.fromEntries(
  Object.entries(PAGINAS)
    .filter(([, arquivo]) => existsSync(resolve(raiz, arquivo)))
    .map(([nome, arquivo]) => [nome, resolve(raiz, arquivo)])
);

// ---------------------------------------------------------------------
// ARQUIVOS SOLTOS DA RAIZ
//
// O Vite só copia sozinho o que está numa pasta "public/". Estes arquivos
// ficam na raiz do projeto, então não iam para o site publicado: o ícone do
// atalho (manifest), a imagem de compartilhamento, o robots.txt e o
// sitemap.xml davam erro 404. Este mini-plugin os copia com o mesmo nome.
// ---------------------------------------------------------------------
// admin.webmanifest + icon-painel-*: o segundo aplicativo instalável, o do PAINEL (ver js/admin-instalar.js).
const ARQUIVOS_DA_RAIZ = ['icon-192.png', 'icon-512.png', 'icon-painel-192.png', 'icon-painel-512.png', 'admin.webmanifest', 'og-image.png', 'robots.txt', 'sitemap.xml', 'push-sw.js'];
const copiarArquivosDaRaiz = () => ({
  name: 'banca-copiar-arquivos-da-raiz',
  apply: 'build',
  generateBundle() {
    for (const arquivo of ARQUIVOS_DA_RAIZ) {
      const caminho = resolve(raiz, arquivo);
      if (existsSync(caminho)) this.emitFile({ type: 'asset', fileName: arquivo, source: readFileSync(caminho) });
    }
  },
});

export default defineConfig({
  plugins: [
    copiarArquivosDaRaiz(),
    VitePWA({
      registerType: 'autoUpdate',

      // 'auto' faz o plugin injetar o registro do service worker no HTML.
      // Por isso o registro manual saiu do index.html: ter os dois fazia
      // dois service workers competirem e o site podia servir versão velha.
      injectRegister: 'auto',

      workbox: {
        // aviso de pedido novo: o service worker gerado carrega este arquivo (push-sw.js, na raiz)
        importScripts: ['push-sw.js'],
        // As PÁGINAS (html) NÃO ficam mais na cópia guardada do aparelho. Antes ficavam, e quem
        // já tinha entrado abria sempre a versão antiga do site, só vendo a nova na visita
        // seguinte (ou nunca, se a atualização em segundo plano falhasse). Agora a página é
        // buscada na internet toda vez (regra "paginas" abaixo) e só cai na cópia guardada se
        // o aparelho estiver sem sinal. Imagens, estilos e código continuam guardados: é o que
        // deixa o site rápido, e cada versão deles tem nome próprio, então não ficam velhos.
        globPatterns: ['**/*.{js,css,ico,png,svg,webp}'],
        navigateFallback: null,

        // O checkout, o cancelamento e o assistente NUNCA podem vir do
        // cache: uma resposta antiga de /api/checkout poderia mostrar
        // "pedido enviado" sem pedido nenhum ter sido criado.
        runtimeCaching: [
          {
            // Abrir o site: sempre tenta a versão que está no ar; sem sinal (ou internet
            // muito lenta), mostra a última que este aparelho viu.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'paginas',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: /^https?:\/\/[^/]+\/api\/.*/i,
            handler: 'NetworkOnly',
          },
          // (SAIU o cache das respostas do banco de dados: o programa do Firebase já guarda o que precisa para
          //  funcionar sem sinal, e esta cópia extra deixava dados do painel — pedidos com nome e endereço —
          //  gravados numa segunda gaveta do aparelho, que nem a saída do painel apagava.)
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
        // Os ícones (o caixote com frutas) têm fundo cheio e o desenho
        // inteiro cabe na área segura, então o mesmo arquivo de 512 serve
        // também como 'maskable' e o Android o mostra sem moldura branca.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],

  build: {
    target: 'esnext',
    rollupOptions: {
      input: paginasExistentes,
    },
  },
});
