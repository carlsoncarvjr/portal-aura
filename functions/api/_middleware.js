// Antes de qualquer /api/*, carrega a ficha da loja com os ajustes do Painel do dono (KV config:loja).
import { carregarFicha } from '../../lib/loja.js';
export async function onRequest(ctx) {
  await carregarFicha(ctx.env.AVALIACAO);
  return ctx.next();
}
