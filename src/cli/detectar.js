#!/usr/bin/env node
'use strict';

/**
 * Processa UM dataset.
 *   node src/cli/detectar.js <entrada.txt> [saida.json] [--incluir-vitimas] [--pretty] [--log=DEBUG]
 */

const path = require('path');
const { analisar } = require('../core/detector');
const { gravarJsonSeguro } = require('../infrastructure/gravador-json');
const { ErroEntrada } = require('../core/erros');
const { medirMemoria } = require('../observability/metricas');
const { lerArgumentos, executarCli } = require('./comum');
const { DIRETORIOS } = require('../config/configuracoes');

executarCli('detectar', ({ logger }) => {
  const { flags, posicionais } = lerArgumentos();
  const entrada = posicionais[0];
  if (!entrada) {
    throw new ErroEntrada('Uso: node src/cli/detectar.js <entrada.txt> [saida.json] [--incluir-vitimas] [--pretty]', { codigo: 'ARGUMENTO_AUSENTE' });
  }
  const saida = posicionais[1] || path.join(DIRETORIOS.saida, path.basename(entrada).replace(/\.txt$/i, '') + '.json');

  logger.info('detectar: início', { entrada: path.basename(entrada), incluirVitimas: !!flags['incluir-vitimas'] });
  const { encontros, info } = analisar(entrada, { incluirVitimas: !!flags['incluir-vitimas'] });
  for (const aviso of info.avisos) {
    logger.warn(`${path.basename(entrada)}: ${aviso}`);
    process.stderr.write(`Aviso: ${aviso}\n`);
  }
  const t0 = process.hrtime.bigint();
  gravarJsonSeguro(saida, encontros, { indentacao: flags.pretty ? 2 : 0 });
  const escritaMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const m = info.metricas;
  logger.execucao(`${path.basename(entrada)} processado`, { modo: info.modo, linhas: info.estatisticas.linhasValidas, encontros: encontros.length, porTipo: info.porTipo });
  logger.performance(`${path.basename(entrada)} desempenho`, {
    totalMs: info.tempoTotalMs, buscaMs: info.tempoBuscaMs, escritaMs,
    paresForcaBruta: m.paresForcaBruta, paresCandidatos: m.paresCandidatos, calculosHaversine: m.calculosHaversine,
    memoria: medirMemoria(),
  });
  process.stdout.write(
    `${path.basename(entrada)}: ${encontros.length} encontros ${JSON.stringify(info.porTipo)} em ${info.tempoTotalMs.toFixed(1)} ms ` +
      `[${info.modo}, ${info.estatisticas.linhasValidas} linhas válidas] -> ${saida}\n`
  );
  return 0;
});
