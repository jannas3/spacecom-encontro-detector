'use strict';

const config = require('../config/configuracoes');
const { lerLinhas } = require('../infrastructure/leitor-dataset');
const { criarParser } = require('../infrastructure/parser');
const { avaliarEntrada } = require('../validation/validador-entrada');
const { criarClassificador } = require('./classificador');
const { criarProcessadorDeGrupo, compararIds } = require('./grade-espacial');
const { criarMetricas, cronometrar } = require('../observability/metricas');
const fs = require('fs');

/**
 * Orquestra a detecção de encontros de um arquivo:
 *   leitura em blocos → parse/validação → agrupamento por timestamp →
 *   grade espacial + Haversine → classificação → ordenação.
 *
 * Agrupamento por timestamp (só se comparam timestamps idênticos):
 *  - "streaming": arquivo ordenado por timestamp. Cada grupo é processado assim
 *    que o timestamp muda; a memória fica em um grupo por vez.
 *  - "memoria": ao achar um timestamp menor que o anterior, a leitura para e o
 *    arquivo é relido guardando as posições em typed arrays (24 bytes por linha:
 *    pessoa Int32 + timestamp Int32 + lat/lon Float64, mais 4 bytes de índice).
 *    Os grupos são montados com counting sort, O(n).
 */

function crescer(arr, minimo) {
  let tam = arr.length || 1;
  while (tam < minimo) tam *= 2;
  if (tam === arr.length) return arr;
  const novo = new arr.constructor(tam);
  novo.set(arr);
  return novo;
}

/** Remove a mesma pessoa repetida no mesmo timestamp, contando o ocorrido. */
function criarDeduplicador(estatisticas) {
  let carimbo = new Int32Array(1024).fill(-1);
  let posicaoNoGrupo = new Int32Array(1024);
  return {
    /** @returns {boolean} true se a pessoa já estava no grupo (linha deve ser ignorada) */
    repetida(pi, grupo, gLat, gLon, lat, lon) {
      if (pi >= carimbo.length) {
        const tam = Math.max(pi + 1, carimbo.length * 2);
        const novo = new Int32Array(tam).fill(-1);
        novo.set(carimbo);
        carimbo = novo;
        posicaoNoGrupo = crescer(posicaoNoGrupo, tam);
      }
      if (carimbo[pi] !== grupo) return false;
      const k = posicaoNoGrupo[pi];
      if (gLat[k] === lat && gLon[k] === lon) estatisticas.linhasDuplicadas++;
      else estatisticas.duplicadasConflitantes++;
      return true;
    },
    marcar(pi, grupo, posicao) {
      carimbo[pi] = grupo;
      posicaoNoGrupo[pi] = posicao;
    },
  };
}

function detectarStreaming(caminho, contexto) {
  const parser = criarParser({ cabecalhoEsperado: config.CABECALHO_ESPERADO });
  const { linha, pessoas, estatisticas } = parser;
  const encontros = [];
  const metricas = criarMetricas();
  const processar = criarProcessadorDeGrupo({ pessoas, classificar: contexto.classificar, aoEncontrar: (e) => encontros.push(e), metricas });
  const dedup = criarDeduplicador(estatisticas);

  let gP = new Int32Array(4096);
  let gLat = new Float64Array(4096);
  let gLon = new Float64Array(4096);
  let gN = 0;
  let grupo = 0;
  let chaveAtual = -1;
  let tsAtual = '';

  const fechar = () => cronometrar(metricas, () => processar(tsAtual, gN, gP, gLat, gLon));

  const completo = lerLinhas(
    caminho,
    (buf, s, e) => {
      if (!parser.ler(buf, s, e)) return;
      const chave = linha.chave;
      if (chave !== chaveAtual) {
        if (chave < chaveAtual) return false; // fora de ordem: troca de estratégia
        fechar();
        chaveAtual = chave;
        tsAtual = buf.toString('latin1', linha.tsA, linha.tsB);
        grupo++;
        gN = 0;
      }
      const pi = linha.pessoa;
      if (dedup.repetida(pi, grupo, gLat, gLon, linha.lat, linha.lon)) return;
      if (gN === gP.length) {
        gP = crescer(gP, gN + 1);
        gLat = crescer(gLat, gN + 1);
        gLon = crescer(gLon, gN + 1);
      }
      dedup.marcar(pi, grupo, gN);
      gP[gN] = pi;
      gLat[gN] = linha.lat;
      gLon[gN] = linha.lon;
      gN++;
    },
    contexto.leitura
  );
  if (!completo) return null;
  fechar();
  return { encontros, pessoas, estatisticas, metricas, timestamps: grupo };
}

function detectarMemoria(caminho, contexto) {
  const parser = criarParser({ cabecalhoEsperado: config.CABECALHO_ESPERADO });
  const { linha, pessoas, estatisticas } = parser;
  const encontros = [];
  const metricas = criarMetricas();
  const processar = criarProcessadorDeGrupo({ pessoas, classificar: contexto.classificar, aoEncontrar: (e) => encontros.push(e), metricas });

  const estimativa = Math.max(1024, Math.ceil(fs.statSync(caminho).size / 50));
  let rP = new Int32Array(estimativa);
  let rT = new Int32Array(estimativa);
  let rLat = new Float64Array(estimativa);
  let rLon = new Float64Array(estimativa);
  let nl = 0;

  const indiceTs = new Map();
  const textosTs = [];
  let ultimaChave = -1;
  let ultimoT = -1;

  lerLinhas(
    caminho,
    (buf, s, e) => {
      if (!parser.ler(buf, s, e)) return;
      let t;
      if (linha.chave === ultimaChave) t = ultimoT;
      else {
        t = indiceTs.get(linha.chave);
        if (t === undefined) {
          t = textosTs.length;
          textosTs.push(buf.toString('latin1', linha.tsA, linha.tsB));
          indiceTs.set(linha.chave, t);
        }
        ultimaChave = linha.chave;
        ultimoT = t;
      }
      if (nl === rP.length) {
        rP = crescer(rP, nl + 1);
        rT = crescer(rT, nl + 1);
        rLat = crescer(rLat, nl + 1);
        rLon = crescer(rLon, nl + 1);
      }
      rP[nl] = linha.pessoa;
      rT[nl] = t;
      rLat[nl] = linha.lat;
      rLon[nl] = linha.lon;
      nl++;
    },
    contexto.leitura
  );

  // counting sort por timestamp (estável: preserva a ordem do arquivo dentro do grupo)
  const nT = textosTs.length;
  const inicio = new Int32Array(nT + 1);
  for (let i = 0; i < nl; i++) inicio[rT[i] + 1]++;
  for (let t = 0; t < nT; t++) inicio[t + 1] += inicio[t];
  const proxima = inicio.slice(0, nT);
  const ordem = new Int32Array(nl);
  for (let i = 0; i < nl; i++) ordem[proxima[rT[i]]++] = i;
  rT = null; // libera memória antes de processar

  let maior = 1;
  for (let t = 0; t < nT; t++) maior = Math.max(maior, inicio[t + 1] - inicio[t]);
  const gP = new Int32Array(maior);
  const gLat = new Float64Array(maior);
  const gLon = new Float64Array(maior);
  const dedup = criarDeduplicador(estatisticas);

  cronometrar(metricas, () => {
    for (let t = 0; t < nT; t++) {
      let gN = 0;
      for (let k = inicio[t]; k < inicio[t + 1]; k++) {
        const i = ordem[k];
        const pi = rP[i];
        if (dedup.repetida(pi, t, gLat, gLon, rLat[i], rLon[i])) continue;
        dedup.marcar(pi, t, gN);
        gP[gN] = pi;
        gLat[gN] = rLat[i];
        gLon[gN] = rLon[i];
        gN++;
      }
      processar(textosTs[t], gN, gP, gLat, gLon);
    }
  });
  return { encontros, pessoas, estatisticas, metricas, timestamps: nT };
}

/** Ordem determinística: timestamp, menor id, maior id. */
function ordenarEncontros(encontros) {
  return encontros.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return compararIds(a.monitoradosEncontro[0], b.monitoradosEncontro[0]) || compararIds(a.monitoradosEncontro[1], b.monitoradosEncontro[1]);
  });
}

/**
 * Analisa um dataset e devolve encontros + informações da execução.
 *
 * @param {string} caminho
 * @param {{incluirVitimas?: boolean, tamanhoBloco?: number}} [opcoes]
 * @returns {{encontros: object[], info: object}}
 */
function analisar(caminho, opcoes = {}) {
  const t0 = process.hrtime.bigint();
  const contexto = {
    classificar: criarClassificador({ incluirVitimas: !!opcoes.incluirVitimas }),
    leitura: opcoes.tamanhoBloco ? { tamanhoBloco: opcoes.tamanhoBloco } : undefined,
  };

  let modo = 'streaming';
  let r = detectarStreaming(caminho, contexto);
  if (!r) {
    modo = 'memoria';
    r = detectarMemoria(caminho, contexto);
  }
  const { avisos } = avaliarEntrada(r.estatisticas, caminho);
  ordenarEncontros(r.encontros);

  const totalNs = process.hrtime.bigint() - t0;
  const porTipo = { protetiva: 0, faccao: 0, generico: 0 };
  for (const e of r.encontros) porTipo[e.tipo]++;

  return {
    encontros: r.encontros,
    info: {
      modo,
      pessoas: r.pessoas.length,
      timestamps: r.timestamps,
      estatisticas: r.estatisticas,
      avisos,
      metricas: r.metricas,
      porTipo,
      tempoTotalMs: Number(totalNs) / 1e6,
      tempoBuscaMs: Number(r.metricas.tempoProcessamentoNs) / 1e6,
    },
  };
}

/** Atalho: só a lista de encontros. Se opcoes.info for um objeto, recebe as informações. */
function detectar(caminho, opcoes = {}) {
  const { encontros, info } = analisar(caminho, opcoes);
  if (opcoes.info) Object.assign(opcoes.info, info);
  return encontros;
}

/** Só o cadastro de pessoas (o validador usa para explicar divergências). */
function carregarPessoas(caminho) {
  const parser = criarParser({ cabecalhoEsperado: config.CABECALHO_ESPERADO });
  lerLinhas(caminho, (buf, s, e) => {
    parser.ler(buf, s, e);
  });
  return new Map(parser.pessoas.map((p) => [p.id, p]));
}

module.exports = { analisar, detectar, carregarPessoas, ordenarEncontros };
