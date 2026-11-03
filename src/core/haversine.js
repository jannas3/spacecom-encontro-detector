'use strict';

const { RAIO_TERRA_METROS, LIMITE_METROS } = require('../config/configuracoes');

const RAD = Math.PI / 180;

/** Metros por grau de latitude (exato numa esfera). */
const METROS_POR_GRAU_LAT = RAIO_TERRA_METROS * RAD;

const paraRad = (graus) => (graus * Math.PI) / 180;

/**
 * Distância entre dois pontos pela fórmula de Haversine, em metros.
 *   a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)
 *   d = 2R · asin(√a)
 *
 * A forma com asin e a conversão (graus·π)/180 foram escolhidas porque
 * reproduzem BIT A BIT as distâncias dos gabaritos oficiais (10 de 10 encontros
 * em respostas1/2.json). A forma equivalente 2R·atan2(√a, √(1−a)) é idêntica na
 * matemática, mas diverge no 16º dígito em 2 dos 10 casos. Nenhum par detectado
 * muda com a troca (conferido nos 7 datasets).
 */
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = paraRad(lat2 - lat1);
  const dLon = paraRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(paraRad(lat1)) * Math.cos(paraRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA_METROS * Math.asin(Math.sqrt(a));
}

/** Regra do desafio: encontro é distância ESTRITAMENTE menor que 20 m, sem arredondar. */
function ehEncontro(distanciaMetros) {
  return distanciaMetros < LIMITE_METROS;
}

/**
 * Filtro preliminar seguro: a distância de Haversine nunca é menor que R·|Δφ|
 * (mudar de latitude exige percorrer pelo menos esse arco de meridiano).
 * Se |Δlat| em graus já passa disso, o par não pode ser encontro.
 * A margem 1e-4 absorve diferenças de arredondamento.
 */
const FILTRO_LAT_GRAUS = (LIMITE_METROS / METROS_POR_GRAU_LAT) * 1.0001;

module.exports = { haversine, ehEncontro, RAD, METROS_POR_GRAU_LAT, FILTRO_LAT_GRAUS };
