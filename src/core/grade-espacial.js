'use strict';

const {
  LIMITE_METROS,
  CELULA_METROS,
  LIMIAR_FORCA_BRUTA,
  LATITUDE_MAX_GRADE,
  LONGITUDE_MAX_GRADE,
} = require('../config/configuracoes');
const { haversine, ehEncontro, RAD, METROS_POR_GRAU_LAT, FILTRO_LAT_GRAUS } = require('./haversine');

/**
 * Busca de pares próximos dentro de UM timestamp.
 *
 * Grade uniforme (spatial hashing) com células de CELULA_METROS (25 m > 20 m).
 *
 * Propriedade de cobertura (por que nenhum encontro se perde):
 *  - Latitude: a célula tem 25 m de altura em graus exatos (25 / METROS_POR_GRAU_LAT).
 *    Dois pontos a < 20 m têm |Δlat| < 20 m (d ≥ R·|Δφ|), então ficam na mesma
 *    linha de células ou em linhas adjacentes.
 *  - Longitude: um grau de longitude mede METROS_POR_GRAU_LAT·cos φ. A largura da
 *    célula usa a MAIOR |latitude| do grupo, ou seja, o menor cos φ: a célula fica
 *    mais larga (em graus) do que precisa para qualquer ponto do grupo. A folga de
 *    25/20 cobre a pequena diferença entre arco de paralelo e arco de círculo máximo.
 *  - Logo, o par está na mesma célula ou numa das 8 vizinhas. A varredura visita a
 *    própria célula e 4 vizinhas ("meia vizinhança"); as outras 4 são visitadas a
 *    partir da célula vizinha, então cada par de células é visto exatamente 1 vez.
 *  - Exceções: acima de LATITUDE_MAX_GRADE (cos φ → 0) e perto de ±180° de longitude
 *    (pontos vizinhos caem em extremos opostos da grade) o grupo usa força bruta.
 *
 * A grade só escolhe candidatos. A decisão é sempre do Haversine (< 20 m).
 */

const GRAUS_LAT_POR_CELULA = CELULA_METROS / METROS_POR_GRAU_LAT;
const VIZINHAS_DX = [0, 1, 1, 1];
const VIZINHAS_DY = [1, -1, 0, 1];

/**
 * @param {object} p
 * @param {Array} p.pessoas        cadastro indexado (posição = índice da pessoa)
 * @param {Function} p.classificar (a, b) => tipo | null
 * @param {Function} p.aoEncontrar (encontro) => void
 * @param {object} p.metricas      contadores (ver observability/metricas)
 * @returns {(ts:string, n:number, gP:Int32Array, gLat:Float64Array, gLon:Float64Array) => void}
 *
 * Implementação: a grade é uma tabela hash de endereçamento aberto em typed
 * arrays, reaproveitada entre timestamps (um "número de geração" invalida a
 * tabela inteira em O(1)). Os pontos de cada célula ficam numa lista ligada
 * (cabeca/proximo). Assim nenhum objeto é alocado por timestamp, o que importa
 * quando há centenas de milhares de timestamps.
 */
function criarProcessadorDeGrupo({ pessoas, classificar, aoEncontrar, metricas }) {
  // por ponto
  let celX = new Int32Array(0);
  let celY = new Int32Array(0);
  let proximo = new Int32Array(0);
  // tabela hash de células
  let mascara = 0;
  let tabX = new Int32Array(0);
  let tabY = new Int32Array(0);
  let cabeca = new Int32Array(0);
  let geracaoDe = new Int32Array(0);
  let ocupadas = new Int32Array(0);
  let geracao = 0;

  // grupo atual (evita criar uma closure por timestamp)
  let P;
  let LAT;
  let LON;
  let TS;
  let candidatos = 0;
  let calculos = 0;

  function garantirCapacidade(n) {
    if (celX.length < n) {
      const tam = Math.max(n, celX.length * 2, 64);
      celX = new Int32Array(tam);
      celY = new Int32Array(tam);
      proximo = new Int32Array(tam);
      ocupadas = new Int32Array(tam);
    }
    let tamTabela = 1;
    while (tamTabela < n * 4) tamTabela <<= 1;
    if (tabX.length < tamTabela) {
      tabX = new Int32Array(tamTabela);
      tabY = new Int32Array(tamTabela);
      cabeca = new Int32Array(tamTabela);
      geracaoDe = new Int32Array(tamTabela);
      mascara = tamTabela - 1;
    }
  }

  /** Posição da célula (x, y) na tabela: a própria, se já existe neste grupo, ou o slot livre onde ficaria. */
  function slot(x, y) {
    let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77)) & mascara;
    while (geracaoDe[h] === geracao && (tabX[h] !== x || tabY[h] !== y)) h = (h + 1) & mascara;
    return h;
  }

  function avaliar(i, j) {
    candidatos++;
    const la = LAT[i];
    const lb = LAT[j];
    if (la - lb >= FILTRO_LAT_GRAUS || lb - la >= FILTRO_LAT_GRAUS) return;
    calculos++;
    const d = haversine(la, LON[i], lb, LON[j]);
    if (!ehEncontro(d)) return;
    const a = pessoas[P[i]];
    const b = pessoas[P[j]];
    const tipo = classificar(a, b);
    if (!tipo) return;
    const inverter = compararIds(a.id, b.id) > 0;
    const x = inverter ? j : i;
    const y = inverter ? i : j;
    const px = inverter ? b : a;
    const py = inverter ? a : b;
    aoEncontrar({
      tipo,
      monitoradosEncontro: [px.id, py.id],
      timestamp: TS,
      posicoes: {
        [px.id]: { lat: LAT[x], lon: LON[x] },
        [py.id]: { lat: LAT[y], lon: LON[y] },
      },
      distanciaMetros: d,
    });
  }

  return function processarGrupo(ts, n, gP, gLat, gLon) {
    if (n < 2) return;
    P = gP;
    LAT = gLat;
    LON = gLon;
    TS = ts;
    candidatos = 0;
    calculos = 0;
    metricas.paresForcaBruta += (n * (n - 1)) / 2;

    let maxAbsLat = 0;
    let maxAbsLon = 0;
    for (let i = 0; i < n; i++) {
      const la = gLat[i] < 0 ? -gLat[i] : gLat[i];
      const lo = gLon[i] < 0 ? -gLon[i] : gLon[i];
      if (la > maxAbsLat) maxAbsLat = la;
      if (lo > maxAbsLon) maxAbsLon = lo;
    }

    const precisaForcaBruta = maxAbsLat > LATITUDE_MAX_GRADE || maxAbsLon > LONGITUDE_MAX_GRADE;
    if (n <= LIMIAR_FORCA_BRUTA || precisaForcaBruta) {
      if (precisaForcaBruta && n > LIMIAR_FORCA_BRUTA) metricas.gruposFallback++;
      else metricas.gruposForcaBruta++;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) avaliar(i, j);
    } else {
      metricas.gruposGrade++;
      garantirCapacidade(n);
      geracao++;
      const grausLon = GRAUS_LAT_POR_CELULA / Math.cos(maxAbsLat * RAD);

      // distribui os pontos nas células
      let nOcupadas = 0;
      for (let i = 0; i < n; i++) {
        const x = Math.floor(gLat[i] / GRAUS_LAT_POR_CELULA);
        const y = Math.floor(gLon[i] / grausLon);
        celX[i] = x;
        celY[i] = y;
        const h = slot(x, y);
        if (geracaoDe[h] !== geracao) {
          geracaoDe[h] = geracao;
          tabX[h] = x;
          tabY[h] = y;
          cabeca[h] = -1;
          ocupadas[nOcupadas++] = h;
        }
        proximo[i] = cabeca[h];
        cabeca[h] = i;
      }

      // pares na própria célula + meia vizinhança
      for (let k = 0; k < nOcupadas; k++) {
        const h = ocupadas[k];
        const primeiro = cabeca[h];
        for (let i = primeiro; i !== -1; i = proximo[i]) for (let j = proximo[i]; j !== -1; j = proximo[j]) avaliar(i, j);
        const x = tabX[h];
        const y = tabY[h];
        for (let v = 0; v < 4; v++) {
          const h2 = slot(x + VIZINHAS_DX[v], y + VIZINHAS_DY[v]);
          if (geracaoDe[h2] !== geracao) continue;
          for (let i = primeiro; i !== -1; i = proximo[i]) for (let j = cabeca[h2]; j !== -1; j = proximo[j]) avaliar(i, j);
        }
      }
    }
    metricas.paresCandidatos += candidatos;
    metricas.calculosHaversine += calculos;
  };
}

/** Ordem de ids: numérica quando os dois são números, senão textual. */
function compararIds(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

module.exports = { criarProcessadorDeGrupo, compararIds, GRAUS_LAT_POR_CELULA, LIMITE_METROS };
