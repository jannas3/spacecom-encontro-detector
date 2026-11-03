'use strict';

/**
 * Testes com dados sintéticos: node test/teste.js
 * Confere Haversine contra o exemplo do enunciado, as 3 classificações,
 * o limite estrito de 20 m, a unicidade e que a grade espacial dá o mesmo
 * resultado que a força bruta num cenário grande e aleatório.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectar, haversine } = require('../src/detector');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecom-'));
const escrever = (nome, linhas) => {
  const p = path.join(tmp, nome);
  fs.writeFileSync(p, ['idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida', ...linhas].join('\n'));
  return p;
};

// 1) Haversine bate com o exemplo do e-mail
const d = haversine(-10.07996, -37.08384, -10.07987, -37.08389);
assert.ok(Math.abs(d - 11.406788673336607) < 1e-9, `haversine: ${d}`);
console.log('ok  haversine igual ao exemplo:', d);

// 2) Classificações + timestamp + unicidade
const ts = '2024-01-01 00:01:50';
const p = escrever('basico.txt', [
  `40;F1;${ts};-10.07996;-37.08384;false;`,
  `44;F1;${ts};-10.07987;-37.08389;false;`, // faccao com 40
  `50;F2;${ts};-10.07990;-37.08380;false;`, // generico com 40 e 44
  `90;;${ts};-10.07995;-37.08386;true;"40,77"`, // vítima de 40 -> protetiva com 40; com 44/50 ignorado
  `40;F1;2024-01-01 00:01:55;-10.20000;-37.20000;false;`, // outro timestamp, longe
  `44;F1;2024-01-01 00:01:55;-10.20000;-37.20000;false;`, // encontro no outro timestamp
  `44;F1;2024-01-01 00:01:55;-10.20000;-37.20000;false;`, // linha duplicada — não pode duplicar encontro
]);
const r = detectar(p);
const k = (e) => `${e.timestamp}|${[...e.monitoradosEncontro].sort((a, b) => a - b).join('-')}|${e.tipo}`;
const got = new Set(r.map(k));
const esperado = [
  `${ts}|40-44|faccao`,
  `${ts}|40-50|generico`,
  `${ts}|44-50|generico`,
  `${ts}|40-90|protetiva`,
  `2024-01-01 00:01:55|40-44|faccao`,
];
assert.deepStrictEqual([...got].sort(), esperado.sort());
assert.strictEqual(r.length, esperado.length);
console.log('ok  classificação, timestamp e unicidade');

// 2b) Formato real: campos entre aspas, CRLF, BOM e arquivo FORA de ordem (força o modo memória)
const p2b = path.join(tmp, 'aspas.txt');
fs.writeFileSync(p2b, '\uFEFF' + [
  'idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida',
  `"44";"1";"2024-01-01 00:01:55";-10.20000;-37.20000;"false";""`,
  `"40";"1";"${ts}";-10.07996;-37.08384;"false";""`,
  `"9";"";"${ts}";-10.07990;-37.08386;"true";"10,40"`,
  `"40";"1";"2024-01-01 00:01:55";-10.20003;-37.20000;"false";""`,
  `"44";"1";"${ts}";-10.07987;-37.08389;"false";""`,
].join('\r\n'));
const info = {};
const r2b = detectar(p2b, { info });
assert.strictEqual(info.modo, 'memoria');
assert.deepStrictEqual(r2b.map(k).sort(), [
  `2024-01-01 00:01:55|40-44|faccao`, `${ts}|40-44|faccao`, `${ts}|9-40|protetiva`,
].sort());
assert.ok(r2b.every((e) => !e.timestamp.includes('"')));
const ex = r2b.find((e) => e.timestamp === ts && e.tipo === 'faccao');
assert.strictEqual(ex.distanciaMetros, 11.406788673336607);
assert.deepStrictEqual(ex.posicoes, { 40: { lat: -10.07996, lon: -37.08384 }, 44: { lat: -10.07987, lon: -37.08389 } });
console.log('ok  aspas, CRLF, BOM e arquivo fora de ordem');

// 3) Limite estrito: < 20 m entra, >= 20 m não
const passo = 20 / (6371000 * Math.PI / 180); // graus de latitude equivalentes a 20 m
const p3 = escrever('limite.txt', [
  `1;;${ts};0;0;false;`,
  `2;;${ts};${(passo * 0.999).toFixed(8)};0;false;`,
  `3;;${ts};${-(passo * 1.001).toFixed(8)};0;false;`,
]);
const r3 = detectar(p3).map((e) => e.monitoradosEncontro.join('-'));
assert.deepStrictEqual(r3, ['1-2']);
console.log('ok  limite de 20 m é estrito');

// 4) Grade espacial == força bruta (cenário aleatório denso)
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const linhas = [];
const N = 3000;
for (let t = 0; t < 3; t++) {
  const tsx = `2026-10-01 00:00:0${t * 5}`;
  for (let i = 1; i <= N; i++) {
    const lat = -3.1 + rnd() * 0.01; // ~1 km x 1 km em Manaus => muitos encontros
    const lon = -60.02 + rnd() * 0.01;
    linhas.push(`${i};${i % 7 ? 'F' + (i % 5) : ''};${tsx};${lat.toFixed(5)};${lon.toFixed(5)};false;`);
  }
}
const p4 = escrever('aleatorio.txt', linhas);
const rg = detectar(p4);
// força bruta de referência
const pts = new Map();
for (const l of linhas) {
  const [id, , tsx, la, lo] = l.split(';');
  if (!pts.has(tsx)) pts.set(tsx, []);
  pts.get(tsx).push([id, +la, +lo]);
}
let total = 0;
for (const arr of pts.values())
  for (let i = 0; i < arr.length; i++)
    for (let j = i + 1; j < arr.length; j++) if (haversine(arr[i][1], arr[i][2], arr[j][1], arr[j][2]) < 20) total++;
assert.strictEqual(rg.length, total);
console.log(`ok  grade espacial = força bruta (${total} encontros em ${N * 3} posições)`);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nTodos os testes passaram.');
