'use strict';

const { ErroAplicacao } = require('../core/erros');
const { criarLogger } = require('../observability/logger');
const { DIRETORIOS } = require('../config/configuracoes');

/** --chave=valor / --flag / posicionais */
function lerArgumentos(argv = process.argv.slice(2)) {
  const flags = {};
  const posicionais = [];
  for (const a of argv) {
    if (a.startsWith('--')) {
      const i = a.indexOf('=');
      if (i === -1) flags[a.slice(2)] = true;
      else flags[a.slice(2, i)] = a.slice(i + 1);
    } else posicionais.push(a);
  }
  return { flags, posicionais };
}

/** Lê um inteiro positivo de uma flag, com erro claro se for inválido. */
function inteiroPositivo(valor, nome, padrao) {
  if (valor === undefined) return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) throw new ErroAplicacao(`--${nome} precisa ser um inteiro positivo (recebido: ${valor}).`, { codigo: 'ARGUMENTO_INVALIDO' });
  return n;
}

/**
 * Executa um comando com tratamento padronizado de erros:
 *  - ErroAplicacao → mensagem clara no terminal, detalhes no log, código 1
 *  - erro inesperado → mensagem curta no terminal (sem stack), stack no log, código 1
 *  - Ctrl+C → registra a interrupção e sai com 130. O processamento é síncrono,
 *    então a saída acontece ao fim do dataset em andamento; a escrita atômica
 *    garante que nenhum JSON fica pela metade.
 */
function executarCli(nome, fn) {
  const { flags } = lerArgumentos();
  const logger = criarLogger({ pasta: flags['sem-log'] ? null : DIRETORIOS.logs, nivel: flags.log || undefined });

  process.on('SIGINT', () => {
    logger.warn(`${nome}: execução interrompida pelo usuário (Ctrl+C)`);
    process.stderr.write('\nInterrompido. Nenhum arquivo de saída ficou incompleto.\n');
    process.exit(130);
  });

  Promise.resolve()
    .then(() => fn({ logger }))
    .then((codigo) => {
      process.exitCode = codigo ?? 0;
    })
    .catch((err) => {
      if (err instanceof ErroAplicacao) {
        process.stderr.write(`Erro: ${err.message}\n`);
        logger.error(`${nome}: ${err.message}`, { erro: err });
      } else {
        process.stderr.write(`Erro inesperado: ${err && err.message}. Detalhes técnicos em ${DIRETORIOS.logs}/erros.log\n`);
        logger.error(`${nome}: erro inesperado`, { erro: err });
      }
      process.exitCode = 1;
    });
}

module.exports = { lerArgumentos, inteiroPositivo, executarCli };
