// Quem está logado: nome, papel e arquivo de comissão (só os dados da própria pessoa).
import loja, { pessoa, emailDoLogin } from '../../lib/loja.js';
export async function onRequestGet(ctx) {
  const p = pessoa(emailDoLogin(ctx.request));
  const corpo = { loja: { nome: loja.nome, instagram: loja.instagram }, pessoa: p ? { nome: p.nome, papel: p.papel, arq: p.arq || null } : null };
  return new Response(JSON.stringify(corpo), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
}
