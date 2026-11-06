// Tarefas do dia compartilhadas pela equipe (KV "AVALIACAO", chave por dia no horário da loja).
const NOMES = {
  'carlsoncarvjr@gmail.com': 'Carlson', 'guadariachi0@gmail.com': 'Guadalupe', 'maikobarreto16@gmail.com': 'Maiko',
  'gusthavowork@gmail.com': 'Gustavo', 'elisaprettiferrer@icloud.com': 'Elisa', 'danilosilvaobl@gmail.com': 'Danilo',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
}
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' });
const agora = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' });

export async function onRequestGet(ctx) {
  const kv = ctx.env.AVALIACAO;
  if (!kv) return json({ erro: 'Armazenamento não configurado.' }, 503);
  const d = hoje();
  return json({ data: d, marcas: (await kv.get('tarefas:' + d, 'json')) || {} });
}

export async function onRequestPost(ctx) {
  const kv = ctx.env.AVALIACAO;
  if (!kv) return json({ erro: 'Armazenamento não configurado.' }, 503);
  const email = emailDoLogin(ctx.request);
  if (!NOMES[email]) return json({ erro: 'Usuário não autorizado.' }, 403);
  let body;
  try { body = await ctx.request.json(); } catch (e) { return json({ erro: 'Pedido inválido.' }, 400); }
  const id = String(body.id || '');
  if (!/^t\d{1,2}-\d{1,2}$/.test(id)) return json({ erro: 'Tarefa inválida.' }, 400);
  const d = hoje(), chave = 'tarefas:' + d;
  const marcas = (await kv.get(chave, 'json')) || {};
  if (body.feito) marcas[id] = { por: NOMES[email], hora: agora() }; else delete marcas[id];
  await kv.put(chave, JSON.stringify(marcas), { expirationTtl: 60 * 60 * 24 * 40 });
  return json({ data: d, marcas });
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
