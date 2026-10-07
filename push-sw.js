// =====================================================================
//  push-sw.js — parte do service worker que mostra o AVISO DE PEDIDO NOVO.
//  É carregado pelo service worker gerado no build (vite.config.js,
//  workbox.importScripts). Recebe a mensagem do servidor (lib/avisos.js),
//  mostra a notificação e, ao tocar, abre o painel.
// =====================================================================
self.addEventListener('push', (evento) => {
  let d = {};
  try { d = evento.data ? evento.data.json() : {}; } catch (_) { d = {}; }
  const titulo = String(d.titulo || 'Pedido novo').slice(0, 80);
  evento.waitUntil(self.registration.showNotification(titulo, {
    body: String(d.corpo || '').slice(0, 200),
    icon: '/icon-192.png', badge: '/icon-192.png',
    tag: String(d.tag || 'pedido'), renotify: true, vibrate: [200, 100, 200],
    data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/admin.html' },
  }));
});

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  const url = (evento.notification.data && evento.notification.data.url) || '/admin.html';
  evento.waitUntil((async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const painel = abertas.find((c) => new URL(c.url).pathname.startsWith('/admin'));
    if (painel) return painel.focus();
    return self.clients.openWindow(url);
  })());
});

// Faxina: versões antigas do site guardavam respostas do banco de dados numa gaveta do aparelho
// ("firebase-data-cache"). Ela não é mais usada; ao ativar a versão nova, é apagada.
self.addEventListener('activate', (evento) => {
  evento.waitUntil(caches.delete('firebase-data-cache').catch(() => false));
});
