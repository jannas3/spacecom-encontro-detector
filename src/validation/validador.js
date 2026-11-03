'use strict';

const { TIPOS, LIMITE_METROS } = require('../config/configuracoes');
const { haversine } = require('../core/haversine');
const { timestampValido } = require('../infrastructure/parser');

/**
 * Validador de resultados: compara a saída gerada com a resposta oficial.
 *
 * Identidade de um encontro: timestamp + menor id + maior id (a ordem dos ids no
 * array não importa). Duplicações são CONTADAS antes de qualquer agrupamento,
 * para não serem escondidas por um Map que sobrescreve chaves.
 *
 * Score = soma_ec − soma_ei, onde:
 *   ec = encontros corretos (mesma identidade e mesmo tipo)
 *   ei = falsos positivos + tipo errado + duplicações + registros inválidos
 */

const TOLERANCIA_DISTANCIA_M = 1e-6;
const TIPOS_VALIDOS = new Set(TIPOS);

function chaveEncontro(e) {
  const [a, b] = e.monitoradosEncontro.map(String).sort((x, y) => {
    const nx = Number(x);
    const ny = Number(y);
    return Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x < y ? -1 : x > y ? 1 : 0;
  });
  return `${e.timestamp}|${a}|${b}`;
}

const finito = (v) => typeof v === 'number' && Number.isFinite(v);

/** Lista os problemas estruturais de um encontro (vazia = válido). */
function problemasDoEncontro(e) {
  const p = [];
  if (e === null || typeof e !== 'object' || Array.isArray(e)) return ['não é um objeto'];
  for (const campo of ['tipo', 'monitoradosEncontro', 'timestamp', 'posicoes', 'distanciaMetros']) {
    if (!(campo in e)) p.push(`campo ausente: ${campo}`);
  }
  if (p.length) return p;
  if (!TIPOS_VALIDOS.has(e.tipo)) p.push(`tipo inválido: ${JSON.stringify(e.tipo)}`);
  const ids = e.monitoradosEncontro;
  if (!Array.isArray(ids) || ids.length !== 2) p.push('monitoradosEncontro precisa ter 2 ids');
  else if (String(ids[0]) === String(ids[1])) p.push('monitoradosEncontro com o mesmo id duas vezes');
  if (!timestampValido(e.timestamp)) p.push(`timestamp fora do formato YYYY-MM-DD HH:MM:SS: ${JSON.stringify(e.timestamp)}`);
  if (!finito(e.distanciaMetros) || e.distanciaMetros < 0) p.push('distanciaMetros não é um número válido');
  else if (!(e.distanciaMetros < LIMITE_METROS)) p.push(`distanciaMetros ${e.distanciaMetros} não é menor que ${LIMITE_METROS}`);
  if (Array.isArray(ids) && ids.length === 2 && e.posicoes && typeof e.posicoes === 'object') {
    for (const id of ids) {
      const pos = e.posicoes[id];
      if (!pos || !finito(pos.lat) || !finito(pos.lon)) p.push(`posição ausente ou inválida para o id ${id}`);
    }
    if (!p.length && finito(e.distanciaMetros)) {
      const [a, b] = ids;
      const d = haversine(e.posicoes[a].lat, e.posicoes[a].lon, e.posicoes[b].lat, e.posicoes[b].lon);
      if (Math.abs(d - e.distanciaMetros) > TOLERANCIA_DISTANCIA_M) p.push(`distanciaMetros (${e.distanciaMetros}) não confere com as posições (${d})`);
    }
  } else if (!e.posicoes || typeof e.posicoes !== 'object') p.push('posicoes não é um objeto');
  return p;
}

/**
 * Indexa uma lista contando duplicações e registros inválidos.
 * @returns {{mapa: Map<string, object>, duplicados: object[], invalidos: {indice:number, problemas:string[]}[]}}
 */
function indexar(lista) {
  const mapa = new Map();
  const duplicados = [];
  const invalidos = [];
  lista.forEach((e, indice) => {
    const problemas = problemasDoEncontro(e);
    if (problemas.length) {
      invalidos.push({ indice, problemas });
      // ainda dá para identificar? então participa da comparação
      if (!e || !Array.isArray(e.monitoradosEncontro) || e.monitoradosEncontro.length !== 2 || typeof e.timestamp !== 'string') return;
    }
    const k = chaveEncontro(e);
    if (mapa.has(k)) duplicados.push({ indice, chave: k });
    else mapa.set(k, e);
  });
  return { mapa, duplicados, invalidos };
}

/**
 * Compara a saída gerada com a esperada.
 * @param {unknown} gerado
 * @param {unknown} esperado
 */
function compararResultados(gerado, esperado) {
  if (!Array.isArray(gerado)) throw new TypeError('A saída gerada precisa ser um array JSON.');
  if (!Array.isArray(esperado)) throw new TypeError('A resposta esperada precisa ser um array JSON.');

  const G = indexar(gerado);
  const E = indexar(esperado);

  const corretos = [];
  const tipoErrado = [];
  const falsosPositivos = [];
  const faltando = [];
  const distanciaDivergente = [];
  const posicaoDivergente = [];
  let maiorDiferencaDistancia = 0;

  for (const [k, e] of G.mapa) {
    const ok = E.mapa.get(k);
    if (!ok) {
      falsosPositivos.push(e);
      continue;
    }
    if (ok.tipo !== e.tipo) {
      tipoErrado.push({ gerado: e, esperado: ok });
      continue;
    }
    corretos.push(e);
    if (finito(ok.distanciaMetros) && finito(e.distanciaMetros)) {
      const dif = Math.abs(ok.distanciaMetros - e.distanciaMetros);
      maiorDiferencaDistancia = Math.max(maiorDiferencaDistancia, dif);
      if (dif > TOLERANCIA_DISTANCIA_M) distanciaDivergente.push({ gerado: e, esperado: ok, diferenca: dif });
    }
    for (const id of e.monitoradosEncontro) {
      const pg = e.posicoes && e.posicoes[id];
      const pe = ok.posicoes && ok.posicoes[id];
      if (pg && pe && (pg.lat !== pe.lat || pg.lon !== pe.lon)) {
        posicaoDivergente.push({ chave: k, id });
        break;
      }
    }
  }
  for (const [k, e] of E.mapa) if (!G.mapa.has(k)) faltando.push(e);

  const incorretos = falsosPositivos.length + tipoErrado.length + G.duplicados.length + G.invalidos.length;
  return {
    totalEsperado: esperado.length,
    totalGerado: gerado.length,
    corretos: corretos.length,
    falsosPositivos,
    falsosNegativos: faltando,
    tipoErrado,
    duplicados: G.duplicados,
    invalidos: G.invalidos,
    duplicadosNaResposta: E.duplicados,
    invalidosNaResposta: E.invalidos,
    distanciaDivergente,
    posicaoDivergente,
    maiorDiferencaDistancia,
    score: corretos.length - incorretos,
    perfeito: incorretos === 0 && faltando.length === 0 && distanciaDivergente.length === 0 && posicaoDivergente.length === 0,
  };
}

/** Contagem por tipo. */
function contarPorTipo(lista) {
  return lista.reduce((acc, e) => ((acc[e.tipo] = (acc[e.tipo] || 0) + 1), acc), {});
}

/**
 * Relatório em texto. `pessoas` (opcional) é o cadastro do dataset, usado para
 * explicar cada divergência (vítima? facção? lista de restrição?).
 */
function formatarRelatorio(rel, { pessoas = null, gerado = [], esperado = [], limite = 10 } = {}) {
  const perfil = (id) => {
    if (!pessoas) return String(id);
    const p = pessoas.get(id) ?? pessoas.get(Number(id)) ?? pessoas.get(String(id));
    if (!p) return `${id}(?)`;
    const r = p.restricoes.size ? ` restr=[${[...p.restricoes].join(',')}]` : '';
    return `${id}(${p.vitima ? 'vitima' : 'monitorado'}${p.faccao ? ' fac=' + p.faccao : ''}${r})`;
  };
  const desc = (e) => `${e.timestamp} ${e.tipo} ${Number(e.distanciaMetros).toFixed(3)}m ${perfil(e.monitoradosEncontro[0])} x ${perfil(e.monitoradosEncontro[1])}`;

  const l = [];
  l.push(`Esperados: ${rel.totalEsperado} ${JSON.stringify(contarPorTipo(esperado))}`);
  l.push(`Gerados:   ${rel.totalGerado} ${JSON.stringify(contarPorTipo(gerado))}`);
  l.push(`Corretos:  ${rel.corretos}`);
  l.push(`Falsos positivos: ${rel.falsosPositivos.length}`);
  l.push(`Falsos negativos (faltando): ${rel.falsosNegativos.length}`);
  l.push(`Tipo errado: ${rel.tipoErrado.length}`);
  l.push(`Duplicações na saída: ${rel.duplicados.length}`);
  l.push(`Registros inválidos na saída: ${rel.invalidos.length}`);
  l.push(`Distâncias divergentes (> 1e-6 m): ${rel.distanciaDivergente.length} | maior diferença: ${rel.maiorDiferencaDistancia.toExponential(2)} m`);
  l.push(`Posições divergentes: ${rel.posicaoDivergente.length}`);
  if (rel.duplicadosNaResposta.length || rel.invalidosNaResposta.length) {
    l.push(`Atenção: a resposta esperada tem ${rel.duplicadosNaResposta.length} duplicação(ões) e ${rel.invalidosNaResposta.length} registro(s) inválido(s).`);
  }
  l.push(`Score (corretos − incorretos): ${rel.score}`);

  const secao = (titulo, itens, fmt) => {
    if (!itens.length) return;
    l.push('', `${titulo} (até ${limite}):`);
    for (const x of itens.slice(0, limite)) l.push('  ' + fmt(x));
  };
  secao('Tipo errado', rel.tipoErrado, (x) => `gerado=${x.gerado.tipo} esperado=${x.esperado.tipo} :: ${desc(x.esperado)}`);
  secao('Falsos positivos', rel.falsosPositivos, desc);
  secao('Faltando', rel.falsosNegativos, desc);
  secao('Duplicações', rel.duplicados, (x) => `posição ${x.indice} no array: ${x.chave}`);
  secao('Registros inválidos', rel.invalidos, (x) => `posição ${x.indice} no array: ${x.problemas.join('; ')}`);
  secao('Distâncias divergentes', rel.distanciaDivergente, (x) => `${desc(x.gerado)} (esperado ${x.esperado.distanciaMetros}, diferença ${x.diferenca.toExponential(2)} m)`);

  l.push('', rel.perfeito ? '✅ Saída idêntica à resposta oficial.' : '❌ Há divergências — veja acima.');
  return l.join('\n');
}

module.exports = { compararResultados, formatarRelatorio, problemasDoEncontro, chaveEncontro, contarPorTipo, TOLERANCIA_DISTANCIA_M };
