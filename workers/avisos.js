// Worker "portal-aura-avisos" (Cloudflare). Roda a cada 15 min (cron) e manda as notificações do Portal Aura.
// Bindings: KV AVALIACAO (mesmo do portal), segredo VAPID_PRIVATE_JWK, segredo TESTE_CHAVE (opcional, para /teste).
// Web Push (RFC 8291 aes128gcm + VAPID RFC 8292) só com WebCrypto.
const te = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...a) => { const n = a.reduce((t, x) => t + x.length, 0), o = new Uint8Array(n); let i = 0; a.forEach(x => { o.set(x, i); i += x.length; }); return o; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function encrypt(sub, payload) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(te.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function vapidHeader(endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + vapid.publicKey;
}
async function sendPush(sub, data, vapid, ttl = 43200) {
  const body = await encrypt(sub, JSON.stringify(data));
  return fetch(sub.endpoint, { method: 'POST', body, headers: {
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal',
    Authorization: await vapidHeader(sub.endpoint, vapid) } });
}

const VAPID_PUBLIC = 'BA9PQAsAvQsCAz7x-LTM8qCORxXexphwC35YCNX3ITJwbHDiMeXggANV80EpYQTQbwOBpZEvMI92JeNluds01mA';
const DADOS = 'https://raw.githubusercontent.com/carlsoncarvjr/portal-aura/main/dados.json';
const MARCOS = [25, 50, 75, 90, 100];

function agoraBahia() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { data: p.year + '-' + p.month + '-' + p.day, min: Number(p.hour) * 60 + Number(p.minute) };
}

async function inscritos(env) {
  const out = []; let cursor;
  do {
    const r = await env.AVALIACAO.list({ prefix: 'push:', cursor });
    for (const k of r.keys) { const v = await env.AVALIACAO.get(k.name, 'json'); if (v) out.push({ chave: k.name, ...v }); }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

async function enviar(env, papeis, msg) {
  const vapid = { subject: 'https://portal-aura.pages.dev', privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), publicKey: VAPID_PUBLIC };
  const lista = (await inscritos(env)).filter(i => !papeis || papeis.includes(i.papel));
  let ok = 0;
  await Promise.all(lista.map(async i => {
    try {
      const r = await sendPush(i.sub, msg, vapid);
      if (r.status === 404 || r.status === 410) await env.AVALIACAO.delete(i.chave);
      else if (r.ok) ok++;
    } catch (e) {}
  }));
  return { enviados: ok, total: lista.length };
}

async function vendas(env) {
  const d = await fetch(DADOS + '?t=' + Date.now(), { cf: { cacheTtl: 0 } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!d || !d.mes) return;
  const ant = await env.AVALIACAO.get('avisos:ultimo', 'json');
  const atual = { atualizadoEm: d.atualizadoEm, rotulo: d.mes.rotulo, iphones: d.mes.iphones, acessorios: d.mes.acessorios,
    vend: Object.fromEntries((d.ranking.mes || []).map(r => [r.vendedor, r.iphones])) };
  if (ant && ant.atualizadoEm === atual.atualizadoEm) return;
  await env.AVALIACAO.put('avisos:ultimo', JSON.stringify(atual));
  if (!ant || ant.rotulo !== atual.rotulo) return;   // primeira vez ou virada do mês: só guarda
  const novos = Object.entries(atual.vend).map(([n, q]) => [n, q - (ant.vend[n] || 0)]).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
  const meta = d.mes.metaIphones;
  if (novos.length) {
    const quem = novos.map(([n, q]) => n + ' +' + q + (q === 1 ? ' iPhone' : ' iPhones')).join(', ');
    const lider = (d.ranking.mes || []).slice().sort((a, b) => b.iphones - a.iphones)[0];
    await enviar(env, ['vendedor', 'admin'], { title: '📱 Vendas atualizadas', body: quem + '. Loja: ' + atual.iphones + ' de ' + meta + ' iPhones' + (lider ? ' · 1º: ' + lider.vendedor : '') + '.', url: '/#vendas', tag: 'vendas' });
  }
  const pAnt = ant.iphones / meta * 100, pAt = atual.iphones / meta * 100;
  const marco = MARCOS.filter(m => pAnt < m && pAt >= m).pop();
  if (marco) await enviar(env, ['vendedor', 'admin'], { title: marco === 100 ? '🏆 Meta de iPhones batida!' : '🎯 ' + marco + '% da meta de iPhones', body: marco === 100 ? atual.iphones + ' iPhones no mês. Prêmio garantido para a equipe!' : 'A loja chegou a ' + atual.iphones + ' de ' + meta + '. Faltam ' + (meta - atual.iphones) + '.', url: '/#inicio', tag: 'meta' });
}

async function lembretes(env) {
  const t = agoraBahia();
  const itens = [
    { id: 'abertura', ini: 9 * 60, msg: { title: '☀️ Bom dia! Tarefas de abertura', body: 'Pia, chão, lixo e a fila do Kommo. Marque no portal quando terminar.', url: '/#loja', tag: 'tarefas' } },
    { id: 'fechamento', ini: 20 * 60 + 40, msg: { title: '🌙 Tarefas de fechamento', body: 'Pia, chão, lixo e conferir os funis do Kommo antes de sair.', url: '/#loja', tag: 'tarefas' } },
  ];
  for (const it of itens) {
    if (t.min < it.ini || t.min >= it.ini + 30) continue;
    const k = 'avisos:' + it.id + ':' + t.data;
    if (await env.AVALIACAO.get(k)) continue;
    await env.AVALIACAO.put(k, '1', { expirationTtl: 3 * 86400 });
    await enviar(env, ['vendedor'], it.msg);
  }
}

export default {
  async scheduled(ev, env, ctx) {
    ctx.waitUntil(Promise.all([vendas(env).catch(() => {}), lembretes(env).catch(() => {})]));
  },
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === '/teste' && env.TESTE_CHAVE && u.searchParams.get('k') === env.TESTE_CHAVE) {
      const r = await enviar(env, null, { title: 'Teste do Portal Aura', body: 'Se você está vendo isto, as notificações estão funcionando.', url: '/' });
      return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Portal Aura · avisos', { status: 200 });
  }
};
