// Ajudantes para ler a ficha da loja (config/loja.js) nas funções do portal.
import loja from '../config/loja.js';
export default loja;
export const pessoa = email => loja.pessoas.find(p => p.email === String(email || '').toLowerCase()) || null;
export const admins = () => loja.pessoas.filter(p => p.papel === 'admin').map(p => p.email);
export const vendedores = () => loja.pessoas.filter(p => p.papel === 'vendedor');
// Quem pode ver cada arquivo privado: o dono do arquivo e os administradores.
export function podeVer(nome, email) {
  const p = pessoa(email);
  if (!p) return false;
  if (p.papel === 'admin') return true;
  if (nome === 'tecnico') return p.papel === 'tecnico';
  return nome === 'vendedor-' + p.arq;
}
export function emailDoLogin(req) {
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
