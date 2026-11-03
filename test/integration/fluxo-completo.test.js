'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { analisar } = require('../../src/core/detector');
const { gravarJsonSeguro, lerJson } = require('../../src/infrastructure/gravador-json');
const { compararResultados } = require('../../src/validation/validador');
const { detectarForcaBruta } = require('../../src/validation/referencia-forca-bruta');
const { criarClassificador } = require('../../src/core/classificador');
const { ErroDados } = require('../../src/core/erros');
const { pastaTemporaria, escreverDataset, aleatorio, aoNorte, aLeste } = require('../helpers/util');

/** Dataset sintético no formato oficial + resposta calculada por força bruta. */
function gerarDataset({ pessoas = 60, timestamps = 40, larguraM = 400, semente = 1 }) {
  const r = aleatorio(semente);
  const cadastro = [];
  for (let i = 1; i <= pessoas; i++) {
    const vitima = i % 10 === 0;
    cadastro.push({ id: i, faccao: vitima || i % 3 === 0 ? '' : String(1 + (i % 4)), vitima, restricoes: new Set(vitima ? [i - 1] : []) });
  }
  const pos = cadastro.map(() => [aoNorte(-15, (r() - 0.5) * larguraM), 0]);
  pos.forEach((p) => (p[1] = aLeste(p[0], -47, (r() - 0.5) * larguraM)));
  const linhas = [];
  const porTs = new Map();
  for (let t = 0; t < timestamps; t++) {
    const ts = new Date(Date.UTC(2024, 0, 1) + t * 5000).toISOString().replace('T', ' ').slice(0, 19);
    const pontos = [];
    cadastro.forEach((c, i) => {
      pos[i][0] = Math.round((pos[i][0] + (r() - 0.5) * 0.0001) * 1e5) / 1e5;
      pos[i][1] = Math.round((pos[i][1] + (r() - 0.5) * 0.0001) * 1e5) / 1e5;
      // de vez em quando a vítima fica a poucos metros do agressor (garante casos de protetiva)
      if (c.vitima && t % 4 === 0) {
        pos[i][0] = Math.round((pos[i - 1][0] + 0.00005) * 1e5) / 1e5;
        pos[i][1] = pos[i - 1][1];
      }
      const [lat, lon] = pos[i];
      linhas.push(`${c.id};${c.faccao};"${ts}";${lat.toFixed(5)};${lon.toFixed(5)};${c.vitima};${c.vitima ? `"${[...c.restricoes].join(',')}"` : ''}`);
      pontos.push({ id: c.id, lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });
    });
    porTs.set(ts, pontos);
  }
  const esperado = detectarForcaBruta(porTs, new Map(cadastro.map((c) => [c.id, c])), criarClassificador());
  return { linhas, esperado };
}

test('TXT → parser → detector → classificador → JSON → validador', (t) => {
  const dir = pastaTemporaria(t);
  const { linhas, esperado } = gerarDataset({ semente: 3 });
  const entrada = escreverDataset(dir, 'dataset1.txt', linhas);
  const { encontros, info } = analisar(entrada);
  assert.strictEqual(info.modo, 'streaming');
  assert.ok(esperado.length > 20, 'cenário precisa ter encontros');
  assert.ok(Object.values(info.porTipo).every((v) => v > 0), 'cenário precisa ter os 3 tipos');

  const saida = path.join(dir, 'saida', 'dataset1.json');
  gravarJsonSeguro(saida, encontros);
  const rel = compararResultados(lerJson(saida), esperado);
  assert.strictEqual(rel.perfeito, true, JSON.stringify({ fp: rel.falsosPositivos.length, fn: rel.falsosNegativos.length }));
  assert.strictEqual(rel.score, esperado.length);
});

test('saída determinística e ordenada (timestamp, menor id, maior id)', (t) => {
  const dir = pastaTemporaria(t);
  const entrada = escreverDataset(dir, 'd.txt', gerarDataset({ semente: 4 }).linhas);
  const a = analisar(entrada).encontros;
  const b = analisar(entrada).encontros;
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  for (let i = 1; i < a.length; i++) {
    const [x, y] = [a[i - 1], a[i]];
    const ordem = x.timestamp < y.timestamp || (x.timestamp === y.timestamp && (x.monitoradosEncontro[0] < y.monitoradosEncontro[0] || (x.monitoradosEncontro[0] === y.monitoradosEncontro[0] && x.monitoradosEncontro[1] < y.monitoradosEncontro[1])));
    assert.ok(ordem, `fora de ordem na posição ${i}`);
  }
});

test('arquivo fora de ordem (modo memória) dá o mesmo resultado do ordenado', (t) => {
  const dir = pastaTemporaria(t);
  const { linhas } = gerarDataset({ semente: 5 });
  const ordenado = analisar(escreverDataset(dir, 'ord.txt', linhas));
  const embaralhado = [...linhas];
  const r = aleatorio(99);
  for (let i = embaralhado.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [embaralhado[i], embaralhado[j]] = [embaralhado[j], embaralhado[i]];
  }
  const fora = analisar(escreverDataset(dir, 'fora.txt', embaralhado));
  assert.strictEqual(fora.info.modo, 'memoria');
  assert.strictEqual(JSON.stringify(fora.encontros), JSON.stringify(ordenado.encontros));
});

test('blocos minúsculos (linhas cortadas entre blocos) não mudam o resultado', (t) => {
  const dir = pastaTemporaria(t);
  const entrada = escreverDataset(dir, 'd.txt', gerarDataset({ semente: 6, timestamps: 10 }).linhas, { quebra: '\r\n' });
  const normal = analisar(entrada).encontros;
  const picado = analisar(entrada, { tamanhoBloco: 97 }).encontros;
  assert.strictEqual(JSON.stringify(picado), JSON.stringify(normal));
});

test('timestamps diferentes nunca são comparados entre si', (t) => {
  const dir = pastaTemporaria(t);
  const entrada = escreverDataset(dir, 'd.txt', [
    '1;;"2024-01-01 00:00:00";-10.00000;-37.00000;false;',
    '2;;"2024-01-01 00:00:05";-10.00000;-37.00000;false;',
    '3;;"2024-01-01 00:00:05";-10.00001;-37.00000;false;',
  ]);
  const { encontros } = analisar(entrada);
  assert.deepStrictEqual(encontros.map((e) => e.monitoradosEncontro), [[2, 3]]);
});

test('duplicatas no mesmo timestamp não geram encontro duplicado e são contadas', (t) => {
  const dir = pastaTemporaria(t);
  const entrada = escreverDataset(dir, 'd.txt', [
    '1;;"2024-01-01 00:00:00";-10.00000;-37.00000;false;',
    '2;;"2024-01-01 00:00:00";-10.00005;-37.00000;false;',
    '2;;"2024-01-01 00:00:00";-10.00005;-37.00000;false;', // idêntica
    '2;;"2024-01-01 00:00:00";-10.00009;-37.00000;false;', // conflitante
  ]);
  const { encontros, info } = analisar(entrada);
  assert.strictEqual(encontros.length, 1);
  assert.strictEqual(info.estatisticas.linhasDuplicadas, 1);
  assert.strictEqual(info.estatisticas.duplicadasConflitantes, 1);
  assert.strictEqual(info.avisos.length, 2);
});

test('ids invertidos no arquivo saem em ordem crescente no JSON', (t) => {
  const dir = pastaTemporaria(t);
  const entrada = escreverDataset(dir, 'd.txt', ['44;1;"2024-01-01 00:01:50";-10.07987;-37.08389;false;', '40;1;"2024-01-01 00:01:50";-10.07996;-37.08384;false;']);
  const [e] = analisar(entrada).encontros;
  assert.deepStrictEqual(e, {
    tipo: 'faccao',
    monitoradosEncontro: [40, 44],
    timestamp: '2024-01-01 00:01:50',
    posicoes: { 40: { lat: -10.07996, lon: -37.08384 }, 44: { lat: -10.07987, lon: -37.08389 } },
    distanciaMetros: 11.406788673336607,
  });
});

test('arquivo só com linhas inválidas gera ErroDados com os motivos', (t) => {
  const dir = pastaTemporaria(t);
  const entrada = escreverDataset(dir, 'd.txt', ['1;;ontem;-10;-37;false;', '2;;"2024-01-01 00:00:00";x;-37;false;']);
  assert.throws(() => analisar(entrada), (e) => e instanceof ErroDados && /timestamp invalido \(1\)/.test(e.message) && /latitude invalida \(1\)/.test(e.message));
});
