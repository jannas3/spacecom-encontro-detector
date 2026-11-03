#!/usr/bin/env node
'use strict';

/**
 * Benchmark controlado: grade espacial x força bruta em cenários sintéticos
 * (dados gerados com semente fixa, então o resultado é reproduzível).
 *
 *   node src/cli/benchmark.js [--pessoas=2000] [--timestamps=5] [--repeticoes=3]
 *
 * Para cada cenário mede: tempo (mediana), pares avaliados, cálculos de
 * Haversine, encontros e se os dois métodos acharam exatamente os mesmos pares.
 * Os números são medidos na máquina onde roda; nada é estimado.
 */

const path = require('path');
const { criarProcessadorDeGrupo } = require('../core/grade-espacial');
const { criarClassificador } = require('../core/classificador');
const { criarMetricas, medirMemoria } = require('../observability/metricas');
const { detectarForcaBruta } = require('../validation/referencia-forca-bruta');
const { gravarJsonSeguro } = require('../infrastructure/gravador-json');
const { METROS_POR_GRAU_LAT, RAD } = require('../core/haversine');
const { lerArgumentos, inteiroPositivo, executarCli } = require('./comum');
const { DIRETORIOS } = require('../config/configuracoes');

function gerador(semente) {
  let s = semente >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Cria pessoas e posições para um cenário. */
function montarCenario({ nome, lat0, lon0, larguraM, pessoas: N, timestamps: T, fracaoAglomerada = 0, raioAglomeradoM = 0 }, semente) {
  const r = gerador(semente);
  const pessoas = [];
  for (let i = 0; i < N; i++) {
    const vitima = i % 20 === 19;
    pessoas.push({ id: i + 1, faccao: vitima || i % 4 === 0 ? '' : String(1 + (i % 7)), vitima, restricoes: vitima ? new Set([i]) : new Set() });
  }
  const mLon = METROS_POR_GRAU_LAT * Math.cos(lat0 * RAD);
  const grupos = [];
  for (let t = 0; t < T; t++) {
    const lat = new Float64Array(N);
    const lon = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let x;
      let y;
      if (r() < fracaoAglomerada) {
        x = (r() - 0.5) * 2 * raioAglomeradoM;
        y = (r() - 0.5) * 2 * raioAglomeradoM;
      } else {
        x = (r() - 0.5) * larguraM;
        y = (r() - 0.5) * larguraM;
      }
      lat[i] = Math.round((lat0 + y / METROS_POR_GRAU_LAT) * 1e5) / 1e5;
      lon[i] = Math.round((lon0 + x / mLon) * 1e5) / 1e5;
    }
    grupos.push({ ts: `2024-01-01 00:00:${String(t * 5).padStart(2, '0')}`, lat, lon });
  }
  return { nome, pessoas, grupos };
}

function rodarGrade(cen, classificar) {
  const metricas = criarMetricas();
  const encontros = [];
  const processar = criarProcessadorDeGrupo({ pessoas: cen.pessoas, classificar, aoEncontrar: (e) => encontros.push(e), metricas });
  const gP = Int32Array.from(cen.pessoas.keys());
  const t0 = process.hrtime.bigint();
  for (const g of cen.grupos) processar(g.ts, cen.pessoas.length, gP, g.lat, g.lon);
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, metricas, encontros };
}

function rodarForcaBruta(cen, classificar) {
  const porTs = new Map(cen.grupos.map((g) => [g.ts, cen.pessoas.map((p, i) => ({ id: p.id, lat: g.lat[i], lon: g.lon[i] }))]));
  const porId = new Map(cen.pessoas.map((p) => [p.id, p]));
  const t0 = process.hrtime.bigint();
  const encontros = detectarForcaBruta(porTs, porId, classificar);
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, encontros };
}

const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const chave = (e) => `${e.timestamp}|${e.monitoradosEncontro.join('-')}|${e.tipo}`;

executarCli('benchmark', ({ logger }) => {
  const { flags } = lerArgumentos();
  const N = inteiroPositivo(flags.pessoas, 'pessoas', 2000);
  const T = inteiroPositivo(flags.timestamps, 'timestamps', 5);
  const reps = inteiroPositivo(flags.repeticoes, 'repeticoes', 3);
  const classificar = criarClassificador();

  const cenarios = [
    { nome: 'espalhado (10 km, Manaus)', lat0: -3.1, lon0: -60.02, larguraM: 10000 },
    { nome: 'denso (500 m)', lat0: -3.1, lon0: -60.02, larguraM: 500 },
    { nome: 'aglomeração (10% em 40 m)', lat0: -3.1, lon0: -60.02, larguraM: 5000, fracaoAglomerada: 0.1, raioAglomeradoM: 20 },
    { nome: 'alta latitude (70°)', lat0: 70, lon0: 25, larguraM: 2000 },
    { nome: 'perto do polo (89.9°)', lat0: 89.9, lon0: 0, larguraM: 2000 },
    { nome: 'antimeridiano (179.99°)', lat0: 0, lon0: 179.99, larguraM: 2000 },
  ];

  console.log(`Benchmark: ${N} pessoas x ${T} timestamps por cenário, mediana de ${reps} execuções\n`);
  const linhas = [];
  cenarios.forEach((c, i) => {
    const cen = montarCenario({ ...c, pessoas: N, timestamps: T }, 1000 + i);
    const grade = [];
    const bruta = [];
    let rg;
    let rb;
    for (let k = 0; k < reps; k++) {
      rg = rodarGrade(cen, classificar);
      grade.push(rg.ms);
      rb = rodarForcaBruta(cen, classificar);
      bruta.push(rb.ms);
    }
    const A = new Set(rg.encontros.map(chave));
    const B = new Set(rb.encontros.map(chave));
    const iguais = A.size === B.size && [...A].every((x) => B.has(x));
    const m = rg.metricas;
    const linha = {
      cenario: c.nome,
      encontros: rg.encontros.length,
      mesmosEncontros: iguais,
      gradeMs: mediana(grade),
      forcaBrutaMs: mediana(bruta),
      paresForcaBruta: m.paresForcaBruta,
      paresCandidatos: m.paresCandidatos,
      calculosHaversine: m.calculosHaversine,
      gruposFallback: m.gruposFallback,
    };
    linhas.push(linha);
    console.log(
      `${c.nome.padEnd(28)} encontros ${String(linha.encontros).padStart(6)} ${iguais ? '✓ iguais' : '✗ DIFERENTES'}` +
        ` | grade ${linha.gradeMs.toFixed(1).padStart(7)} ms x força bruta ${linha.forcaBrutaMs.toFixed(1).padStart(8)} ms` +
        ` | pares ${linha.paresCandidatos.toLocaleString('pt-BR').padStart(11)} de ${linha.paresForcaBruta.toLocaleString('pt-BR')}` +
        ` | haversine ${linha.calculosHaversine.toLocaleString('pt-BR')}` +
        (linha.gruposFallback ? ' | (força bruta: fora da área segura da grade)' : '')
    );
  });

  const resultado = { geradoEm: new Date().toISOString(), node: process.version, pessoas: N, timestamps: T, repeticoes: reps, cenarios: linhas, memoria: medirMemoria() };
  const destino = path.join(DIRETORIOS.relatorios, 'benchmark.json');
  gravarJsonSeguro(destino, resultado, { indentacao: 2 });
  logger.performance('benchmark', { pessoas: N, timestamps: T, cenarios: linhas });
  console.log(`\nResultado salvo em ${destino}`);
  return linhas.every((l) => l.mesmosEncontros) ? 0 : 2;
});
