// Portal do Vendedor Aura — funciona sem internet com a última versão salva.
const CACHE = 'aura-portal-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'logo-aura.png',
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
  'docs/termo-compra-upgrade.pdf'
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
  // Números e a própria página: busca na internet primeiro, usa a cópia salva se estiver sem sinal.
  if (url.pathname.endsWith('dados.json') || e.request.mode === 'navigate' || url.pathname.endsWith('index.html')) {
    e.respondWith(
      fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
        .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
    );
    return;
  }
  // Demais arquivos (termos, ícones): cópia salva primeiro.
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })));
});
