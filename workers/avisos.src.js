// Serviço "portal-aura-avisos" (Cloudflare Worker). Roda a cada 5 min (madrugada: 1 vez por hora):
//  1) sincroniza vendas, OS e estoque direto da API do MercadoPhone (chave MP_API_KEY, somente leitura) e calcula os números do portal;
//  2) manda as notificações (vendas, metas, story, abertura e fechamento).
// Binding: KV AVALIACAO. Segredo: MP_API_KEY. Publicação: node workers/build.mjs gera workers/dist/avisos.js.
import { sendPush } from '../lib/webpush.js';
import { calcularVendas, calcularOS, calcularEstoque, normalizarOS } from '../lib/calc.js';


// ---------- Sincronização com o MercadoPhone ----------
const API = 'https://platform.mercadophone.tech/api/v1';
const GH = 'https://raw.githubusercontent.com/carlsoncarvjr/portal-aura/main/';
const amanhaDe = iso => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

async function mp(env, caminho, params, unidade) {
  const u = new URL(API + caminho);
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, v); });
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const r = await fetch(u, { headers: { 'X-API-Key': env.MP_API_KEY, ...(unidade ? { 'X-Unit-Id': String(unidade) } : {}), Accept: 'application/json' } });
    if (r.status === 429) { const s = Number(r.headers.get('Retry-After') || 5); await new Promise(ok => setTimeout(ok, Math.min(s, 20) * 1000)); continue; }
    if (!r.ok) throw new Error(caminho + ' ' + r.status);
    return r.json();
  }
  throw new Error(caminho + ' limite de pedidos');
}
async function mpTudo(env, caminho, params, unidade) {
  const itens = [];
  for (let page = 1; page < 40; page++) {
    const d = await mp(env, caminho, { ...params, limit: 300, page }, unidade);
    const lista = d.items || d.data || (Array.isArray(d) ? d : []);
    itens.push(...lista);
    if (!lista.length || itens.length >= (d.total ?? itens.length)) break;
  }
  return itens;
}
async function lojas(env) {
  const d = await mp(env, '/stores');
  const lista = d.stores || d.items || d.data || (Array.isArray(d) ? d : []);
  const ids = { meu: null, riachi: null };
  for (const l of lista) { const id = l.system_unit_id ?? l.id; if (/riachi/i.test(l.name || l.nome || '')) ids.riachi = id; else ids.meu = id; }
  return ids;
}
const kvJson = async (env, k) => { try { return await env.AVALIACAO.get(k, 'json'); } catch (e) { return null; } };
// Grava só se o conteúdo mudou (ignorando a hora), para caber no limite diário de gravações do KV.
const semHora = o => JSON.stringify({ ...o, atualizadoEm: null });
async function gravar(env, k, obj) {
  const ant = await kvJson(env, k);
  if (ant && semHora(ant) === semHora(obj)) return false;
  await env.AVALIACAO.put(k, JSON.stringify(obj)); return true;
}
const gh = async f => fetch(GH + f + '?t=' + Date.now(), { cf: { cacheTtl: 0 } }).then(r => r.ok ? r.json() : null).catch(() => null);

async function sincronizar(env, forcar) {
  if (!env.MP_API_KEY) return { ok: false, erro: 'sem chave MP_API_KEY' };
  const t = agoraBahia();
  const noturno = t.min < 8 * 60 || t.min >= 22 * 60;
  if (!forcar && noturno && (t.min % 60) >= 5) return { ok: true, pulou: 'madrugada' };
  const hoje = t.data, amanha = amanhaDe(hoje);
  const ini = [hoje.slice(0, 8) + '01', (() => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((t.dia + 6) % 7)); return d.toISOString().slice(0, 10); })()].sort()[0];
  const agora = hoje + 'T' + String(Math.floor(t.min / 60)).padStart(2, '0') + ':' + String(t.min % 60).padStart(2, '0') + ':00-03:00';
  const ids = await lojas(env);
  const uni = [ids.meu, ids.riachi].filter(x => x != null);
  const erros = [];
  // Vendas
  try {
    const vendas = [];
    for (const u of uni) vendas.push(...await mpTudo(env, '/sales', { dataVendaInicial: ini, dataVendaFinal: amanha }, u));
    const antigo = (await kvJson(env, 'calc:dados')) || (await gh('dados.json')) || {};
    const registro = (await kvJson(env, 'calc:prevendas')) || (await gh('prevendas.json')) || {};
    const r = calcularVendas(vendas, hoje, agora, registro, antigo);
    await gravar(env, 'calc:dados', r.dados);
    await gravar(env, 'calc:prevendas', r.registro);
    for (const [n, c] of Object.entries(r.vendedores)) await gravar(env, 'calc:vendedor-' + n, c);
  } catch (e) { erros.push('vendas: ' + e.message); }
  // Ordens de serviço (detalhe guardado em cache quando a OS já está fechada)
  try {
    const mesIni = hoje.slice(0, 8) + '01', vistas = new Map();
    for (const u of uni) for (const f of [{ dataCriacaoInicial: mesIni, dataCriacaoFinal: amanha }, { dataFinalizacaoInicial: mesIni, dataFinalizacaoFinal: amanha }])
      for (const o of await mpTudo(env, '/service-orders', f, u)) vistas.set(u + ':' + o.id, [u, o]);
    const lista = [];
    for (const [k, [u, o]] of vistas) {
      let n = await kvJson(env, 'os:' + k);
      if (!n) {
        const det = await mp(env, '/service-orders/' + o.id, null, u);
        n = normalizarOS(det);
        if (/finaliz|cancel/i.test(n.situacao)) await env.AVALIACAO.put('os:' + k, JSON.stringify(n), { expirationTtl: 70 * 86400 });
      }
      lista.push(n);
    }
    await gravar(env, 'calc:tecnico', calcularOS(lista, hoje, agora));
  } catch (e) { erros.push('os: ' + e.message); }
  // Estoque (Meu iPhone: só "Em estoque (conferido)" e celulares; Riachi: tudo)
  try {
    const meu = ids.meu != null ? await mpTudo(env, '/inventory', { produtoDisponibilidadeId: 62709, tipoProdutoId: 6235 }, ids.meu) : [];
    const ria = ids.riachi != null ? await mpTudo(env, '/inventory', {}, ids.riachi) : [];
    const est = calcularEstoque(meu, ria, agora);
    if ((meu.length && !est.porUnidade['Meu iPhone']) || (ria.length && !est.porUnidade.Riachi)) erros.push('estoque: unidade zerada, não publicado');
    else await gravar(env, 'calc:estoque', est);
  } catch (e) { erros.push('estoque: ' + e.message); }
  const st = { ok: !erros.length, em: agora, lojas: ids, erros };
  await env.AVALIACAO.put('calc:sync', JSON.stringify(st));
  return st;
}
const MARCOS = [25, 50, 75, 90, 100];
const ESCALA = 'https://raw.githubusercontent.com/carlsoncarvjr/portal-aura/main/escala.json';
const IDEIAS = [
  'Mostre um iPhone da vitrine com o preço e o "chama no direct".',
  'Grave um bastidor rápido da loja ou da equipe atendendo.',
  'Poste um cliente satisfeito com o aparelho novo (com autorização).',
  'Mostre um acessório: capa, película ou carregador, com o valor.',
  'Faça uma enquete: "Qual cor você escolheria?" com dois iPhones.',
  'Mostre um seminovo do estoque com a saúde da bateria.',
  'Lembre que aceitamos o iPhone usado na troca e parcelamos em até 12x.'
];

function agoraBahia() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const dia = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay();
  return { data: p.year + '-' + p.month + '-' + p.day, min: Number(p.hour) * 60 + Number(p.minute), dia };
}

async function inscritos(env) {
  const out = []; let cursor;
  do {
    const r = await env.AVALIACAO.list({ prefix: 'push:', cursor });
    for (const k of r.keys) { const v = await env.AVALIACAO.get(k.name, 'json'); if (v) out.push({ chave: k.name, ...v }); }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

async function enviar(env, papeis, msg, nomes) {
  const v = await env.AVALIACAO.get('vapid:chave', 'json');
  if (!v) return { enviados: 0, total: 0 };
  const vapid = { subject: 'https://portal-aura.pages.dev', privateJwk: v.privateJwk, publicKey: v.publicKey };
  const lista = (await inscritos(env)).filter(i => (!papeis || papeis.includes(i.papel)) && (!nomes || nomes.includes(i.nome)));
  let ok = 0;
  await Promise.all(lista.map(async i => {
    try {
      const r = await sendPush(i.sub, msg, vapid);
      if (r.status === 404 || r.status === 410) await env.AVALIACAO.delete(i.chave);
      else if (r.ok) ok++;
    } catch (e) {}
  }));
  return { enviados: ok, total: lista.length };
}

// Avisos dirigidos (story, abertura, fechamento): manda para quem está no turno e uma cópia para os administradores.
async function enviarComCopia(env, msg, nomes) {
  await enviar(env, ['vendedor'], msg, nomes);
  await enviar(env, ['admin'], { ...msg, title: msg.title + ' · ' + nomes.join(', '), tag: msg.tag + '-adm' });
}

async function vendas(env) {
  const d = (await kvJson(env, 'calc:dados')) || (await gh('dados.json'));
  if (!d || !d.mes) return;
  const ant = await env.AVALIACAO.get('avisos:ultimo', 'json');
  const atual = { atualizadoEm: d.atualizadoEm, rotulo: d.mes.rotulo, iphones: d.mes.iphones, acessorios: d.mes.acessorios,
    vend: Object.fromEntries((d.ranking.mes || []).map(r => [r.vendedor, r.iphones])) };
  if (ant && ant.atualizadoEm === atual.atualizadoEm) return;
  await env.AVALIACAO.put('avisos:ultimo', JSON.stringify(atual));
  if (!ant || ant.rotulo !== atual.rotulo) return;   // primeira vez ou virada do mês: só guarda
  const novos = Object.entries(atual.vend).map(([n, q]) => [n, q - (ant.vend[n] || 0)]).filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
  const meta = d.mes.metaIphones;
  if (novos.length) {
    const quem = novos.map(([n, q]) => n + ' +' + q + (q === 1 ? ' iPhone' : ' iPhones')).join(', ');
    const lider = (d.ranking.mes || []).slice().sort((a, b) => b.iphones - a.iphones)[0];
    await enviar(env, ['vendedor', 'admin'], { title: '📱 Vendas atualizadas', body: quem + '. Loja: ' + atual.iphones + ' de ' + meta + ' iPhones' + (lider ? ' · 1º: ' + lider.vendedor : '') + '.', url: '/#vendas', tag: 'vendas' });
  }
  const pAnt = ant.iphones / meta * 100, pAt = atual.iphones / meta * 100;
  const marco = MARCOS.filter(m => pAnt < m && pAt >= m).pop();
  if (marco) await enviar(env, ['vendedor', 'admin'], { title: marco === 100 ? '🏆 Meta de iPhones batida!' : '🎯 ' + marco + '% da meta de iPhones', body: marco === 100 ? atual.iphones + ' iPhones no mês. Prêmio garantido para a equipe!' : 'A loja chegou a ' + atual.iphones + ' de ' + meta + '. Faltam ' + (meta - atual.iphones) + '.', url: '/#inicio', tag: 'meta' });
}

const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

async function stories(env) {
  const t = agoraBahia();
  const slot = Math.floor(t.min / 30) * 30;
  if (t.min - slot >= 15) return;   // só na primeira rodada de cada meia hora
  const k = 'avisos:story:' + t.data + ':' + slot;
  if (await env.AVALIACAO.get(k)) return;
  const h = await escalaHoje(t);
  if (!h) return;
  const e = h.e, turnos = h.turnos;
  if (slot < hm(e.lojaAbre || '09:00') || slot >= hm(e.lojaFecha || '21:00')) return;
  const nomes = turnos.filter(([, ini, fim]) => slot >= hm(ini) + 30 && slot <= hm(fim) - 30).map(([n]) => n);
  await env.AVALIACAO.put(k, '1', { expirationTtl: 2 * 86400 });
  if (!nomes.length) return;
  const ideia = IDEIAS[(slot / 30) % IDEIAS.length];
  await enviarComCopia(env, { title: '📸 Hora do story no Instagram', body: ideia + ' Poste no @somosaura.ps.', url: 'https://www.instagram.com/somosaura.ps/', tag: 'story' }, nomes);
}

function turnosDoDia(e, data, dia) {
  if (e.datas && e.datas[data]) return e.datas[data];
  let lista = ((e.semana && e.semana[String(dia)]) || []).slice();
  for (const r of e.rodizios || []) {
    if (r.dia !== dia || !r.turnos || !r.turnos.length) continue;
    const sem = Math.round((Date.parse(data + 'T12:00:00Z') - Date.parse(r.ref + 'T12:00:00Z')) / 604800000);
    lista = lista.concat(r.turnos[((sem % r.turnos.length) + r.turnos.length) % r.turnos.length]);
  }
  return lista;
}

async function escalaHoje(t) {
  const e = await fetch(ESCALA + '?t=' + Date.now(), { cf: { cacheTtl: 0 } }).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!e) return null;
  return { e, turnos: turnosDoDia(e, t.data, t.dia) };
}

// Abertura: no início do primeiro turno do dia, para quem abre. Fechamento: 20 min antes de fechar, para quem fecha.
async function lembretes(env) {
  const t = agoraBahia();
  const h = await escalaHoje(t);
  if (!h || !h.turnos.length) return;
  const abre = Math.min(...h.turnos.map(x => hm(x[1]))), fecha = Math.max(...h.turnos.map(x => hm(x[2])));
  const itens = [
    { id: 'abertura', ini: abre, nomes: h.turnos.filter(x => hm(x[1]) === abre).map(x => x[0]), msg: { title: '☀️ Bom dia! Tarefas de abertura', body: 'Pia, chão, lixo e a fila do Kommo. Marque no portal quando terminar.', url: '/#loja', tag: 'tarefas' } },
    { id: 'fechamento', ini: fecha - 20, nomes: h.turnos.filter(x => hm(x[2]) === fecha).map(x => x[0]), msg: { title: '🌙 Tarefas de fechamento', body: 'Pia, chão, lixo e conferir os funis do Kommo antes de sair.', url: '/#loja', tag: 'tarefas' } },
  ];
  for (const it of itens) {
    if (t.min < it.ini || t.min >= it.ini + 15) continue;
    const k = 'avisos:' + it.id + ':' + t.data;
    if (await env.AVALIACAO.get(k)) continue;
    await env.AVALIACAO.put(k, '1', { expirationTtl: 3 * 86400 });
    if (it.nomes.length) await enviarComCopia(env, it.msg, it.nomes);
  }
}

export default {
  async scheduled(ev, env, ctx) {
    ctx.waitUntil((async () => { await sincronizar(env).catch(e => env.AVALIACAO.put('calc:sync', JSON.stringify({ ok: false, erros: [String(e && e.message || e)] }))); await Promise.all([vendas(env).catch(() => {}), lembretes(env).catch(() => {}), stories(env).catch(() => {})]); })());
  },
  async fetch(req, env) {
    const st = await kvJson(env, 'calc:sync');
    return new Response('Portal Aura avisos v5 · última sincronização: ' + (st ? (st.em || '?') + (st.ok ? ' OK' : ' com erros: ' + (st.erros || []).join('; ')) : 'ainda não rodou'), { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
};
