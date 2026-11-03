'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { haversine, ehEncontro, FILTRO_LAT_GRAUS, METROS_POR_GRAU_LAT } = require('../../src/core/haversine');
const { aoNorte, aleatorio } = require('../helpers/util');

test('reproduz o exemplo do enunciado bit a bit (pessoas 40 e 44)', () => {
  assert.strictEqual(haversine(-10.07996, -37.08384, -10.07987, -37.08389), 11.406788673336607);
});

test('é simétrica e zero para o mesmo ponto', () => {
  assert.strictEqual(haversine(-3.1, -60.02, -3.1, -60.02), 0);
  const r = aleatorio(7);
  for (let k = 0; k < 200; k++) {
    const [a, b, c, d] = [r() * 180 - 90, r() * 360 - 180, r() * 180 - 90, r() * 360 - 180];
    assert.ok(Math.abs(haversine(a, b, c, d) - haversine(c, d, a, b)) < 1e-6);
  }
});

test('ao longo do meridiano, d = R·Δφ', () => {
  for (const lat of [-80, -33.5, 0, 12.25, 60]) {
    assert.ok(Math.abs(haversine(lat, 10, aoNorte(lat, 15), 10) - 15) < 1e-6);
  }
});

test('funciona com coordenadas negativas e nos extremos', () => {
  assert.ok(Math.abs(haversine(-89.99999, 0, -89.99999, 180) - 2 * 0.00001 * METROS_POR_GRAU_LAT) < 1e-3);
  assert.ok(Math.abs(haversine(0, 179.99995, 0, -179.99995) - 11.119) < 1e-2);
});

test('ehEncontro: limite estritamente menor que 20 m, sem arredondar', () => {
  assert.strictEqual(ehEncontro(19.99), true);
  assert.strictEqual(ehEncontro(19.999999999999996), true);
  assert.strictEqual(ehEncontro(20), false);
  assert.strictEqual(ehEncontro(20.01), false);
});

test('filtro de latitude nunca descarta um par a menos de 20 m', () => {
  const r = aleatorio(11);
  for (let k = 0; k < 5000; k++) {
    const lat = r() * 170 - 85;
    const lon = r() * 340 - 170;
    const lat2 = lat + (r() - 0.5) * 0.0004;
    const lon2 = lon + (r() - 0.5) * 0.0004;
    if (haversine(lat, lon, lat2, lon2) < 20) assert.ok(Math.abs(lat - lat2) < FILTRO_LAT_GRAUS);
  }
});
