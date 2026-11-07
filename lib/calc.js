// Cálculos do Portal Aura (mesmas regras de scripts/calcular.py, calcular_os.py e estoque.py),
// em JavaScript para rodar no Cloudflare. Funções puras: recebem os dados do MercadoPhone e devolvem os JSONs do portal.

export const VENDEDORES = ['Gustavo', 'Danilo', 'Elisa'];
const EXCLUIDOS = ['JBL', 'IPAD', 'MACBOOK', 'MAC ', 'WATCH', 'SERVICO', 'SERVIÇO'];
const STATUS_CONTA = new Set(['concluido', 'orcamento']);
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const FAIXAS_IPHONE = [[12, 16, 10], [17, 24, 15], [25, 28, 20], [29, 32, 25], [33, 36, 30], [37, 42, 35], [43, 1e6, 40]];
const FAIXAS_ACESS = [[3000, 4499.99, 3.0], [4500, 6499.99, 5.0], [6500, 9999.99, 7.5], [10000, 14499.99, 10.0], [14500, 1e12, 12.5]];
const PREMIO_META_IPHONE = 100, PREMIO_META_ACESS = 100, PREMIO_MELHOR = 100;

const r2 = x => Number(Number(x).toFixed(2)) + 0;
export function norm(s) {
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

export function calcularVendas(vendasLista, hoje, agora, registro = {}, antigo = {}) {
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
export function calcularOS(lista, hoje, agora) {
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
export function normalizarOS(o) {
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
export function calcularEstoque(meu, riachi, agora) {
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
