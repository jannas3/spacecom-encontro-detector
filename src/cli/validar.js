#!/usr/bin/env node
'use strict';

/**
 * Compara saídas com as respostas oficiais.
 *
 *   node src/cli/validar.js <gerado.json> <esperado.json> [entrada.txt]
 *   node src/cli/validar.js --todos [dados] [saida]     (todo respostasN.json disponível)
 *
 * Código de saída: 0 = idêntico | 2 = divergências | 1 = erro
 */

const fs = require('fs');
const path = require('path');
const { lerJson } = require('../infrastructure/gravador-json');
const { compararResultados, formatarRelatorio } = require('../validation/validador');
const { carregarPessoas } = require('../core/detector');
const { ErroEntrada, ErroDados } = require('../core/erros');
const { lerArgumentos, executarCli } = require('./comum');
const { DIRETORIOS } = require('../config/configuracoes');

function validarPar(gerPath, espPath, entrada, logger) {
  const gerado = lerJson(gerPath);
  const esperado = lerJson(espPath);
  let rel;
  try {
    rel = compararResultados(gerado, esperado);
  } catch (err) {
    throw new ErroDados(`${err.message} (${gerPath} x ${espPath})`, { codigo: 'ESTRUTURA_INVALIDA', causa: err });
  }
  const pessoas = entrada && !rel.perfeito && fs.existsSync(entrada) ? carregarPessoas(entrada) : null;
  console.log(formatarRelatorio(rel, { pessoas, gerado, esperado }));
  logger.execucao(`validar: ${path.basename(gerPath)} x ${path.basename(espPath)}`, {
    perfeito: rel.perfeito, score: rel.score, corretos: rel.corretos,
    falsosPositivos: rel.falsosPositivos.length, falsosNegativos: rel.falsosNegativos.length,
    tipoErrado: rel.tipoErrado.length, duplicados: rel.duplicados.length,
  });
  return rel.perfeito;
}

executarCli('validar', ({ logger }) => {
  const { flags, posicionais } = lerArgumentos();

  if (flags.todos) {
    const [pastaDados = DIRETORIOS.dados, pastaSaida = DIRETORIOS.saida] = posicionais;
    const respostas = fs.existsSync(pastaDados) ? fs.readdirSync(pastaDados).filter((f) => /^respostas\d+\.json$/i.test(f)) : [];
    if (!respostas.length) throw new ErroEntrada(`Nenhum respostasN.json em "${pastaDados}".`, { codigo: 'SEM_RESPOSTAS' });
    let tudoCerto = true;
    for (const r of respostas.sort()) {
      const n = r.match(/\d+/)[0];
      const gerado = path.join(pastaSaida, `dataset${n}.json`);
      console.log(`\n== dataset${n} ==`);
      if (!fs.existsSync(gerado)) {
        console.log(`Saída ${gerado} não existe. Rode "npm start" antes.`);
        tudoCerto = false;
        continue;
      }
      tudoCerto = validarPar(gerado, path.join(pastaDados, r), path.join(pastaDados, `dataset${n}.txt`), logger) && tudoCerto;
    }
    return tudoCerto ? 0 : 2;
  }

  const [gerPath, espPath, entrada] = posicionais;
  if (!gerPath || !espPath) {
    throw new ErroEntrada('Uso: node src/cli/validar.js <gerado.json> <esperado.json> [entrada.txt]  ou  --todos', { codigo: 'ARGUMENTO_AUSENTE' });
  }
  return validarPar(gerPath, espPath, entrada, logger) ? 0 : 2;
});
