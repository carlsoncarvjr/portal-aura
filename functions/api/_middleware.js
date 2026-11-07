// Antes de qualquer /api/*, carrega a ficha da loja com os ajustes do Painel do dono (KV config:loja)
// e barra quem não está na equipe (mesmo que ainda tenha uma sessão antiga do login).
import { carregarFicha, pessoa, emailDoLogin } from '../../lib/loja.js';
export async function onRequest(ctx) {
  await carregarFicha(ctx.env.AVALIACAO);
  if (!pessoa(emailDoLogin(ctx.request))) return new Response(JSON.stringify({ erro: 'Usuário não autorizado.' }), { status: 403, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  return ctx.next();
}
