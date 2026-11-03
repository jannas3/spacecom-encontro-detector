'use strict';

/**
 * Executa os testes com o runner nativo do Node (node:test), sem dependências.
 * Funciona em Node 18+ (que não expande globs sozinho, nem no Windows).
 *
 *   node test/executar.js                 unit + integration + regression
 *   node test/executar.js performance     só os testes de desempenho
 *   node test/executar.js todos           tudo
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const grupo = process.argv[2] || 'padrao';
const pastas = { padrao: ['unit', 'integration', 'regression'], performance: ['performance'], todos: ['unit', 'integration', 'regression', 'performance'] }[grupo];
if (!pastas) {
  console.error(`Grupo desconhecido: ${grupo}. Use: padrao | performance | todos`);
  process.exit(1);
}

const arquivos = [];
for (const p of pastas) {
  const dir = path.join(__dirname, p);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.test.js')) arquivos.push(path.join(dir, f));
}
const r = spawnSync(process.execPath, ['--test', ...arquivos], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
