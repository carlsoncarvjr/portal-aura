// Escala e tabela de manutenção que todos do portal leem. Vêm do Painel do dono (KV config:<nome>);
// enquanto o dono não salvar nada, entrega o arquivo do site (escala.json / manutencao.json).
import { pessoa, emailDoLogin } from '../../../lib/loja.js';
const ARQ = { escala: '/escala.json', manutencao: '/manutencao.json' };
export async function onRequestGet(ctx) {
  const nome = String(ctx.params.nome || '');
  if (!ARQ[nome]) return new Response('Não encontrado', { status: 404 });
  if (!pessoa(emailDoLogin(ctx.request))) return new Response('Acesso não autorizado', { status: 403 });
  const h = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' };
  const v = ctx.env.AVALIACAO ? await ctx.env.AVALIACAO.get('config:' + nome) : null;
  if (v) return new Response(v, { headers: h });
  const r = await ctx.env.ASSETS.fetch(new URL(ARQ[nome], ctx.request.url));
  return new Response(r.body, { status: r.status, headers: h });
}
