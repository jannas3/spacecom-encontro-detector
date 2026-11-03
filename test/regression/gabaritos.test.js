'use strict';

/**
 * Regressão contra os gabaritos oficiais (respostas1/2.json).
 * Os datasets oficiais não ficam no repositório; se dados/datasetN.txt e
 * dados/respostasN.json não existirem, o teste é pulado com aviso.
 * Use a variável SPACECOM_DADOS para apontar outra pasta.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analisar } = require('../../src/core/detector');
const { compararResultados } = require('../../src/validation/validador');

const pasta = process.env.SPACECOM_DADOS || path.join(__dirname, '..', '..', 'dados');

for (const n of [1, 2]) {
  const entrada = path.join(pasta, `dataset${n}.txt`);
  const resposta = path.join(pasta, `respostas${n}.json`);
  const existe = fs.existsSync(entrada) && fs.existsSync(resposta);

  test(`dataset${n}: idêntico ao gabarito oficial, inclusive a distância`, { skip: existe ? false : `arquivos oficiais não encontrados em ${pasta}` }, () => {
    const { encontros } = analisar(entrada);
    const esperado = JSON.parse(fs.readFileSync(resposta, 'utf8'));
    const rel = compararResultados(encontros, esperado);
    assert.strictEqual(rel.falsosPositivos.length, 0, 'falsos positivos');
    assert.strictEqual(rel.falsosNegativos.length, 0, 'encontros faltando');
    assert.strictEqual(rel.tipoErrado.length, 0, 'tipo errado');
    assert.strictEqual(rel.duplicados.length, 0, 'duplicações');
    assert.strictEqual(rel.maiorDiferencaDistancia, 0, 'distância diferente do gabarito');
    assert.strictEqual(rel.score, esperado.length);
  });
}
