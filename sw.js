// Portal do Vendedor Aura — funciona sem internet com a última versão salva.
const CACHE = 'aura-portal-v22';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'entrar/fundo-aura.svg',
  'entrar/logo-aura-hd.png',
  'logo-aura.png',
  'logo-aura-login.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'docs/termo-atendimento-garantia-1.jpg',
  'docs/termo-emprestimo-reserva-1.jpg',
  'docs/termo-devolucao-reserva-1.jpg',
  'docs/termo-compra-upgrade-1.jpg',
  'docs/termo-atendimento-garantia.pdf',
  'docs/termo-emprestimo-reserva.pdf',
  'docs/termo-devolucao-reserva.pdf',
  'docs/termo-compra-upgrade.pdf',
  'docs/termo-entrada-manutencao-1.jpg',
  'docs/termo-entrada-manutencao.pdf'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Login (Cloudflare) e a checagem da tela de entrada sempre vão direto para a internet.
  if (url.pathname.startsWith('/cdn-cgi/') || url.pathname.startsWith('/privado/') || url.pathname.startsWith('/api/') || url.searchParams.has('check')) return;
  // Números e a própria página: busca na internet primeiro, usa a cópia salva se estiver sem sinal.
  if (url.pathname.endsWith('dados.json') || url.pathname.endsWith('estoque.json') || url.pathname.endsWith('avaliacao.json') || url.pathname.endsWith('taxas.json') || url.pathname.endsWith('escala.json') || url.pathname.endsWith('manutencao.json') || e.request.mode === 'navigate' || url.pathname.startsWith('/entrar') || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
        .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
    );
    return;
  }
  // Demais arquivos (termos, ícones): cópia salva primeiro.
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })));
});

// Notificações
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Portal Aura', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Portal Aura', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: d.tag || undefined, data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  if (!url.startsWith(self.location.origin)) { e.waitUntil(clients.openWindow(url)); return; }
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if (w.url.startsWith(self.location.origin)) { w.navigate(url).catch(() => {}); return w.focus(); } }
    return clients.openWindow(url);
  }));
});
