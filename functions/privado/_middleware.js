// Arquivos em /privado/ só são entregues para os e-mails autorizados de cada arquivo.
// O Cloudflare Access coloca o e-mail de quem fez login no cabeçalho abaixo.
const ADMIN = ['carlsoncarvjr@gmail.com', 'guadariachi0@gmail.com'];
const PERMISSOES = {
  'tecnico.json': ['maikobarreto16@gmail.com', ...ADMIN],
};

export async function onRequest(ctx) {
  const email = emailDoLogin(ctx.request);
  const arquivo = new URL(ctx.request.url).pathname.split('/').pop();
  if (!(PERMISSOES[arquivo] || []).includes(email)) {
    return new Response('Acesso não autorizado', { status: 403 });
  }
  const resp = await ctx.next();
  const r = new Response(resp.body, resp);
  r.headers.set('Cache-Control', 'private, no-store');
  return r;
}

// E-mail de quem fez login: cabeçalho do Access ou, se faltar, o token do Access (já validado na borda).
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
