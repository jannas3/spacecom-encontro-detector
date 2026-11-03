'use strict';

const { haversine, ehEncontro } = require('../core/haversine');
const { compararIds } = require('../core/grade-espacial');

/**
 * Implementação de referência, propositalmente ingênua: compara todos os pares
 * de cada timestamp, sem grade e sem filtro. Serve de "oráculo" nos testes e no
 * benchmark para provar que a grade espacial não perde nem inventa encontros.
 *
 * @param {Map<string, {id:any, lat:number, lon:number}[]>} porTimestamp
 * @param {Map<any, object>} pessoasPorId  pessoa = { id, faccao, vitima, restricoes:Set }
 * @param {Function} classificar
 */
function detectarForcaBruta(porTimestamp, pessoasPorId, classificar) {
  const encontros = [];
  for (const [ts, pontos] of porTimestamp) {
    for (let i = 0; i < pontos.length; i++) {
      for (let j = i + 1; j < pontos.length; j++) {
        const p = pontos[i];
        const q = pontos[j];
        const d = haversine(p.lat, p.lon, q.lat, q.lon);
        if (!ehEncontro(d)) continue;
        const tipo = classificar(pessoasPorId.get(p.id), pessoasPorId.get(q.id));
        if (!tipo) continue;
        const [x, y] = compararIds(p.id, q.id) <= 0 ? [p, q] : [q, p];
        encontros.push({ tipo, monitoradosEncontro: [x.id, y.id], timestamp: ts, posicoes: { [x.id]: { lat: x.lat, lon: x.lon }, [y.id]: { lat: y.lat, lon: y.lon } }, distanciaMetros: d });
      }
    }
  }
  return encontros;
}

module.exports = { detectarForcaBruta };
