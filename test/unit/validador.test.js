'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { compararResultados, problemasDoEncontro, formatarRelatorio } = require('../../src/validation/validador');
const { haversine } = require('../../src/core/haversine');

function encontro(a, b, { tipo = 'generico', ts = '2024-01-01 00:00:00', lat = -10.07996, lon = -37.08384 } = {}) {
  const lat2 = lat + 0.00009;
  const lon2 = lon - 0.00005;
  return { tipo, monitoradosEncontro: [a, b], timestamp: ts, posicoes: { [a]: { lat, lon }, [b]: { lat: lat2, lon: lon2 } }, distanciaMetros: haversine(lat, lon, lat2, lon2) };
}

test('saída idêntica: score = total, perfeito', () => {
  const esp = [encontro(1, 2), encontro(3, 4, { tipo: 'faccao' })];
  const r = compararResultados(JSON.parse(JSON.stringify(esp)), esp);
  assert.strictEqual(r.perfeito, true);
  assert.strictEqual(r.score, 2);
});

test('ordem dos ids no array não importa', () => {
  const esp = [encontro(1, 2)];
  const ger = [{ ...encontro(1, 2), monitoradosEncontro: [2, 1] }];
  assert.strictEqual(compararResultados(ger, esp).corretos, 1);
});

test('duplicação é contada (não é escondida pelo Map) e penaliza o score', () => {
  const esp = [encontro(1, 2)];
  const ger = [encontro(1, 2), { ...encontro(1, 2), monitoradosEncontro: [2, 1] }];
  const r = compararResultados(ger, esp);
  assert.strictEqual(r.duplicados.length, 1);
  assert.strictEqual(r.perfeito, false);
  assert.strictEqual(r.score, 0);
});

test('falso positivo, falso negativo e tipo errado', () => {
  const esp = [encontro(1, 2), encontro(3, 4, { tipo: 'protetiva' })];
  const ger = [encontro(3, 4, { tipo: 'generico' }), encontro(5, 6)];
  const r = compararResultados(ger, esp);
  assert.strictEqual(r.falsosPositivos.length, 1);
  assert.strictEqual(r.falsosNegativos.length, 1);
  assert.strictEqual(r.tipoErrado.length, 1);
  assert.strictEqual(r.score, -2);
});

test('mesmo par em timestamps diferentes são encontros distintos', () => {
  const esp = [encontro(1, 2, { ts: '2024-01-01 00:00:00' }), encontro(1, 2, { ts: '2024-01-01 00:00:05' })];
  const r = compararResultados(esp, esp);
  assert.strictEqual(r.corretos, 2);
  assert.strictEqual(r.duplicados.length, 0);
});

test('detecta campos ausentes, tipo inválido, distância incoerente e ≥ 20 m', () => {
  const ok = encontro(1, 2);
  assert.deepStrictEqual(problemasDoEncontro(ok), []);
  assert.match(problemasDoEncontro({ ...ok, tipo: 'outro' })[0], /tipo inválido/);
  const semPos = { ...ok };
  delete semPos.posicoes;
  assert.match(problemasDoEncontro(semPos)[0], /campo ausente: posicoes/);
  assert.match(problemasDoEncontro({ ...ok, distanciaMetros: 5 }).join(), /não confere com as posições/);
  assert.match(problemasDoEncontro({ ...ok, distanciaMetros: 20 }).join(), /não é menor que 20/);
  assert.match(problemasDoEncontro({ ...ok, timestamp: '2024-01-01T00:00:00' }).join(), /timestamp fora do formato/);
  assert.match(problemasDoEncontro({ ...ok, monitoradosEncontro: [1, 1] }).join(), /mesmo id/);
  assert.deepStrictEqual(problemasDoEncontro(null), ['não é um objeto']);
});

test('registro inválido na saída penaliza o score e aparece no relatório', () => {
  const esp = [encontro(1, 2)];
  const ger = [encontro(1, 2), { tipo: 'generico' }];
  const r = compararResultados(ger, esp);
  assert.strictEqual(r.invalidos.length, 1);
  assert.strictEqual(r.score, 0);
  assert.match(formatarRelatorio(r, { gerado: ger, esperado: esp }), /Registros inválidos na saída: 1/);
});

test('estrutura que não é array gera erro claro', () => {
  assert.throws(() => compararResultados({}, []), /precisa ser um array/);
});
