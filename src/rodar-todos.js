#!/usr/bin/env node
'use strict';

/**
 * Processa todos os datasets de uma pasta, grava os JSONs e mede o tempo médio.
 *
 * Uso:
 *   node src/rodar-todos.js [pastaEntrada=dados] [pastaSaida=saida] [--repeticoes=3] [--incluir-vitimas]
 *
 * Saída: saida/datasetN.json para cada dados/datasetN.txt
 * Se existir dados/respostasN.json, roda a validação automaticamente.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { detectar } = require('./detector');

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  })
);
const [entradaDir = 'dados', saidaDir = 'saida'] = args.filter((a) => !a.startsWith('--'));
const repeticoes = Math.max(1, parseInt(flags.repeticoes || '3', 10));
const opcoes = { incluirVitimas: !!flags['incluir-vitimas'] };

const arquivos = fs
  .readdirSync(entradaDir)
  .filter((f) => /^dataset\d+\.txt$/i.test(f))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

if (!arquivos.length) {
  console.error(`Nenhum datasetN.txt encontrado em "${entradaDir}".`);
  process.exit(1);
}
fs.mkdirSync(saidaDir, { recursive: true });

let somaMedias = 0;
for (const arq of arquivos) {
  const entrada = path.join(entradaDir, arq);
  const tempos = [];
  let encontros;
  const info = {};
  try {
    for (let r = 0; r < repeticoes; r++) {
      const t0 = process.hrtime.bigint();
      encontros = detectar(entrada, { ...opcoes, info });
      tempos.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  } catch (e) {
    console.log(`${arq.padEnd(14)} ERRO: ${e.message}`);
    continue;
  }
  const media = tempos.reduce((a, b) => a + b, 0) / tempos.length;
  somaMedias += media;

  const n = arq.match(/\d+/)[0];
  const saida = path.join(saidaDir, `dataset${n}.json`);
  fs.writeFileSync(saida, JSON.stringify(encontros));
  console.log(`${arq.padEnd(14)} ${String(encontros.length).padStart(8)} encontros  média ${media.toFixed(1)} ms (${repeticoes}x) [${info.modo}, ${info.linhas} linhas]`);

  const resposta = path.join(entradaDir, `respostas${n}.json`);
  if (fs.existsSync(resposta)) {
    try {
      const out = execFileSync(process.execPath, [path.join(__dirname, 'validar.js'), saida, resposta, entrada], { encoding: 'utf8' });
      console.log(out.split('\n').map((l) => '   ' + l).join('\n'));
    } catch (e) {
      console.log((e.stdout || '').split('\n').map((l) => '   ' + l).join('\n'));
    }
  }
}
console.log(`\nSoma dos tempos médios: ${somaMedias.toFixed(1)} ms`);
