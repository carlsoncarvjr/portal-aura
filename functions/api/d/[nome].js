// Números do portal calculados pelo serviço "portal-aura-avisos" (sincronização própria com o MercadoPhone).
// Lê do KV (chave calc:<nome>); se ainda não houver, entrega o arquivo estático antigo.
const ADMIN = ['carlsoncarvjr@gmail.com', 'guadariachi0@gmail.com'];
const PUBLICOS = { dados: '/dados.json', estoque: '/estoque.json' };
const PRIVADOS = {
  tecnico: ['maikobarreto16@gmail.com', ...ADMIN],
  'vendedor-gustavo': ['gusthavowork@gmail.com', ...ADMIN],
  'vendedor-elisa': ['elisaprettiferrer@icloud.com', ...ADMIN],
  'vendedor-danilo': ['danilosilvaobl@gmail.com', ...ADMIN],
};

export async function onRequestGet(ctx) {
  const nome = String(ctx.params.nome || '');
  const priv = PRIVADOS[nome];
  if (!PUBLICOS[nome] && !priv) return new Response('Não encontrado', { status: 404 });
  if (priv && !priv.includes(emailDoLogin(ctx.request))) return new Response('Acesso não autorizado', { status: 403 });
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
