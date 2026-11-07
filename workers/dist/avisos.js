// GERADO por workers/build.mjs — não edite à mão.
// Web Push (RFC 8291 aes128gcm + VAPID RFC 8292) só com WebCrypto.
const te = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const cat = (...a) => { const n = a.reduce((t, x) => t + x.length, 0), o = new Uint8Array(n); let i = 0; a.forEach(x => { o.set(x, i); i += x.length; }); return o; };
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function encrypt(sub, payload) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(te.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function vapidHeader(endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject })));
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + vapid.publicKey;
}
async function sendPush(sub, data, vapid, ttl = 43200) {
  const body = await encrypt(sub, JSON.stringify(data));
  return fetch(sub.endpoint, { method: 'POST', body, headers: {
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal',
    Authorization: await vapidHeader(sub.endpoint, vapid) } });
}
// Par de chaves VAPID guardado no KV (gerado uma vez, no próprio Cloudflare).
async function getVapid(kv, criar) {
  let v = await kv.get('vapid:chave', 'json');
  if (!v && criar) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const j = await crypto.subtle.exportKey('jwk', kp.privateKey);
    v = { publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateJwk: { kty: j.kty, crv: j.crv, x: j.x, y: j.y, d: j.d } };
    await kv.put('vapid:chave', JSON.stringify(v));
  }
  return v ? { subject: 'https://portal-aura.pages.dev', publicKey: v.publicKey, privateJwk: v.privateJwk } : null;
}

// Cálculos do Portal Aura (mesmas regras de scripts/calcular.py, calcular_os.py e estoque.py),
// em JavaScript para rodar no Cloudflare. Funções puras: recebem os dados do MercadoPhone e devolvem os JSONs do portal.

const VENDEDORES = ['Gustavo', 'Danilo', 'Elisa'];
const EXCLUIDOS = ['JBL', 'IPAD', 'MACBOOK', 'MAC ', 'WATCH', 'SERVICO', 'SERVIÇO'];
const STATUS_CONTA = new Set(['concluido', 'orcamento']);
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const FAIXAS_IPHONE = [[12, 16, 10], [17, 24, 15], [25, 28, 20], [29, 32, 25], [33, 36, 30], [37, 42, 35], [43, 1e6, 40]];
const FAIXAS_ACESS = [[3000, 4499.99, 3.0], [4500, 6499.99, 5.0], [6500, 9999.99, 7.5], [10000, 14499.99, 10.0], [14500, 1e12, 12.5]];
const PREMIO_META_IPHONE = 100, PREMIO_META_ACESS = 100, PREMIO_MELHOR = 100;

const r2 = x => Number(Number(x).toFixed(2)) + 0;
function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}
const ehIphone = n => { n = norm(n); return n.startsWith('IPHONE') || n.includes('PREVENDA') || n.includes('PRE-VENDA') || n.includes('PRE VENDA'); };
const ehExcluido = n => { n = norm(n) + ' '; return EXCLUIDOS.some(x => n.includes(x)); };
const title = s => s.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
function vendedor(nome) { const v = String(nome || '').trim().split(/[\s/]+/)[0]; return v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : '—'; }
function nomeIphone(nome) {
  const n = norm(nome);
  if (n.includes('PREVENDA') || n.includes('PRE-VENDA') || n.includes('PRE VENDA')) return 'Pré-venda iPhone';
  let partes = nome.split(' - ').map(p => p.trim()).filter(Boolean).filter(p => norm(p) !== 'APPLE');
  let modelo = (partes[0] || nome);
  modelo = title(modelo).replace(/iphone/gi, 'iPhone');
  const resto = partes.slice(1).map(p => /^\d+\s*(GB|TB)$/.test(p.toUpperCase()) ? p.toUpperCase() : title(p));
  return [modelo, ...resto].join(' ');
}
function nomeAcessorios(nomes) {
  const rot = [];
  for (const nome of nomes) {
    const n = norm(nome); let r;
    if (n.includes('PELICULA')) r = 'Película';
    else if (['CAPA', 'CAPINHA', 'CASE'].some(k => n.includes(k))) r = 'Capinha';
    else if (['CARREGADOR', 'FONTE'].some(k => n.includes(k))) r = 'Carregador';
    else if (n.includes('CABO')) r = 'Cabo';
    else if (n.includes('ECHO')) r = 'Echo Dot';
    else { const s = nome.split(' - ')[0].trim(); r = (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).slice(0, 28); }
    if (!rot.includes(r)) rot.push(r);
  }
  return rot.length ? rot.slice(0, 3).join(' + ') : 'Acessório';
}
const valorIphone = n => { for (const [a, b, v] of FAIXAS_IPHONE) if (a <= n && n <= b) return v; return 0; };
const pctAcess = v => { for (const [a, b, p] of FAIXAS_ACESS) if (a <= v && v <= b) return p; return 0; };

// Datas como texto AAAA-MM-DD (sem fuso).
const dIso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const difDias = (a, b) => Math.round((Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000);

function calcularVendas(vendasLista, hoje, agora, registro = {}, antigo = {}) {
  const [Y, M] = hoje.split('-').map(Number);
  const ontem = addDias(hoje, -1);
  const dow = new Date(hoje + 'T12:00:00Z').getUTCDay();
  const seg = addDias(hoje, -((dow + 6) % 7));
  const iniMes = dIso(Y, M, 1);
  const vendas = Object.values(Object.fromEntries(vendasLista.map(s => [s.id, s])));
  registro = { ...registro };

  const linhas = [];
  for (const s of vendas) {
    const st = String(s.status || '').toLowerCase();
    if (!STATUS_CONTA.has(st)) continue;
    const dv = s.dataVenda.slice(0, 10), sid = String(s.id);
    if (st === 'orcamento' && !(sid in registro)) registro[sid] = dv;
    const dc = [dv, registro[sid] || dv].sort()[0];
    linhas.push([s, st, dc]);
  }
  const chaveCli = s => { const c = String((s.cliente || {}).cpf || '').replace(/\D/g, ''); return c || norm(s.clienteNome); };
  const conclIph = {};
  for (const [s, st, d] of linhas) if (st === 'concluido' && (s.itens || []).some(i => ehIphone(i.produtoNome))) (conclIph[chaveCli(s)] ||= []).push(d);
  const filtradas = linhas.filter(([s, st, d]) => {
    if (st === 'orcamento' && norm(s.clienteNome) !== 'CLIENTE PASSANTE') {
      const ds = conclIph[chaveCli(s)] || [];
      if (ds.some(x => Math.abs(difDias(x, d)) <= 45) && (s.itens || []).some(i => ehIphone(i.produtoNome))) return false;
    }
    return true;
  });
  const vistos = new Set(), ok = [];
  for (const [s, st, d] of filtradas.slice().sort((a, b) => a[0].dataVenda < b[0].dataVenda ? -1 : a[0].dataVenda > b[0].dataVenda ? 1 : 0)) {
    let iph = 0, acc = 0, jbl = 0; const nAcc = [], nIph = [];
    for (const i of s.itens || []) {
      const nome = i.produtoNome, k = chaveCli(s) + '|' + norm(nome) + '|' + d;
      if (vistos.has(k) && norm(s.clienteNome) !== 'CLIENTE PASSANTE') continue;
      vistos.add(k);
      const q = i.quantidade || 1;
      if (ehIphone(nome)) { iph += q; nIph.push(nome); }
      else if (norm(nome).includes('JBL')) jbl += q;
      else if (!ehExcluido(nome)) { acc += (i.valorUnitario || 0) * q; nAcc.push(nome); }
    }
    if (!iph && !acc && !jbl) continue;
    ok.push({ data: d, hora: s.dataVenda.slice(0, 10) === d ? s.dataVenda.slice(11, 16) : '—', vendedor: vendedor(s.vendedorNome),
      iphones: iph, acessorios: acc, pre: st === 'orcamento', jbl,
      produto: nIph.length ? nomeIphone(nIph[0]) + (iph > 1 ? ` (+${iph - 1})` : '') : nomeAcessorios(nAcc), tipo: iph ? 'iphone' : 'acessorio' });
  }
  const dia_ = ok.filter(v => v.iphones || v.acessorios);
  const periodo = (a, b, todas) => (todas ? ok : dia_).filter(v => a <= v.data && v.data <= b);
  const dia = d => { const vs = periodo(d, d).sort((a, b) => a.hora < b.hora ? -1 : a.hora > b.hora ? 1 : 0); return { data: d, iphones: vs.reduce((t, v) => t + v.iphones, 0), acessorios: r2(vs.reduce((t, v) => t + v.acessorios, 0)),
    itens: vs.map(v => ({ hora: v.hora, tipo: v.tipo, produto: v.produto, vendedor: v.vendedor, ...(v.pre ? { pre: true } : {}) })) }; };
  const ranking = vs => { const r = {}; for (const v of vs) { if (!VENDEDORES.includes(v.vendedor)) continue; const x = r[v.vendedor] ||= { vendedor: v.vendedor, iphones: 0, acessorios: 0, vendas: 0 }; x.iphones += v.iphones; x.acessorios += v.acessorios; x.vendas++; }
    const out = Object.values(r).sort((a, b) => b.iphones - a.iphones || b.acessorios - a.acessorios); out.forEach(x => { x.acessorios = r2(x.acessorios); }); return out; };
  const mesVs = periodo(iniMes, hoje);
  const am = antigo.mes || {};
  const dados = { atualizadoEm: agora,
    mes: { rotulo: `${MESES[M - 1]} ${Y}`, ano: Y, mes: M, diasNoMes: new Date(Date.UTC(Y, M, 0)).getUTCDate(),
      metaIphones: am.metaIphones || 110, metaAcessorios: am.metaAcessorios || 25000,
      iphones: mesVs.reduce((t, v) => t + v.iphones, 0), acessorios: r2(mesVs.reduce((t, v) => t + v.acessorios, 0)) },
    hoje: dia(hoje), ontem: dia(ontem),
    ranking: { mes: ranking(mesVs), semana: ranking(periodo(seg, hoje)), hoje: ranking(periodo(hoje, hoje)) } };
  const vendedores = comissoes(dados, periodo(iniMes, hoje, true), agora);
  const corte = addDias(hoje, -120);
  const reg = Object.fromEntries(Object.entries(registro).filter(([, v]) => v >= corte).sort());
  return { dados, vendedores, registro: reg, preVendasMes: mesVs.filter(v => v.pre).length };
}

function comissoes(dados, vendasMes, agora) {
  const m = dados.mes, lojaI = m.iphones, lojaA = m.acessorios, rk = dados.ranking.mes, out = {};
  for (const nome of VENDEDORES) {
    const vs = vendasMes.filter(v => v.vendedor === nome);
    const iph = vs.reduce((t, v) => t + v.iphones, 0), jbl = vs.reduce((t, v) => t + (v.jbl || 0), 0), acc = r2(vs.reduce((t, v) => t + v.acessorios, 0));
    const vi = valorIphone(iph), proxI = FAIXAS_IPHONE.find(([a]) => a > iph), pa = pctAcess(acc), proxA = FAIXAS_ACESS.find(([a]) => a > acc);
    const pos = rk.findIndex(r => r.vendedor === nome); const bateI = lojaI >= m.metaIphones, bateA = lojaA >= m.metaAcessorios;
    const comI = (iph + jbl) * vi, comA = r2(acc * pa / 100), premios = (bateI ? PREMIO_META_IPHONE : 0) + (bateA ? PREMIO_META_ACESS : 0);
    out[norm(nome).toLowerCase()] = { atualizadoEm: agora, mes: m.rotulo, vendedor: nome, iphones: iph, jbl, valorPorIphone: vi,
      proximaFaixaIphone: proxI ? { aPartirDe: proxI[0], valor: proxI[2], faltam: proxI[0] - iph } : null, comissaoIphones: comI,
      acessorios: acc, pctAcessorios: pa, proximaFaixaAcessorios: proxA ? { aPartirDe: proxA[0], pct: proxA[2], faltam: r2(proxA[0] - acc) } : null,
      comissaoAcessorios: comA,
      premios: { metaIphones: { valor: PREMIO_META_IPHONE, loja: lojaI, meta: m.metaIphones, batida: bateI }, metaAcessorios: { valor: PREMIO_META_ACESS, loja: lojaA, meta: m.metaAcessorios, batida: bateA },
        melhorVendedor: { valor: PREMIO_MELHOR, posicao: pos >= 0 ? pos + 1 : null } },
      total: r2(comI + comA + premios),
      faixasIphone: FAIXAS_IPHONE.map(([a, b, v]) => ({ de: a, ate: b < 1e6 ? b : null, valor: v })),
      faixasAcessorios: FAIXAS_ACESS.map(([a, b, p]) => ({ de: a, ate: b < 1e12 ? b : null, pct: p })),
      vendas: vs.slice().sort((a, b) => (b.data + b.hora) < (a.data + a.hora) ? -1 : (b.data + b.hora) > (a.data + a.hora) ? 1 : 0).map(v => ({ data: v.data,
        produto: v.produto + (v.jbl && v.produto ? ' + JBL' : (v.jbl ? 'JBL' : '')), tipo: v.tipo, valor: r2(v.acessorios), iphones: v.iphones, ...(v.pre ? { pre: true } : {}) })) };
  }
  return out;
}

// ---------- Assistência (técnico) ----------
const FAIXAS_OS = [[1, 6, 25], [7, 12, 30], [13, 19, 35], [20, 1e6, 40]];
const pctOS = n => { for (const [a, b, p] of FAIXAS_OS) if (a <= n && n <= b) return p; return 40; };
function calcularOS(lista, hoje, agora) {
  const mes = hoje.slice(0, 7); const oss = [];
  for (const o of lista) {
    const sit = norm(o.situacao), tipo = norm(o.tipo), valor = Number(o.valor || 0);
    const lucro = r2(valor - Number(o.pecas || 0) - Number(o.terceirizada || 0));
    let motivo = null;
    if (sit.includes('CANCEL')) continue;
    if (tipo.includes('GARANTIA')) motivo = 'Garantia';
    else if (tipo.includes('MANUTENCAO') || tipo.includes('UPGRADE') || tipo.includes('INTERN')) motivo = 'Interna';
    else if (!sit.includes('FINALIZ')) motivo = null;
    else if (valor < 150) motivo = 'Abaixo de R$ 150';
    else if ((o.data || '').slice(0, 7) !== mes) continue;
    const conta = motivo === null && sit.includes('FINALIZ');
    oss.push({ codigo: o.codigo, data: o.data, aparelho: o.aparelho || '', servico: o.servico || '', situacao: o.situacao || '', valor: r2(valor),
      pecas: r2(Number(o.pecas || 0) + Number(o.terceirizada || 0)), lucro: conta ? lucro : null, conta, motivo });
  }
  const ord = (a, b) => ((a.data || '') + String(a.codigo)).localeCompare((b.data || '') + String(b.codigo));
  const contam = oss.filter(o => o.conta).sort(ord);
  let comF = 0; contam.forEach((o, i) => { o.pct = pctOS(i + 1); comF += o.lucro * o.pct / 100; });
  const n = contam.length, lucroT = r2(contam.reduce((t, o) => t + o.lucro, 0));
  const garantia = ['2026-11', '2026-12'].includes(mes) ? r2(lucroT * 0.30) : null;
  const com = Math.max(comF, garantia || 0), prox = FAIXAS_OS.find(([a]) => a > n);
  return { atualizadoEm: agora, mes: `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`, meta: 15, servicos: n, faixaAtual: n ? pctOS(n) : 25,
    proxima: prox ? { pct: prox[2], faltam: prox[0] - n } : null, lucro: lucroT, comissaoFaixas: r2(comF), comissaoGarantia: garantia,
    comissao: r2(com), garantiaAplicada: !!(garantia && garantia > comF), os: oss.sort(ord).reverse() };
}

// Normaliza o detalhe de uma OS do MercadoPhone para o formato acima (sem dados do cliente).
function normalizarOS(o) {
  const fin = o.dataFinalizacao || null, sit = o.situacaoDescricao || '';
  const pagos = (o.financeiros || []).reduce((t, f) => t + (f.pagamentos || []).reduce((u, p) => u + Number(p.valorPagamento || 0), 0), 0);
  const custoServ = (o.servicos || []).reduce((t, s) => t + Number(s.valorCusto || 0) * Number(s.quantidade || 1), 0);
  const custoProd = (o.produtos || []).reduce((t, p) => t + Number(p.valorCusto || p.custo || 0) * Number(p.quantidade || 1), 0);
  const ap = ((o.aparelhos || [])[0] || {}).descricao || '';
  const servico = (o.servicos || []).map(s => s.servicoDescricao).filter(Boolean).join(' + ') || o.solucao || o.diagnostico || o.defeito || '';
  return { codigo: o.codigo || o.id, data: String(fin && /finaliz/i.test(sit) ? fin : (o.dataCriacao || '')).slice(0, 10),
    aparelho: title(ap).replace(/iphone/gi, 'iPhone'), servico: servico.charAt(0).toUpperCase() + servico.slice(1).toLowerCase(),
    situacao: sit, tipo: (o.tipoDescricao || '').trim(), valor: pagos || Number(o.valorTotal || 0), pecas: custoServ + custoProd, terceirizada: 0 };
}

// ---------- Estoque ----------
function modeloEst(i) {
  let m = String(i.aparelhoDescricao || '').trim();
  if (!m) { const d = i.descricao || ''; m = d.includes(' - ') ? d.split(' - ')[1] : 'Aparelho'; }
  m = title(m).replace(/\biphone\b/gi, 'iPhone').replace(/\bse\b/gi, 'SE').replace(/\bxr\b/gi, 'XR').replace(/\bxs\b/gi, 'XS').replace(/(\d+)E\b/g, '$1e');
  return m;
}
function memEst(i) { let g = String(i.gbDescricao || '').toUpperCase().replace(/ /g, ''); if (!g) { const mt = String(i.descricao || '').toUpperCase().match(/(\d+)\s*(GB|TB)/); g = mt ? mt[1] + mt[2] : ''; } return g; }
function calcularEstoque(meu, riachi, agora) {
  const saida = [];
  for (const [unidade, lista, soConf] of [['Meu iPhone', meu, true], ['Riachi', riachi, false]]) {
    const vistos = new Set();
    for (const i of lista) {
      if (vistos.has(i.id)) continue; vistos.add(i.id);
      if ((i.quantidade || 0) <= 0 || i.excluido) continue;
      const t = norm(i.tipoProdutoDescricao);
      if (!(t.includes('CELULAR') || norm(i.aparelhoDescricao).startsWith('IPHONE'))) continue;
      if (soConf && !['ESTOQUE ATUALIZADO', 'EM ESTOQUE (CONFERIDO)'].includes(norm(i.disponibilidade))) continue;
      const c = String(i.corDescricao || '').trim();
      saida.push({ modelo: modeloEst(i), memoria: memEst(i), cor: c ? title(c) : '', imei: i.imei || i.serialNumber || '', bateria: i.saudeBateria ?? null, unidade });
    }
  }
  const chave = x => { const nums = x.modelo.match(/\d+/); const ger = nums ? Number(nums[0]) : 0; const gb = Number(x.memoria.replace(/\D/g, '') || 0) * (x.memoria.includes('TB') ? 1024 : 1); return [-ger, x.modelo, gb, x.cor]; };
  saida.sort((a, b) => { const ka = chave(a), kb = chave(b); for (let k = 0; k < 4; k++) { if (ka[k] < kb[k]) return -1; if (ka[k] > kb[k]) return 1; } return 0; });
  return { atualizadoEm: agora, total: saida.length, porUnidade: { 'Meu iPhone': saida.filter(x => x.unidade === 'Meu iPhone').length, Riachi: saida.filter(x => x.unidade === 'Riachi').length }, itens: saida };
}

// Serviço "portal-aura-avisos" (Cloudflare Worker). Roda a cada 15 min:
//  1) sincroniza vendas, OS e estoque direto da API do MercadoPhone (chave MP_API_KEY, somente leitura) e calcula os números do portal;
//  2) manda as notificações (vendas, metas, story, abertura e fechamento).
// Binding: KV AVALIACAO. Segredo: MP_API_KEY. Publicação: node workers/build.mjs gera workers/dist/avisos.js.




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
const gh = async f => fetch(GH + f + '?t=' + Date.now(), { cf: { cacheTtl: 0 } }).then(r => r.ok ? r.json() : null).catch(() => null);

async function sincronizar(env, forcar) {
  if (!env.MP_API_KEY) return { ok: false, erro: 'sem chave MP_API_KEY' };
  const t = agoraBahia();
  const noturno = t.min < 8 * 60 || t.min >= 22 * 60;
  if (!forcar && noturno && (t.min % 60) >= 15) return { ok: true, pulou: 'madrugada' };
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
    await env.AVALIACAO.put('calc:dados', JSON.stringify(r.dados));
    await env.AVALIACAO.put('calc:prevendas', JSON.stringify(r.registro));
    for (const [n, c] of Object.entries(r.vendedores)) await env.AVALIACAO.put('calc:vendedor-' + n, JSON.stringify(c));
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
    await env.AVALIACAO.put('calc:tecnico', JSON.stringify(calcularOS(lista, hoje, agora)));
  } catch (e) { erros.push('os: ' + e.message); }
  // Estoque (Meu iPhone: só "Em estoque (conferido)" e celulares; Riachi: tudo)
  try {
    const meu = ids.meu != null ? await mpTudo(env, '/inventory', { produtoDisponibilidadeId: 62709, tipoProdutoId: 6235 }, ids.meu) : [];
    const ria = ids.riachi != null ? await mpTudo(env, '/inventory', {}, ids.riachi) : [];
    const est = calcularEstoque(meu, ria, agora);
    if ((meu.length && !est.porUnidade['Meu iPhone']) || (ria.length && !est.porUnidade.Riachi)) erros.push('estoque: unidade zerada, não publicado');
    else await env.AVALIACAO.put('calc:estoque', JSON.stringify(est));
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
