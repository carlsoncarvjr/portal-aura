// Ajustes manuais da Tabela de avaliação, guardados no KV "AVALIACAO" (compartilhados pela equipe).
// GET: todos logados leem. POST: só administradores ajustam.
import { admins, emailDoLogin } from '../../lib/loja.js';
const CHAVE = 'ajustes';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
}

async function base(ctx) {
  // Ponto de partida: ajustes que já estavam na tabela (avaliacao.json).
  const r = await ctx.env.ASSETS.fetch(new URL('/avaliacao.json', ctx.request.url));
  const d = await r.json();
  const ajustes = {};
  (d.itens || []).forEach(x => { if (x.override != null) ajustes[x.modelo + '|' + x.cap] = x.override; });
  return { ajustes, editadoEm: d.ajusteManualEm || null, por: null };
}

async function ler(ctx) {
  const kv = ctx.env.AVALIACAO;
  const salvo = kv ? await kv.get(CHAVE, 'json') : null;
  return salvo || await base(ctx);
}

export async function onRequestGet(ctx) {
  const email = emailDoLogin(ctx.request);
  const d = await ler(ctx);
  return json({ ...d, podeEditar: admins().includes(email) && !!ctx.env.AVALIACAO });
}

export async function onRequestPost(ctx) {
  const email = emailDoLogin(ctx.request);
  if (!admins().includes(email)) return json({ erro: 'Só administradores ajustam a tabela.' }, 403);
  if (!ctx.env.AVALIACAO) return json({ erro: 'Armazenamento não configurado.' }, 503);
  let body;
  try { body = await ctx.request.json(); } catch (e) { return json({ erro: 'Pedido inválido.' }, 400); }
  const chave = String(body.chave || '');
  if (!/^IPHONE [A-Z0-9 ]+\|\d+(GB|TB)$/.test(chave)) return json({ erro: 'Linha inválida.' }, 400);
  const d = await ler(ctx);
  const v = body.valor == null || body.valor === '' ? null : Math.round(Number(body.valor));
  if (v === null) delete d.ajustes[chave];
  else if (v > 0 && v < 100000) d.ajustes[chave] = v;
  else return json({ erro: 'Valor inválido.' }, 400);
  d.editadoEm = new Date().toISOString();
  d.por = email;
  await ctx.env.AVALIACAO.put(CHAVE, JSON.stringify(d));
  return json({ ...d, podeEditar: true });
}

