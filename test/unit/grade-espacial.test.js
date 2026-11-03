'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { criarProcessadorDeGrupo, GRAUS_LAT_POR_CELULA } = require('../../src/core/grade-espacial');
const { criarClassificador } = require('../../src/core/classificador');
const { criarMetricas } = require('../../src/observability/metricas');
const { detectarForcaBruta } = require('../../src/validation/referencia-forca-bruta');
const { haversine } = require('../../src/core/haversine');
const { aoNorte, aLeste, aleatorio, chave } = require('../helpers/util');

const classificar = criarClassificador();

/** Roda a grade e a força bruta sobre os mesmos pontos de um timestamp. */
function comparar(pontos) {
  const pessoas = pontos.map((p, i) => ({ id: i + 1, faccao: p.faccao || '', vitima: !!p.vitima, restricoes: new Set(p.restricoes || []) }));
  const metricas = criarMetricas();
  const grade = [];
  const processar = criarProcessadorDeGrupo({ pessoas, classificar, aoEncontrar: (e) => grade.push(e), metricas });
  const n = pontos.length;
  processar('2024-01-01 00:00:00', n, Int32Array.from({ length: n }, (_, i) => i), Float64Array.from(pontos, (p) => p.lat), Float64Array.from(pontos, (p) => p.lon));
  const ref = detectarForcaBruta(
    new Map([['2024-01-01 00:00:00', pontos.map((p, i) => ({ id: i + 1, lat: p.lat, lon: p.lon }))]]),
    new Map(pessoas.map((p) => [p.id, p])),
    classificar
  );
  return { grade, ref, metricas };
}

function mesmos(a, b) {
  assert.deepStrictEqual(a.map(chave).sort(), b.map(chave).sort());
}

/** Pontos aleatórios + pares plantados a distâncias conhecidas. */
function cenario(semente, lat0, lon0, larguraM, n) {
  const r = aleatorio(semente);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const lat = aoNorte(lat0, (r() - 0.5) * larguraM);
    pts.push({ lat, lon: aLeste(lat, lon0, (r() - 0.5) * larguraM) });
  }
  return pts;
}

test('grade = força bruta em área densa (muitos encontros)', () => {
  const { grade, ref, metricas } = comparar(cenario(1, -3.1, -60.02, 300, 400));
  assert.ok(ref.length > 100);
  mesmos(grade, ref);
  assert.ok(metricas.paresCandidatos < metricas.paresForcaBruta);
});

test('grade = força bruta em área espalhada', () => {
  const { grade, ref } = comparar(cenario(2, -15, -47, 20000, 600));
  mesmos(grade, ref);
});

test('grade = força bruta em latitudes altas (60°, 75°, 84°)', () => {
  for (const [i, lat] of [60, 75, 84].entries()) {
    const { grade, ref } = comparar(cenario(10 + i, lat, 20, 400, 300));
    assert.ok(ref.length > 0, `sem encontros em ${lat}°`);
    mesmos(grade, ref);
  }
});

test('perto do polo (89.9999°) usa força bruta e não perde o par', () => {
  const pts = cenario(20, 80, 0, 5000, 60);
  pts.push({ lat: 89.9999, lon: 0 }, { lat: 89.9999, lon: 0.8 }); // ~0,16 m de distância
  const { grade, ref, metricas } = comparar(pts);
  assert.ok(grade.some((e) => e.monitoradosEncontro.join() === '61,62'));
  assert.strictEqual(metricas.gruposFallback, 1);
  mesmos(grade, ref);
});

test('no antimeridiano (±180°) usa força bruta e não perde o par', () => {
  const pts = cenario(21, 0, 10, 5000, 60);
  pts.push({ lat: 0, lon: 179.99995 }, { lat: 0, lon: -179.99995 }); // ~11 m
  const { grade, ref } = comparar(pts);
  assert.ok(grade.some((e) => e.monitoradosEncontro.join() === '61,62'));
  mesmos(grade, ref);
});

test('pares em células vizinhas e exatamente na fronteira da célula', () => {
  const base = Math.floor(-3.1 / GRAUS_LAT_POR_CELULA) * GRAUS_LAT_POR_CELULA; // borda exata de uma célula
  const pts = cenario(30, 10, 10, 5000, 50); // pontos longe, só para passar do limiar da força bruta
  const lon = -60;
  pts.push(
    { lat: base, lon }, // na borda
    { lat: aoNorte(base, -0.5), lon }, // logo abaixo (outra célula), 0,5 m
    { lat: aoNorte(base, 19.9), lon: aLeste(base, lon, 0) }, // 19,9 m acima
    { lat: aoNorte(base, 10), lon: aLeste(base, lon, 12) } // diagonal
  );
  const { grade, ref } = comparar(pts);
  mesmos(grade, ref);
  assert.ok(grade.length >= 4);
});

test('fronteira de distância: 19,99 m entra; 20,01 m não; ~20 m segue o Haversine', () => {
  const lat = -10;
  const lon = -37;
  const pts = cenario(40, 30, 30, 5000, 40);
  pts.push({ lat, lon }, { lat: aoNorte(lat, 19.99), lon }); // 41-42
  pts.push({ lat: lat + 1, lon }, { lat: aoNorte(lat + 1, 20.01), lon }); // 43-44
  const l20 = aoNorte(lat + 2, 20);
  pts.push({ lat: lat + 2, lon }, { lat: l20, lon }); // 45-46
  const { grade, ref } = comparar(pts);
  const ids = new Set(grade.map((e) => e.monitoradosEncontro.join()));
  assert.ok(ids.has('41,42'));
  assert.ok(!ids.has('43,44'));
  assert.strictEqual(ids.has('45,46'), haversine(lat + 2, lon, l20, lon) < 20);
  mesmos(grade, ref);
});

test('cada par aparece uma única vez e com ids em ordem crescente', () => {
  const { grade } = comparar(cenario(50, -3.1, -60, 150, 300));
  const vistos = new Set();
  for (const e of grade) {
    const [a, b] = e.monitoradosEncontro;
    assert.ok(a < b);
    const k = `${a}-${b}`;
    assert.ok(!vistos.has(k), `par repetido ${k}`);
    vistos.add(k);
  }
});

test('reaproveita a tabela entre timestamps sem misturar grupos', () => {
  const pessoas = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, faccao: '', vitima: false, restricoes: new Set() }));
  const metricas = criarMetricas();
  const enc = [];
  const processar = criarProcessadorDeGrupo({ pessoas, classificar, aoEncontrar: (e) => enc.push(e), metricas });
  const gP = Int32Array.from({ length: 100 }, (_, i) => i);
  const r = aleatorio(60);
  for (let t = 0; t < 30; t++) {
    const lat = Float64Array.from({ length: 100 }, () => -3.1 + r() * 0.002);
    const lon = Float64Array.from({ length: 100 }, () => -60 + r() * 0.002);
    const antes = enc.length;
    processar(`t${t}`, 100, gP, lat, lon);
    const pontos = Array.from(gP, (i) => ({ id: i + 1, lat: lat[i], lon: lon[i] }));
    const ref = detectarForcaBruta(new Map([[`t${t}`, pontos]]), new Map(pessoas.map((p) => [p.id, p])), classificar);
    mesmos(enc.slice(antes), ref);
  }
});
