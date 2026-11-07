// Mantém a regra de login do Cloudflare Access igual à equipe do Painel do dono.
// Quem entra na equipe é liberado no login; quem sai é bloqueado e tem a sessão encerrada.
// Usa o segredo CF_ACCESS_TOKEN (permissões: Access Apps and Policies Edit + Access Organizations Revoke).
import loja from '../config/loja.js';
const API = 'https://api.cloudflare.com/client/v4';
// Aceita a chave colada sozinha ou junto com o comando de teste que o Cloudflare mostra (pega o trecho da chave).
const chave = env => { const v = String(env.CF_ACCESS_TOKEN || '').trim(); const m = v.match(/[A-Za-z0-9_-]{37,}/g); return m ? m.sort((a, b) => b.length - a.length)[0] : v; };

async function cf(env, metodo, caminho, corpo) {
  const r = await fetch(API + caminho, { method: metodo, headers: { Authorization: 'Bearer ' + chave(env), 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(((j.errors || [])[0] || {}).message || ('HTTP ' + r.status));
  return j.result;
}

export async function sincronizarLogin(env, pessoas) {
  if (!env.CF_ACCESS_TOKEN) return { ok: false, semToken: true };
  const { conta, politicaAcesso } = loja.cloudflare || {};
  if (!conta || !politicaAcesso) return { ok: false, erro: 'Conta do Cloudflare não configurada na ficha.' };
  try {
    const pol = await cf(env, 'GET', `/accounts/${conta}/access/policies/${politicaAcesso}`);
    const antes = (pol.include || []).filter(x => x.email).map(x => x.email.email.toLowerCase());
    const outros = (pol.include || []).filter(x => !x.email);   // regras que não são e-mail ficam como estão
    const agora = [...new Set(pessoas.map(p => p.email.toLowerCase()))];
    const add = agora.filter(e => !antes.includes(e)), rem = antes.filter(e => !agora.includes(e));
    if (add.length || rem.length) {
      await cf(env, 'PUT', `/accounts/${conta}/access/policies/${politicaAcesso}`, {
        name: pol.name, decision: pol.decision, include: [...outros, ...agora.map(email => ({ email: { email } }))],
        exclude: pol.exclude || [], require: pol.require || [], session_duration: pol.session_duration,
      });
    }
    const revogados = [];
    for (const email of rem) { try { await cf(env, 'POST', `/accounts/${conta}/access/organizations/revoke_user`, { email }); revogados.push(email); } catch (e) {} }
    return { ok: true, adicionados: add, removidos: rem, revogados };
  } catch (e) { return { ok: false, erro: String(e.message || e), tamanhoChave: String(env.CF_ACCESS_TOKEN || '').length }; }
}
