'use strict';

/**
 * Contadores e cronômetros de uma execução. Todos os números vêm de medição
 * real; nada é estimado.
 */
function criarMetricas() {
  return {
    paresForcaBruta: 0, // n(n-1)/2 somado por timestamp: o que a força bruta compararia
    paresCandidatos: 0, // pares que a grade mandou avaliar
    calculosHaversine: 0, // pares que passaram do filtro de latitude
    gruposGrade: 0,
    gruposForcaBruta: 0, // grupos pequenos (≤ LIMIAR_FORCA_BRUTA)
    gruposFallback: 0, // grupos grandes perto dos polos/antimeridiano
    tempoProcessamentoNs: 0n, // tempo dentro da busca de pares
  };
}

/** Executa fn medindo o tempo em nanossegundos (BigInt) e acumula em metricas.tempoProcessamentoNs. */
function cronometrar(metricas, fn) {
  const t0 = process.hrtime.bigint();
  try {
    return fn();
  } finally {
    metricas.tempoProcessamentoNs += process.hrtime.bigint() - t0;
  }
}

const nsParaMs = (ns) => Number(ns) / 1e6;

/** Memória atual e pico do processo (pico via resourceUsage().maxRSS, em KB). */
function medirMemoria() {
  const m = process.memoryUsage();
  let picoRssMB = null;
  if (typeof process.resourceUsage === 'function') {
    const kb = process.resourceUsage().maxRSS;
    // Em Linux/macOS/Windows o Node normaliza maxRSS para kilobytes.
    picoRssMB = kb / 1024;
  }
  return {
    rssMB: m.rss / 1048576,
    heapUsadoMB: m.heapUsed / 1048576,
    arrayBuffersMB: (m.arrayBuffers || 0) / 1048576,
    picoRssMB,
  };
}

module.exports = { criarMetricas, cronometrar, nsParaMs, medirMemoria };
