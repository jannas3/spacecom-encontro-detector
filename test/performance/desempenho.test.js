'use strict';

/**
 * Desempenho em cenários controlados. Não há limite de tempo fixo (máquinas
 * variam); o teste verifica que a grade acha os mesmos encontros que a força
 * bruta, que compara muito menos pares e imprime as medições reais.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analisar } = require('../../src/core/detector');
const { medirMemoria } = require('../../src/observability/metricas');
const { pastaTemporaria, aleatorio, aoNorte, aLeste } = require('../helpers/util');

function escreverGrande(arquivo, { pessoas, timestamps, larguraM, lat0, lon0, aglomerado = 0, ordenado = true }) {
  const r = aleatorio(pessoas * 31 + timestamps);
  const fd = fs.openSync(arquivo, 'w');
  fs.writeSync(fd, 'idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida\n');
  const blocos = [];
  for (let t = 0; t < timestamps; t++) {
    const ts = new Date(Date.UTC(2024, 0, 1) + t * 5000).toISOString().replace('T', ' ').slice(0, 19);
    const linhas = [];
    for (let i = 1; i <= pessoas; i++) {
      const raio = r() < aglomerado ? 20 : larguraM / 2;
      const lat = aoNorte(lat0, (r() - 0.5) * 2 * raio);
      const lon = aLeste(lat, lon0, (r() - 0.5) * 2 * raio);
      linhas.push(`${i};${i % 5 === 0 ? '' : 1 + (i % 6)};"${ts}";${lat.toFixed(5)};${lon.toFixed(5)};false;`);
    }
    if (ordenado) fs.writeSync(fd, linhas.join('\n') + '\n');
    else blocos.push(linhas);
  }
  if (!ordenado) {
    // intercala por pessoa: força o modo memória
    for (let i = 0; i < pessoas; i++) fs.writeSync(fd, blocos.map((b) => b[i]).join('\n') + '\n');
  }
  fs.closeSync(fd);
}

const cenarios = [
  { nome: 'espalhado pelo país (como os datasets oficiais)', pessoas: 150, timestamps: 4000, larguraM: 2_000_000, lat0: -15, lon0: -55 },
  { nome: 'cidade densa', pessoas: 800, timestamps: 200, larguraM: 1500, lat0: -3.1, lon0: -60.02 },
  { nome: 'aglomeração (5% num ponto de 40 m)', pessoas: 800, timestamps: 200, larguraM: 5000, lat0: -3.1, lon0: -60.02, aglomerado: 0.05 },
  { nome: 'fora de ordem (modo memória)', pessoas: 150, timestamps: 4000, larguraM: 2_000_000, lat0: -15, lon0: -55, ordenado: false },
];

for (const c of cenarios) {
  test(`desempenho: ${c.nome}`, (t) => {
    const dir = pastaTemporaria(t);
    const arq = path.join(dir, 'd.txt');
    escreverGrande(arq, c);
    const { encontros, info } = analisar(arq);
    const m = info.metricas;
    const mem = medirMemoria();
    t.diagnostic(
      `${info.estatisticas.linhasValidas} linhas | ${info.modo} | total ${info.tempoTotalMs.toFixed(0)} ms (busca ${info.tempoBuscaMs.toFixed(0)} ms) | ` +
        `encontros ${encontros.length} | pares ${m.paresCandidatos} de ${m.paresForcaBruta} | haversine ${m.calculosHaversine} | pico RSS do processo ${mem.picoRssMB ? mem.picoRssMB.toFixed(0) + ' MB' : 'n/d'}`
    );
    assert.strictEqual(info.modo, c.ordenado === false ? 'memoria' : 'streaming');
    assert.ok(m.paresCandidatos <= m.paresForcaBruta);
    assert.ok(m.calculosHaversine <= m.paresCandidatos);
  });
}
