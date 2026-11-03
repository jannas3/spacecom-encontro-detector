'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { METROS_POR_GRAU_LAT, RAD } = require('../../src/core/haversine');

const CABECALHO = 'idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida';

/** Pasta temporária própria do teste, removida no fim. */
function pastaTemporaria(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecom-teste-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function escreverDataset(dir, nome, linhas, { cabecalho = true, quebra = '\n' } = {}) {
  const p = path.join(dir, nome);
  fs.writeFileSync(p, (cabecalho ? [CABECALHO, ...linhas] : linhas).join(quebra));
  return p;
}

/** Ponto a `metros` ao norte de (lat, lon), exato ao longo do meridiano. */
const aoNorte = (lat, metros) => lat + metros / METROS_POR_GRAU_LAT;
/** Ponto a ~`metros` a leste de (lat, lon). */
const aLeste = (lat, lon, metros) => lon + metros / (METROS_POR_GRAU_LAT * Math.cos(lat * RAD));

/** Gerador pseudoaleatório com semente (resultados reproduzíveis). */
function aleatorio(semente) {
  let s = semente >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const chave = (e) => `${e.timestamp}|${[...e.monitoradosEncontro].map(String).sort().join('-')}|${e.tipo}`;

module.exports = { CABECALHO, pastaTemporaria, escreverDataset, aoNorte, aLeste, aleatorio, chave };
