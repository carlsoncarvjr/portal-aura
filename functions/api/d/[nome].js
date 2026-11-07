// Números do portal calculados pelo serviço "portal-aura-avisos" (sincronização própria com o MercadoPhone).
// Lê do KV (chave calc:<nome>); se ainda não houver, entrega o arquivo estático antigo.
import { podeVer, emailDoLogin } from '../../../lib/loja.js';
const PUBLICOS = { dados: '/dados.json', estoque: '/estoque.json' };

export async function onRequestGet(ctx) {
  const nome = String(ctx.params.nome || '');
  const priv = nome === 'tecnico' || /^vendedor-[a-z]+$/.test(nome);
  if (!PUBLICOS[nome] && !priv) return new Response('Não encontrado', { status: 404 });
  if (priv && !podeVer(nome, emailDoLogin(ctx.request))) return new Response('Acesso não autorizado', { status: 403 });
  const kv = ctx.env.AVALIACAO;
  const v = kv ? await kv.get('calc:' + nome) : null;
  if (v) {
    // O conteúdo só é regravado quando muda; a hora mostrada é a da última sincronização bem-sucedida.
    let corpo = v;
    try { const st = await kv.get('calc:sync', 'json'); if (st && st.ok && st.em) { const o = JSON.parse(v); o.atualizadoEm = st.em; corpo = JSON.stringify(o); } } catch (e) {}
    return new Response(corpo, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Fonte': 'sync' } });
  }
  const r = await ctx.env.ASSETS.fetch(new URL(PUBLICOS[nome] || ('/privado/' + nome + '.json'), ctx.request.url));
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Fonte': 'arquivo' } });
}

