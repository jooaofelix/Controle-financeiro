// Embute os arquivos de public/ dentro do Worker (src/estaticos.js).
// Roda sozinho antes de `wrangler dev` e `wrangler deploy` (ver [build] no wrangler.toml).
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
};
const BINARIOS = new Set(['.png', '.webp']);

function listar(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listar(p) : [p];
  });
}

const arquivos = {};
for (const p of listar('public')) {
  const ext = extname(p);
  if (!TIPOS[ext]) continue;
  const caminho = '/' + relative('public', p).split('\\').join('/');
  const bin = BINARIOS.has(ext);
  arquivos[caminho] = { tipo: TIPOS[ext], base64: bin, corpo: readFileSync(p, bin ? 'base64' : 'utf8') };
}
writeFileSync('src/estaticos.js',
  '// Gerado por scripts/embutir.mjs — não edite à mão.\nexport const ESTATICOS = ' + JSON.stringify(arquivos) + ';\n');
console.log(`[embutir] ${Object.keys(arquivos).length} arquivos de public/ embutidos no Worker`);
