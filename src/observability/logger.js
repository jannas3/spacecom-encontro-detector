'use strict';

const fs = require('fs');
const path = require('path');
const { LOG } = require('../config/configuracoes');

/**
 * Logger em arquivo, sem dependências.
 *
 * logs/aplicacao.log   tudo a partir do nível configurado
 * logs/erros.log       só ERROR
 * logs/execucoes.log   um resumo por dataset processado
 * logs/performance.log tempos, pares e memória
 *
 * - Cada linha: data/hora local com fuso, nível, mensagem e campos em JSON.
 * - Rotação por tamanho: arquivo.log → arquivo.1.log → … (mantém LOG.arquivosMantidos).
 * - Coordenadas nunca são registradas; só contagens e identificadores de arquivo.
 * - Se o log falhar (disco cheio, sem permissão), avisa uma vez no stderr e
 *   continua: o resultado nunca depende do log.
 */

const NIVEIS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };

function dataHoraLocal(d = new Date()) {
  const p = (n, t = 2) => String(n).padStart(t, '0');
  const off = -d.getTimezoneOffset();
  const sinal = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}` +
    `${sinal}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`
  );
}

/**
 * @param {{pasta?: string|null, nivel?: string, console?: boolean, tamanhoMaxBytes?: number, arquivosMantidos?: number}} [opcoes]
 *        pasta null desliga a gravação em arquivo (útil em testes)
 */
function criarLogger({
  pasta = 'logs',
  nivel = process.env.LOG_NIVEL || LOG.nivelPadrao,
  console: noConsole = false,
  tamanhoMaxBytes = LOG.tamanhoMaxBytes,
  arquivosMantidos = LOG.arquivosMantidos,
} = {}) {
  const minimo = NIVEIS[String(nivel).toUpperCase()] ?? NIVEIS.INFO;
  let arquivosAtivos = pasta !== null;
  let avisouFalha = false;

  if (arquivosAtivos) {
    try {
      fs.mkdirSync(pasta, { recursive: true });
    } catch (err) {
      desativar(err);
    }
  }

  function desativar(err) {
    arquivosAtivos = false;
    if (!avisouFalha) {
      avisouFalha = true;
      process.stderr.write(`[aviso] logs em arquivo desativados (${err.code || err.message}); a execução continua normalmente.\n`);
    }
  }

  function rotacionar(arquivo) {
    let tamanho;
    try {
      tamanho = fs.statSync(arquivo).size;
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    if (tamanho < tamanhoMaxBytes) return;
    const base = arquivo.replace(/\.log$/, '');
    fs.rmSync(`${base}.${arquivosMantidos}.log`, { force: true });
    for (let i = arquivosMantidos - 1; i >= 1; i--) {
      if (fs.existsSync(`${base}.${i}.log`)) fs.renameSync(`${base}.${i}.log`, `${base}.${i + 1}.log`);
    }
    fs.renameSync(arquivo, `${base}.1.log`);
  }

  function gravar(nomeArquivo, texto) {
    if (!arquivosAtivos) return;
    const arquivo = path.join(pasta, nomeArquivo);
    try {
      rotacionar(arquivo);
      fs.appendFileSync(arquivo, texto);
    } catch (err) {
      desativar(err);
    }
  }

  function registrar(nivelTexto, mensagem, campos, canal) {
    if (NIVEIS[nivelTexto] < minimo) return;
    const extra = campos && Object.keys(campos).length ? ' ' + JSON.stringify(campos, serializarErro) : '';
    const texto = `${dataHoraLocal()} [${nivelTexto}] ${mensagem}${extra}\n`;
    gravar('aplicacao.log', texto);
    if (nivelTexto === 'ERROR') gravar('erros.log', texto);
    if (canal) gravar(`${canal}.log`, texto);
    if (noConsole) (nivelTexto === 'ERROR' || nivelTexto === 'WARN' ? process.stderr : process.stdout).write(texto);
  }

  return {
    debug: (m, c) => registrar('DEBUG', m, c),
    info: (m, c) => registrar('INFO', m, c),
    warn: (m, c) => registrar('WARN', m, c),
    error: (m, c) => registrar('ERROR', m, c),
    /** Resumo de execução (aplicacao.log + execucoes.log) */
    execucao: (m, c) => registrar('INFO', m, c, 'execucoes'),
    /** Métricas de desempenho (aplicacao.log + performance.log) */
    performance: (m, c) => registrar('INFO', m, c, 'performance'),
  };
}

/** Erros viram { nome, codigo, mensagem, stack } no JSON do log. */
function serializarErro(chave, valor) {
  if (valor instanceof Error) {
    return { nome: valor.name, codigo: valor.codigo || valor.code, mensagem: valor.message, contexto: valor.contexto, stack: valor.stack };
  }
  if (typeof valor === 'bigint') return Number(valor);
  return valor;
}

module.exports = { criarLogger, dataHoraLocal, NIVEIS };
