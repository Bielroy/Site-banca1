const CACHE_NAME = 'banca-v2'; // Tudo minúsculo aqui!
const assets = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Instala o Service Worker e guarda os arquivos básicos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(assets);
    })
  );
});

// Essa é a mágica que apaga o visual velho do celular do cliente
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      );
    })
  );
});

// Intercepta as requisições (aqui entra a mágica das imagens offline)
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // 1. Se for uma IMAGEM (foto do Firebase), salva no cache dinamicamente
  if (event.request.destination === 'image' || requestUrl.pathname.match(/\.(png|jpg|jpeg|webp|gif|svg)$/)) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse; // Devolve do cache instantaneamente
        }
        return fetch(event.request).then(networkResponse => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkResponse.clone()); // Salva a foto nova pro futuro
            return networkResponse;
          });
        });
      })
    );
  } else {
    // 2. Se for HTML, CSS, etc., tenta achar no cache normal
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request);
      })
    );
  }
});

// Escuta a mensagem enviada pelo index.html para atualizar o app na hora (só um desse!)
self.addEventListener('message', event => {
  if (event.data && event.data.action === 'skipWaiting') {
    self.skipWaiting();
  }
});
