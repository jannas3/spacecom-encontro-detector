'use strict';

/**
 * Verificação estática sem dependências (o projeto não usa ESLint/Prettier para
 * continuar com zero dependências):
 *  - sintaxe de todos os .js (node --check)
 *  - 'use strict' em todo módulo de src/ e test/
 *  - nenhum catch vazio
 *  - sem console.log em src/core, src/infrastructure e src/validation (a lógica não imprime nada)
 *  - sem espaços no fim da linha e sem tabulação
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const pastas = ['src', 'test', 'scripts'];
const semConsole = ['src/core', 'src/infrastructure', 'src/validation', 'src/observability/metricas.js'];
const problemas = [];

function listar(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listar(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

const arquivos = pastas.filter((p) => fs.existsSync(path.join(raiz, p))).flatMap((p) => listar(path.join(raiz, p)));
for (const arq of arquivos) {
  const rel = path.relative(raiz, arq).split(path.sep).join('/');
  const r = spawnSync(process.execPath, ['--check', arq], { encoding: 'utf8' });
  if (r.status !== 0) problemas.push(`${rel}: erro de sintaxe\n${r.stderr}`);
  const texto = fs.readFileSync(arq, 'utf8');
  if (!/^(#!.*\n)?'use strict';/.test(texto)) problemas.push(`${rel}: falta 'use strict'`);
  if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(texto)) problemas.push(`${rel}: catch vazio`);
  if (semConsole.some((p) => rel.startsWith(p)) && /console\.(log|info|warn|error)\(/.test(texto)) problemas.push(`${rel}: console.* em código de lógica`);
  texto.split('\n').forEach((l, i) => {
    if (/[ \t]+$/.test(l)) problemas.push(`${rel}:${i + 1}: espaço no fim da linha`);
    if (/\t/.test(l)) problemas.push(`${rel}:${i + 1}: tabulação`);
  });
}

if (problemas.length) {
  console.error(problemas.join('\n'));
  console.error(`\n${problemas.length} problema(s) em ${arquivos.length} arquivo(s).`);
  process.exit(1);
}
console.log(`Verificação ok: ${arquivos.length} arquivos.`);
