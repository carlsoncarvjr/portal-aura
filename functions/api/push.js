// Inscrição nas notificações do portal. Guarda a inscrição no KV "AVALIACAO" (chave push:<hash>);
// o Worker "portal-aura-avisos" lê essas inscrições e manda os avisos.
import { sendPush, getVapid } from '../../lib/webpush.js';

const PESSOAS = {
  'carlsoncarvjr@gmail.com': ['Carlson', 'admin'], 'guadariachi0@gmail.com': ['Guadalupe', 'admin'],
  'maikobarreto16@gmail.com': ['Maiko', 'tecnico'], 'gusthavowork@gmail.com': ['Gustavo', 'vendedor'],
  'elisaprettiferrer@icloud.com': ['Elisa', 'vendedor'], 'danilosilvaobl@gmail.com': ['Danilo', 'vendedor'],
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
}
async function chave(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)));
  return 'push:' + [...h.slice(0, 12)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(ctx) {
  const kv = ctx.env.AVALIACAO;
  if (!kv) return json({ erro: 'Armazenamento não configurado.' }, 503);
  if (!PESSOAS[emailDoLogin(ctx.request)]) return json({ erro: 'Usuário não autorizado.' }, 403);
  const v = await getVapid(kv, true);
  return json({ publicKey: v.publicKey });
}

export async function onRequestPost(ctx) {
  const kv = ctx.env.AVALIACAO;
  if (!kv) return json({ erro: 'Armazenamento não configurado.' }, 503);
  const email = emailDoLogin(ctx.request), p = PESSOAS[email];
  if (!p) return json({ erro: 'Usuário não autorizado.' }, 403);
  let body; try { body = await ctx.request.json(); } catch (e) { return json({ erro: 'Pedido inválido.' }, 400); }
  const sub = body.subscription;
  if (!sub || !/^https:\/\//.test(sub.endpoint || '') || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return json({ erro: 'Inscrição inválida.' }, 400);
  const k = await chave(sub.endpoint);
  if (body.sair) { await kv.delete(k); return json({ ok: true, inscrito: false }); }
  await kv.put(k, JSON.stringify({ sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, email, nome: p[0], papel: p[1], em: new Date().toISOString() }));
  let teste = null;
  try {
    const vapid = await getVapid(kv, true);
    const r = await sendPush(sub, { title: 'Notificações ativadas ✅', body: 'Você vai receber os avisos do Portal Aura neste aparelho.', url: '/' }, vapid);
    teste = r.status;
  } catch (e) { teste = 'erro'; }
  return json({ ok: true, inscrito: true, teste });
}

function emailDoLogin(req) {
  const h = req.headers.get('Cf-Access-Authenticated-User-Email');
  if (h) return h.toLowerCase();
  const jwt = req.headers.get('Cf-Access-Jwt-Assertion') ||
    ((req.headers.get('Cookie') || '').match(/CF_Authorization=([^;]+)/) || [])[1];
  if (!jwt) return '';
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(b64)).email || '').toLowerCase();
  } catch (e) { return ''; }
}
