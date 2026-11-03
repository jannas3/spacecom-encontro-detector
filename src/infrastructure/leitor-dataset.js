'use strict';

const fs = require('fs');
const { TAMANHO_BLOCO_LEITURA } = require('../config/configuracoes');
const { ErroEntrada, erroDeArquivo } = require('../core/erros');

/**
 * Lê um arquivo texto em blocos e entrega cada linha como intervalo de bytes
 * (buf, inicio, fim), sem criar strings. Funciona com arquivos maiores que o
 * limite de string do V8 (~512 MB).
 *
 * - Linha dividida entre dois blocos: os bytes que sobram no fim do bloco são
 *   copiados para o início do buffer antes da próxima leitura.
 * - Linha maior que o buffer: o buffer dobra de tamanho.
 * - LF e CRLF: a quebra é '\n'; o '\r' final é removido pelo parser (trim).
 * - BOM UTF-8 no início do arquivo é ignorado.
 * - Backpressure: a leitura é síncrona e só avança depois que o bloco anterior
 *   foi totalmente processado, então a memória fica limitada a 1 buffer.
 *
 * @param {string} caminho
 * @param {(buf: Buffer, inicio: number, fim: number) => (boolean|void)} aoLer
 *        retornar false interrompe a leitura
 * @param {{tamanhoBloco?: number}} [opcoes]
 * @returns {boolean} true se leu até o fim, false se foi interrompido por aoLer
 */
function lerLinhas(caminho, aoLer, { tamanhoBloco = TAMANHO_BLOCO_LEITURA } = {}) {
  let fd;
  try {
    const st = fs.statSync(caminho);
    if (st.isDirectory()) throw Object.assign(new Error('é uma pasta'), { code: 'EISDIR' });
    if (st.size === 0) throw new ErroEntrada(`Arquivo vazio: ${caminho}`, { codigo: 'ARQUIVO_VAZIO', contexto: { caminho } });
    fd = fs.openSync(caminho, 'r');
  } catch (err) {
    if (err instanceof ErroEntrada) throw err;
    throw erroDeArquivo(err, caminho, 'ler');
  }

  let buf = Buffer.allocUnsafe(Math.max(64, tamanhoBloco));
  let pendente = 0;
  let primeiroBloco = true;
  try {
    for (;;) {
      let lidos;
      try {
        lidos = fs.readSync(fd, buf, pendente, buf.length - pendente, null);
      } catch (err) {
        throw erroDeArquivo(err, caminho, 'ler');
      }
      const fim = pendente + lidos;
      const view = buf.subarray(0, fim);
      let s = 0;
      if (primeiroBloco && fim >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) s = 3;
      primeiroBloco = false;

      let i = view.indexOf(10, s);
      while (i !== -1) {
        if (aoLer(buf, s, i) === false) return false;
        s = i + 1;
        i = view.indexOf(10, s);
      }
      if (lidos === 0) {
        if (s < fim && aoLer(buf, s, fim) === false) return false;
        return true;
      }
      pendente = fim - s;
      if (pendente === buf.length) {
        const maior = Buffer.allocUnsafe(buf.length * 2);
        buf.copy(maior, 0, s, fim);
        buf = maior;
      } else {
        buf.copy(buf, 0, s, fim);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { lerLinhas };
