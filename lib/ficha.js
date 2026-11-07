// Ficha da loja com os ajustes feitos no Painel do dono.
// config/loja.js tem os valores de fábrica; o que o dono muda no painel fica no KV (chave config:loja)
// e passa por cima, sem precisar mexer no código.
import loja from '../config/loja.js';

const copia = o => JSON.parse(JSON.stringify(o));
const PADRAO_FICHA = copia(loja);
export const SECOES_FICHA = ['pessoas', 'vendas', 'assistencia'];

// Carrega os ajustes do KV para dentro da ficha (o objeto "loja" é o mesmo usado pelos cálculos).
export async function carregarFicha(kv) {
  let aj = null;
  try { aj = kv ? await kv.get('config:loja', 'json') : null; } catch (e) { aj = null; }
  for (const k of SECOES_FICHA) loja[k] = copia((aj && aj[k]) || PADRAO_FICHA[k]);
  return loja;
}
export const fichaPadrao = () => copia(PADRAO_FICHA);

const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const arqDoNome = nome => sem(nome).toLowerCase().replace(/[^a-z]/g, '');
const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? n : null; };

// Faixas: lista de [de, até, valor], em ordem, sem buracos. "até" vazio = sem limite.
function faixas(lista, maxValor, nome, inteiro) {
  if (!Array.isArray(lista) || !lista.length || lista.length > 20) throw new Error('Confira as faixas de ' + nome + '.');
  const out = lista.map((f, i) => {
    const a = num(f[0], 0, 1e9), v = num(f[2], 0, maxValor);
    const b = f[1] === '' || f[1] == null || Number(f[1]) >= 1e6 ? (inteiro ? 1e6 : 1e12) : num(f[1], 0, 1e9);
    if (a == null || b == null || v == null || b < a) throw new Error('Faixa ' + (i + 1) + ' de ' + nome + ' está incompleta ou com "até" menor que "de".');
    return [a, b, v];
  });
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1][1] >= 1e6) throw new Error('Em ' + nome + ', só a última faixa pode ficar sem limite.');
    if (out[i][0] <= out[i - 1][1]) throw new Error('As faixas de ' + nome + ' se sobrepõem (faixa ' + (i + 1) + ').');
  }
  return out;
}

// Confere e limpa cada parte que o painel salva. Lança erro com mensagem amigável quando algo está errado.
export function validarSecao(secao, d, quem) {
  if (secao === 'pessoas') {
    if (!Array.isArray(d) || !d.length || d.length > 40) throw new Error('Lista da equipe inválida.');
    const vistos = new Set();
    const out = d.map((p, i) => {
      const email = String(p.email || '').trim().toLowerCase(), nome = String(p.nome || '').trim().replace(/\s+/g, ' ');
      const papel = ['admin', 'vendedor', 'tecnico'].includes(p.papel) ? p.papel : null;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido na linha ' + (i + 1) + '.');
      if (!nome || nome.length > 30) throw new Error('Falta o nome na linha ' + (i + 1) + '.');
      if (!papel) throw new Error('Escolha a função de ' + nome + '.');
      if (vistos.has(email)) throw new Error('O e-mail ' + email + ' aparece duas vezes.');
      vistos.add(email);
      const o = { email, nome, papel };
      if (papel === 'vendedor') {
        o.arq = arqDoNome(nome.split(' ')[0]);
        if (!o.arq) throw new Error('Use um nome com letras para ' + nome + '.');
        o.nome = nome.split(' ')[0];
      }
      return o;
    });
    const arqs = out.filter(p => p.arq).map(p => p.arq);
    if (new Set(arqs).size !== arqs.length) throw new Error('Dois vendedores com o mesmo primeiro nome. O nome precisa ser igual ao do MercadoPhone e único.');
    if (!out.some(p => p.papel === 'admin')) throw new Error('A equipe precisa de pelo menos um administrador.');
    if (quem && !out.some(p => p.email === quem && p.papel === 'admin')) throw new Error('Você não pode tirar o seu próprio acesso de administrador.');
    return out;
  }
  if (secao === 'vendas') {
    const p = d.premios || {};
    const o = {
      excluidos: PADRAO_FICHA.vendas.excluidos,
      metaIphones: num(d.metaIphones, 1, 100000), metaAcessorios: num(d.metaAcessorios, 1, 1e8),
      faixasIphone: faixas(d.faixasIphone, 100000, 'iPhones', true),
      faixasAcessorios: faixas(d.faixasAcessorios, 100, 'acessórios', false),
      premios: { metaIphones: num(p.metaIphones, 0, 1e6), metaAcessorios: num(p.metaAcessorios, 0, 1e6), melhorVendedor: num(p.melhorVendedor, 0, 1e6) },
    };
    if (o.metaIphones == null || o.metaAcessorios == null) throw new Error('Confira as metas do mês.');
    if (Object.values(o.premios).some(v => v == null)) throw new Error('Confira os valores dos prêmios.');
    o.metaIphones = Math.round(o.metaIphones);
    return o;
  }
  if (secao === 'assistencia') {
    const o = {
      faixas: faixas(d.faixas, 100, 'assistência', true),
      meta: num(d.meta, 1, 10000), valorMinimo: num(d.valorMinimo, 0, 1e6),
      garantia30: (Array.isArray(d.garantia30) ? d.garantia30 : []).map(String).filter(m => /^\d{4}-\d{2}$/.test(m)).slice(0, 24),
    };
    if (o.meta == null || o.valorMinimo == null) throw new Error('Confira a meta e o valor mínimo da assistência.');
    return o;
  }
  if (secao === 'escala') {
    const hh = h => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ''));
    const turnos = (l, onde) => (Array.isArray(l) ? l : []).map(t => {
      if (!Array.isArray(t) || !String(t[0] || '').trim() || !hh(t[1]) || !hh(t[2]) || t[2] <= t[1]) throw new Error('Confira o turno em ' + onde + ' (nome, entrada e saída).');
      return [String(t[0]).trim(), t[1], t[2]];
    });
    const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    if (!hh(d.lojaAbre) || !hh(d.lojaFecha) || d.lojaFecha <= d.lojaAbre) throw new Error('Confira o horário de funcionamento da loja.');
    const semana = {};
    for (let i = 0; i < 7; i++) semana[String(i)] = turnos(d.semana && d.semana[String(i)], DIAS[i]);
    const rodizios = (Array.isArray(d.rodizios) ? d.rodizios : []).slice(0, 7).map(r => {
      const dia = Number(r.dia);
      if (!(dia >= 0 && dia <= 6) || !/^\d{4}-\d{2}-\d{2}$/.test(r.ref || '') || !Array.isArray(r.turnos) || !r.turnos.length) throw new Error('Rodízio inválido.');
      return { dia, ref: r.ref, turnos: r.turnos.slice(0, 8).map((s, j) => turnos(s, 'rodízio de ' + DIAS[dia] + ', semana ' + (j + 1))) };
    });
    const datas = {};
    for (const [k, l] of Object.entries(d.datas || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) throw new Error('Data inválida nas trocas.');
      datas[k] = turnos(l, 'troca de ' + k.split('-').reverse().join('/'));
    }
    return { lojaAbre: d.lojaAbre, lojaFecha: d.lojaFecha, semana, rodizios, datas };
  }
  if (secao === 'manutencao') {
    const srv = Array.isArray(d.servicos) ? d.servicos : [];
    const ks = srv.map(s => s[0]);
    const itens = (Array.isArray(d.itens) ? d.itens : []).slice(0, 200).map((x, i) => {
      const modelo = String(x.modelo || '').trim();
      if (!modelo) throw new Error('Falta o modelo na linha ' + (i + 1) + ' da manutenção.');
      const o = { modelo };
      for (const k of ks) { if (x[k] === '' || x[k] == null) continue; const v = num(x[k], 0, 100000); if (v == null) throw new Error('Preço inválido em ' + modelo + '.'); o[k] = v; }
      return o;
    });
    const parcelas = num(d.parcelas, 1, 24), acr = num(d.acrescimoParcelado, 0, 100);
    if (parcelas == null || acr == null) throw new Error('Confira parcelas e acréscimo da manutenção.');
    return { atualizadoEm: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), parcelas: Math.round(parcelas), acrescimoParcelado: acr, servicos: srv.map(s => [String(s[0]), String(s[1])]), itens };
  }
  throw new Error('Parte desconhecida: ' + secao);
}
