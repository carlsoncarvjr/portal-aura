// Junta config/loja.js + lib/ficha.js + lib/webpush.js + lib/calc.js + workers/avisos.src.js num arquivo só (workers/dist/avisos.js) para publicar no Cloudflare.
import fs from 'fs';
const tira = s => s.replace(/^import .*$/gm, '').replace(/^export (async function|function|const) /gm, '$1 ');
const cfg = fs.readFileSync('config/loja.js', 'utf8').replace(/^export default /m, 'const loja = ');
const out = ['// GERADO por workers/build.mjs — não edite à mão.', cfg, tira(fs.readFileSync('lib/ficha.js', 'utf8')), tira(fs.readFileSync('lib/webpush.js', 'utf8')), tira(fs.readFileSync('lib/calc.js', 'utf8')), fs.readFileSync('workers/avisos.src.js', 'utf8').replace(/^import .*$/gm, '')].join('\n');
fs.mkdirSync('workers/dist', { recursive: true });
fs.writeFileSync('workers/dist/avisos.js', out);
console.log('workers/dist/avisos.js', out.length, 'bytes');
