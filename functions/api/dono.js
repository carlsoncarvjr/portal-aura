// Painel do dono: só administradores. Lê e salva equipe, metas e comissões, assistência, escala e manutenção.
// Tudo fica no KV (config:loja, config:escala, config:manutencao); o código e o site não mudam.
import loja, { admins, emailDoLogin } from '../../lib/loja.js';
import { fichaPadrao, validarSecao, SECOES_FICHA } from '../../lib/ficha.js';
import { sincronizarLogin } from '../../lib/acesso.js';

const ARQ = { escala: '/escala.json', manutencao: '/manutencao.json' };
const SECOES = [...SECOES_FICHA, 'escala', 'manutencao'];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });

async function arquivo(ctx, nome) {
  const r = await ctx.env.ASSETS.fetch(new URL(ARQ[nome], ctx.request.url));
  const d = await r.json(); delete d._comoUsar; return d;
}
async function atual(ctx, nome) {
  return (await ctx.env.AVALIACAO.get('config:' + nome, 'json')) || await arquivo(ctx, nome);
}
async function tudo(ctx) {
  const kv = ctx.env.AVALIACAO;
  const [ajustes, escala, manutencao, historico] = await Promise.all([
    kv.get('config:loja', 'json'), atual(ctx, 'escala'), atual(ctx, 'manutencao'), kv.get('config:historico', 'json')]);
  const desfazer = {};
  await Promise.all(SECOES.map(async s => { desfazer[s] = !!(await kv.get('config:anterior:' + s)); }));
  return {
    ficha: Object.fromEntries(SECOES_FICHA.map(k => [k, loja[k]])),
    padrao: fichaPadrao(), personalizado: Object.fromEntries(SECOES.map(s => [s, s === 'escala' || s === 'manutencao' ? null : !!(ajustes && ajustes[s])])),
    escala, manutencao, historico: historico || [], desfazer,
  };
}

function guarda(ctx) {
  const email = emailDoLogin(ctx.request);
  if (!admins().includes(email)) return [null, json({ erro: 'Só administradores abrem o Painel do dono.' }, 403)];
  if (!ctx.env.AVALIACAO) return [null, json({ erro: 'Armazenamento não configurado.' }, 503)];
  return [email, null];
}

export async function onRequestGet(ctx) {
  const [, erro] = guarda(ctx); if (erro) return erro;
  return json(await tudo(ctx));
}

// POST { secao, dados }            → salva
// POST { secao, acao: 'desfazer' } → volta para a versão anterior
// POST { secao, acao: 'padrao' }   → volta para o valor de fábrica (config/loja.js ou arquivo do site)
export async function onRequestPost(ctx) {
  const [email, erro] = guarda(ctx); if (erro) return erro;
  const kv = ctx.env.AVALIACAO;
  let body; try { body = await ctx.request.json(); } catch (e) { return json({ erro: 'Pedido inválido.' }, 400); }
  const secao = String(body.secao || '');
  if (!SECOES.includes(secao)) return json({ erro: 'Parte desconhecida.' }, 400);
  const naFicha = SECOES_FICHA.includes(secao);
  const ler = async () => naFicha ? ((await kv.get('config:loja', 'json')) || {})[secao] || null : await kv.get('config:' + secao, 'json');
  const escrever = async v => {
    if (naFicha) { const aj = (await kv.get('config:loja', 'json')) || {}; if (v == null) delete aj[secao]; else aj[secao] = v; await kv.put('config:loja', JSON.stringify(aj)); }
    else if (v == null) await kv.delete('config:' + secao); else await kv.put('config:' + secao, JSON.stringify(v));
  };
  let novo, acao = body.acao || 'salvar';
  try {
    if (acao === 'desfazer') {
      const ant = await kv.get('config:anterior:' + secao, 'json');
      if (!ant) return json({ erro: 'Não há alteração para desfazer.' }, 400);
      novo = ant.v;
      if (secao === 'pessoas' && novo && !novo.some(p => p.email === email && p.papel === 'admin')) throw new Error('Desfazer tiraria o seu acesso de administrador.');
    } else if (acao === 'padrao') {
      novo = null;
      if (secao === 'pessoas' && !fichaPadrao().pessoas.some(p => p.email === email && p.papel === 'admin')) throw new Error('Voltar ao padrão tiraria o seu acesso de administrador.');
    } else novo = validarSecao(secao, body.dados, email);
  } catch (e) { return json({ erro: e.message }, 400); }

  const antes = await ler();
  await escrever(novo);
  if (acao === 'desfazer') await kv.delete('config:anterior:' + secao);
  else await kv.put('config:anterior:' + secao, JSON.stringify({ v: antes, em: new Date().toISOString() }));
  const hist = (await kv.get('config:historico', 'json')) || [];
  const nomeQuem = (loja.pessoas.find(p => p.email === email) || {}).nome || email;
  hist.unshift({ em: new Date().toISOString(), por: nomeQuem, secao, acao });
  await kv.put('config:historico', JSON.stringify(hist.slice(0, 40)));
  if (naFicha) { const aj = (await kv.get('config:loja', 'json')) || {}; for (const k of SECOES_FICHA) loja[k] = aj[k] ? JSON.parse(JSON.stringify(aj[k])) : fichaPadrao()[k]; }
  const login = secao === 'pessoas' ? await sincronizarLogin(ctx.env, loja.pessoas) : null;
  return json({ ok: true, login, ...(await tudo(ctx)) });
}
