'use strict';

const fs = require('fs');
const path = require('path');
const { ErroDados, ErroEscrita, erroDeArquivo } = require('../core/erros');

/**
 * Grava JSON de forma atômica: escreve num arquivo temporário na mesma pasta e
 * renomeia por cima do destino. Se o processo cair no meio, o arquivo anterior
 * continua intacto (nunca fica um JSON pela metade).
 *
 * @param {string} caminho
 * @param {unknown} dados
 * @param {{indentacao?: number, copiaAnteriorEm?: string}} [opcoes]
 *        copiaAnteriorEm: pasta onde guardar a versão anterior, se o conteúdo mudar
 * @returns {{bytes: number, alterado: boolean, copiaAnterior: string|null}}
 */
function gravarJsonSeguro(caminho, dados, { indentacao = 0, copiaAnteriorEm } = {}) {
  let texto;
  try {
    texto = JSON.stringify(dados, null, indentacao);
  } catch (err) {
    throw new ErroEscrita(`Não foi possível converter o resultado em JSON (${err.message}).`, {
      codigo: 'JSON_INVALIDO',
      contexto: { caminho },
      causa: err,
    });
  }
  if (texto === undefined) throw new ErroEscrita('Resultado vazio não pode ser gravado como JSON.', { codigo: 'JSON_INVALIDO', contexto: { caminho } });

  const pasta = path.dirname(path.resolve(caminho));
  try {
    fs.mkdirSync(pasta, { recursive: true });
  } catch (err) {
    throw erroDeArquivo(err, pasta, 'criar a pasta');
  }

  let anterior = null;
  try {
    anterior = fs.readFileSync(caminho, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw erroDeArquivo(err, caminho, 'ler o arquivo anterior de');
  }
  const alterado = anterior !== texto;

  let copiaAnterior = null;
  if (alterado && anterior !== null && copiaAnteriorEm) {
    copiaAnterior = path.join(copiaAnteriorEm, path.basename(caminho));
    try {
      fs.mkdirSync(copiaAnteriorEm, { recursive: true });
      fs.writeFileSync(copiaAnterior, anterior);
    } catch (err) {
      throw erroDeArquivo(err, copiaAnterior, 'gravar a cópia de segurança em');
    }
  }

  const temporario = path.join(pasta, `.${path.basename(caminho)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporario, texto);
    fs.renameSync(temporario, caminho);
  } catch (err) {
    try {
      fs.rmSync(temporario, { force: true });
    } catch (limpeza) {
      err.message += ` (e o temporário ${temporario} não pôde ser removido: ${limpeza.message})`;
    }
    throw erroDeArquivo(err, caminho, 'gravar');
  }
  return { bytes: Buffer.byteLength(texto), alterado, copiaAnterior };
}

/** Lê e interpreta um JSON, com erros contextualizados. */
function lerJson(caminho) {
  let texto;
  try {
    texto = fs.readFileSync(caminho, 'utf8');
  } catch (err) {
    throw erroDeArquivo(err, caminho, 'ler');
  }
  try {
    return JSON.parse(texto);
  } catch (err) {
    throw new ErroDados(`JSON inválido em ${caminho}: ${err.message}`, { codigo: 'JSON_INVALIDO', contexto: { caminho }, causa: err });
  }
}

module.exports = { gravarJsonSeguro, lerJson };
