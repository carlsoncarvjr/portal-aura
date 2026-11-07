// Arquivos em /privado/ só são entregues para o dono do arquivo e os administradores (ficha em config/loja.js).
import { podeVer, emailDoLogin } from '../../lib/loja.js';

export async function onRequest(ctx) {
  const nome = new URL(ctx.request.url).pathname.split('/').pop().replace(/\.json$/, '');
  if (!podeVer(nome, emailDoLogin(ctx.request))) return new Response('Acesso não autorizado', { status: 403 });
  const resp = await ctx.next();
  const r = new Response(resp.body, resp);
  r.headers.set('Cache-Control', 'private, no-store');
  return r;
}
