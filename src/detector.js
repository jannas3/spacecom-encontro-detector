#!/usr/bin/env node
'use strict';

/**
 * Detector de encontros — Desafio Trainee Tech Spacecom 2027
 *
 * Uso:
 *   node src/detector.js <entrada.txt> [saida.json] [--incluir-vitimas] [--pretty]
 *
 * Estratégia:
 *   1. Lê o arquivo em blocos de 16 MB e faz o parse direto nos bytes
 *      (sem montar uma string gigante, então funciona para arquivos de vários GB).
 *      Aspas, espaços, \r e BOM são ignorados em todos os campos.
 *   2. Agrupa as posições por timestamp (só se compara quem tem o MESMO timestamp).
 *      - Se o arquivo estiver ordenado por timestamp, cada grupo é processado assim que
 *        termina (modo "streaming": memória mínima).
 *      - Se não estiver, o arquivo é relido guardando tudo em typed arrays e os grupos
 *        são montados com counting sort (modo "memória").
 *   3. Dentro de cada timestamp, usa uma grade espacial (spatial hashing) com células
 *      de ~25 m: só compara pontos da mesma célula ou de células vizinhas.
 *   4. Para cada par candidato, calcula a distância exata por Haversine (R = 6.371.000 m)
 *      e registra o encontro se a distância for < 20 m.
 *   5. Classifica cada par UMA vez, por prioridade: protetiva > faccao > generico.
 */

const fs = require('fs');
const path = require('path');

const RAIO_TERRA = 6371000;
const LIMITE_METROS = 20;
const RAD = Math.PI / 180;

// Graus de latitude equivalentes a 20 m. A distância entre dois pontos nunca é menor que
// R·|Δlat| (em rad), então se |Δlat| passar disso o par já pode ser descartado sem Haversine.
// A margem de 1e-4 evita qualquer problema de arredondamento.
const FILTRO_LAT = (LIMITE_METROS / (RAIO_TERRA * RAD)) * 1.0001;

// Célula um pouco maior que o limite. A grade só filtra candidatos; quem decide é o Haversine.
const CELULA_METROS = 25;
const GRAUS_LAT_POR_CELULA = CELULA_METROS / (RAIO_TERRA * RAD);

// Abaixo disso, força bruta (com o filtro de latitude) é mais rápida que montar a grade.
const LIMIAR_FORCA_BRUTA = 32;

const POW10 = Array.from({ length: 23 }, (_, i) => Number('1e' + i));

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const a = s1 * s1 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * s2 * s2;
  return 2 * RAIO_TERRA * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ------------------------------------------------------------------ */
/* Leitura em blocos                                                   */
/* ------------------------------------------------------------------ */

/** Chama aoLer(buf, inicio, fim) para cada linha. Se aoLer retornar false, para a leitura. */
function lerLinhas(caminho, aoLer) {
  const fd = fs.openSync(caminho, 'r');
  let buf = Buffer.allocUnsafe(1 << 24);
  let pendente = 0;
  let primeiroBloco = true;
  try {
    for (;;) {
      const lidos = fs.readSync(fd, buf, pendente, buf.length - pendente, null);
      const fim = pendente + lidos;
      const view = buf.subarray(0, fim);
      let s = 0;
      if (primeiroBloco && fim >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) s = 3;
      primeiroBloco = false;

      let i = view.indexOf(10, s);
      while (i !== -1) {
        if (i > s && aoLer(buf, s, i) === false) return false;
        s = i + 1;
        i = view.indexOf(10, s);
      }
      if (lidos === 0) {
        if (s < fim && aoLer(buf, s, fim) === false) return false;
        return true;
      }
      pendente = fim - s;
      if (pendente === buf.length) {
        const maior = Buffer.allocUnsafe(buf.length * 2);
        buf.copy(maior, 0, s, fim);
        buf = maior;
      } else {
        buf.copy(buf, 0, s, fim);
      }
    }
  } finally {
    fs.closeSync(fd);
  }
}

// "Registradores" globais do trim, para não alocar nada por campo.
let TA = 0;
let TB = 0;
function trim(buf, a, b) {
  while (a < b) {
    const c = buf[a];
    if (c === 32 || c === 34 || c === 39 || c === 9 || c === 13) a++;
    else break;
  }
  while (b > a) {
    const c = buf[b - 1];
    if (c === 32 || c === 34 || c === 39 || c === 9 || c === 13) b--;
    else break;
  }
  TA = a;
  TB = b;
}

function lerInt(buf, a, b) {
  if (a >= b) return NaN;
  let neg = false;
  if (buf[a] === 45) {
    neg = true;
    if (++a >= b) return NaN;
  }
  let v = 0;
  for (; a < b; a++) {
    const d = buf[a] - 48;
    if (d < 0 || d > 9) return NaN;
    v = v * 10 + d;
  }
  return neg ? -v : v;
}

/**
 * Lê um decimal tipo -10.07996. Calcula mantissa/10^k: como os dois são inteiros exatos,
 * a divisão tem arredondamento correto e dá EXATAMENTE o mesmo double que parseFloat.
 */
function lerDecimal(buf, a, b) {
  let i = a;
  let neg = false;
  if (buf[i] === 45) {
    neg = true;
    i++;
  } else if (buf[i] === 43) i++;
  let m = 0;
  let k = 0;
  let dig = 0;
  let ponto = false;
  for (; i < b; i++) {
    const c = buf[i];
    if (c >= 48 && c <= 57) {
      m = m * 10 + (c - 48);
      dig++;
      if (ponto) k++;
    } else if (c === 46 && !ponto) ponto = true;
    else return parseFloat(buf.toString('latin1', a, b).replace(',', '.'));
  }
  if (dig === 0) return NaN;
  if (dig > 15) return parseFloat(buf.toString('latin1', a, b));
  const v = m / POW10[k];
  return neg ? -v : v;
}

/** "2024-01-01 00:05:15" -> 20240101000515 (número). Retorna -1 se não der pra representar. */
function chaveTimestamp(buf, a, b) {
  let k = 0;
  let n = 0;
  for (; a < b; a++) {
    const d = buf[a] - 48;
    if (d >= 0 && d <= 9) {
      k = k * 10 + d;
      n++;
    }
  }
  return n > 0 && n <= 15 ? k : -1;
}

function lerBool(buf, a, b) {
  if (a >= b) return false;
  const c = buf[a] | 32; // minúscula
  return c === 116 /* t */ || c === 115 /* s */ || c === 121 /* y */ || buf[a] === 49 /* 1 */;
}

function parseId(s) {
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : s;
}

function parseRestricoes(v) {
  const lista = [];
  const limpo = v.replace(/["'\[\]\s]/g, '');
  if (!limpo) return lista;
  for (const p of limpo.split(',')) if (p) lista.push(parseId(p));
  return lista;
}

/* ------------------------------------------------------------------ */
/* Parse de uma linha                                                  */
/* ------------------------------------------------------------------ */

function criarParser() {
  const pessoas = []; // { id, faccao, vitima, restricoes:Set, restrLida }
  const indicePessoa = new Map();
  let ultimoId;
  let ultimoIdx = -1;

  const FS = new Int32Array(64);
  const FE = new Int32Array(64);

  // Resultado da última linha lida (evita alocar objeto por linha)
  const linha = { pessoa: -1, chave: 0, tsA: 0, tsB: 0, lat: 0, lon: 0 };

  /** Retorna true se a linha é válida; o conteúdo fica em `linha`. */
  function ler(buf, s, e) {
    let n = 0;
    FS[0] = s;
    for (let i = s; i < e; i++) {
      if (buf[i] === 59) {
        FE[n] = i;
        if (++n >= 63) break;
        FS[n] = i + 1;
      }
    }
    FE[n] = e;
    n++;
    if (n < 5) return false;

    trim(buf, FS[0], FE[0]);
    if (TB <= TA) return false;
    let id = lerInt(buf, TA, TB);
    if (id !== id) {
      id = buf.toString('utf8', TA, TB);
      if (id.toLowerCase() === 'idmonitorado') return false; // cabeçalho
    }

    trim(buf, FS[3], FE[3]);
    const lat = lerDecimal(buf, TA, TB);
    trim(buf, FS[4], FE[4]);
    const lon = lerDecimal(buf, TA, TB);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;

    trim(buf, FS[2], FE[2]);
    if (TB <= TA) return false;
    linha.tsA = TA;
    linha.tsB = TB;
    linha.chave = chaveTimestamp(buf, TA, TB);

    let pi;
    if (id === ultimoId) pi = ultimoIdx;
    else {
      pi = indicePessoa.get(id);
      if (pi === undefined) {
        pi = pessoas.length;
        pessoas.push({ id, faccao: '', vitima: false, restricoes: new Set(), restrLida: false });
        indicePessoa.set(id, pi);
      }
      ultimoId = id;
      ultimoIdx = pi;
    }
    const p = pessoas[pi];

    if (!p.faccao) {
      trim(buf, FS[1], FE[1]);
      if (TB > TA) p.faccao = buf.toString('utf8', TA, TB);
    }
    if (n > 5 && !p.vitima) {
      trim(buf, FS[5], FE[5]);
      if (lerBool(buf, TA, TB)) p.vitima = true;
    }
    if (n > 6 && !p.restrLida) {
      trim(buf, FS[6], FE[n - 1]);
      if (TB > TA) {
        for (const r of parseRestricoes(buf.toString('utf8', TA, TB))) p.restricoes.add(r);
        p.restrLida = true;
      }
    }

    linha.pessoa = pi;
    linha.lat = lat;
    linha.lon = lon;
    return true;
  }

  return { ler, linha, pessoas };
}

/* ------------------------------------------------------------------ */
/* Classificação e processamento de um timestamp                       */
/* ------------------------------------------------------------------ */

/**
 *  - protetiva: uma das partes é vítima e a outra está na lista de restrição dela
 *  - faccao:    dois monitorados (não vítimas) com a mesma facção preenchida
 *  - generico:  dois monitorados (não vítimas) quaisquer
 * Pares envolvendo vítima que NÃO são protetiva são ignorados por padrão
 * (ou viram "generico" com --incluir-vitimas).
 */
function criarClassificador(incluirVitimas) {
  return function classificar(a, b) {
    if ((a.vitima && a.restricoes.has(b.id)) || (b.vitima && b.restricoes.has(a.id))) return 'protetiva';
    if (a.vitima || b.vitima) return incluirVitimas ? 'generico' : null;
    if (a.faccao && a.faccao === b.faccao) return 'faccao';
    return 'generico';
  };
}

const VIZINHAS = [
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];
const SHIFT = 4194304; // 2^22

function criarProcessador(pessoas, classificar, encontros) {
  let cx = new Int32Array(1024);
  let cy = new Int32Array(1024);

  /** gP/gLat/gLon: arrays do grupo (só os n primeiros valem). */
  return function processar(ts, n, gP, gLat, gLon) {
    if (n < 2) return;

    const avaliar = (i, j) => {
      const la = gLat[i];
      const lb = gLat[j];
      if (la - lb >= FILTRO_LAT || lb - la >= FILTRO_LAT) return;
      const d = haversine(la, gLon[i], lb, gLon[j]);
      if (!(d < LIMITE_METROS)) return;
      const a = pessoas[gP[i]];
      const b = pessoas[gP[j]];
      const tipo = classificar(a, b);
      if (!tipo) return;
      const trocar = typeof a.id === 'number' && typeof b.id === 'number' ? a.id > b.id : String(a.id) > String(b.id);
      const [x, y, px, py] = trocar ? [j, i, b, a] : [i, j, a, b];
      encontros.push({
        tipo,
        monitoradosEncontro: [px.id, py.id],
        timestamp: ts,
        posicoes: {
          [px.id]: { lat: gLat[x], lon: gLon[x] },
          [py.id]: { lat: gLat[y], lon: gLon[y] },
        },
        distanciaMetros: d,
      });
    };

    if (n <= LIMIAR_FORCA_BRUTA) {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) avaliar(i, j);
      return;
    }

    // Largura da célula em longitude depende da latitude: usa a maior |lat| do grupo
    // (célula mais larga = lado seguro, nunca perde par).
    let maxAbsLat = 0;
    for (let i = 0; i < n; i++) {
      const v = gLat[i] < 0 ? -gLat[i] : gLat[i];
      if (v > maxAbsLat) maxAbsLat = v;
    }
    const cosLat = Math.max(Math.cos(Math.min(maxAbsLat, 89) * RAD), 1e-6);
    const grausLon = GRAUS_LAT_POR_CELULA / cosLat;

    if (cx.length < n) {
      cx = new Int32Array(n * 2);
      cy = new Int32Array(n * 2);
    }
    const celulas = new Map();
    for (let i = 0; i < n; i++) {
      const x = Math.floor(gLat[i] / GRAUS_LAT_POR_CELULA);
      const y = Math.floor(gLon[i] / grausLon);
      cx[i] = x;
      cy[i] = y;
      const k = x * SHIFT + y;
      const lista = celulas.get(k);
      if (lista) lista.push(i);
      else celulas.set(k, [i]);
    }

    // Meia vizinhança: cada par de células é visitado uma única vez.
    for (const lista of celulas.values()) {
      const m = lista.length;
      for (let a = 0; a < m; a++) for (let b = a + 1; b < m; b++) avaliar(lista[a], lista[b]);
      const x = cx[lista[0]];
      const y = cy[lista[0]];
      for (let v = 0; v < 4; v++) {
        const outra = celulas.get((x + VIZINHAS[v][0]) * SHIFT + (y + VIZINHAS[v][1]));
        if (!outra) continue;
        for (let a = 0; a < m; a++) for (let b = 0; b < outra.length; b++) avaliar(lista[a], outra[b]);
      }
    }
  };
}

/* ------------------------------------------------------------------ */
/* Buffers que crescem                                                 */
/* ------------------------------------------------------------------ */

function crescer(arr, min) {
  let tam = arr.length || 1;
  while (tam < min) tam *= 2;
  if (tam === arr.length) return arr;
  const novo = new arr.constructor(tam);
  novo.set(arr);
  return novo;
}

/* ------------------------------------------------------------------ */
/* Modo 1: arquivo ordenado por timestamp (streaming)                  */
/* ------------------------------------------------------------------ */

function detectarStreaming(caminho, classificar) {
  const parser = criarParser();
  const { linha, pessoas } = parser;
  const encontros = [];
  const processar = criarProcessador(pessoas, classificar, encontros);

  let gP = new Int32Array(4096);
  let gLat = new Float64Array(4096);
  let gLon = new Float64Array(4096);
  let gN = 0;
  let carimbo = new Int32Array(4096); // carimbo[pessoa] = grupo em que ela já apareceu
  let grupo = 0;
  let chaveAtual = -Infinity;
  let tsAtual = '';
  let linhas = 0;

  const ok = lerLinhas(caminho, (buf, s, e) => {
    if (!parser.ler(buf, s, e)) return;
    const chave = linha.chave;
    if (chave !== chaveAtual) {
      if (chave < chaveAtual || chave === -1) return false; // não está ordenado
      processar(tsAtual, gN, gP, gLat, gLon);
      chaveAtual = chave;
      tsAtual = buf.toString('latin1', linha.tsA, linha.tsB);
      grupo++;
      gN = 0;
    }
    linhas++;
    const pi = linha.pessoa;
    if (pi >= carimbo.length) carimbo = crescer(carimbo, pi + 1);
    if (carimbo[pi] === grupo) return; // pessoa repetida no mesmo timestamp
    carimbo[pi] = grupo;
    if (gN === gP.length) {
      gP = crescer(gP, gN + 1);
      gLat = crescer(gLat, gN + 1);
      gLon = crescer(gLon, gN + 1);
    }
    gP[gN] = pi;
    gLat[gN] = linha.lat;
    gLon[gN] = linha.lon;
    gN++;
  });
  if (!ok) return null;
  processar(tsAtual, gN, gP, gLat, gLon);
  return { encontros, pessoas, linhas, timestamps: grupo };
}

/* ------------------------------------------------------------------ */
/* Modo 2: arquivo fora de ordem (tudo em memória + counting sort)     */
/* ------------------------------------------------------------------ */

function detectarMemoria(caminho, classificar) {
  const parser = criarParser();
  const { linha, pessoas } = parser;
  const encontros = [];
  const processar = criarProcessador(pessoas, classificar, encontros);

  const estimativa = Math.max(1024, Math.ceil(fs.statSync(caminho).size / 50));
  let rP = new Int32Array(estimativa);
  let rT = new Int32Array(estimativa);
  let rLat = new Float64Array(estimativa);
  let rLon = new Float64Array(estimativa);
  let nl = 0;

  const indiceTs = new Map();
  const textosTs = [];
  let ultimaChave;
  let ultimoT = -1;

  lerLinhas(caminho, (buf, s, e) => {
    if (!parser.ler(buf, s, e)) return;
    let chave = linha.chave;
    if (chave === -1) chave = buf.toString('latin1', linha.tsA, linha.tsB);
    let t;
    if (chave === ultimaChave) t = ultimoT;
    else {
      t = indiceTs.get(chave);
      if (t === undefined) {
        t = textosTs.length;
        textosTs.push(buf.toString('latin1', linha.tsA, linha.tsB));
        indiceTs.set(chave, t);
      }
      ultimaChave = chave;
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
  });

  // Counting sort por timestamp
  const nT = textosTs.length;
  const inicio = new Int32Array(nT + 1);
  for (let i = 0; i < nl; i++) inicio[rT[i] + 1]++;
  for (let t = 0; t < nT; t++) inicio[t + 1] += inicio[t];
  const pos = inicio.slice(0, nT);
  const ordem = new Int32Array(nl);
  for (let i = 0; i < nl; i++) ordem[pos[rT[i]]++] = i;
  rT = null;

  let maior = 0;
  for (let t = 0; t < nT; t++) maior = Math.max(maior, inicio[t + 1] - inicio[t]);
  const gP = new Int32Array(Math.max(maior, 1));
  const gLat = new Float64Array(Math.max(maior, 1));
  const gLon = new Float64Array(Math.max(maior, 1));
  const carimbo = new Int32Array(pessoas.length).fill(-1);

  for (let t = 0; t < nT; t++) {
    let gN = 0;
    for (let k = inicio[t]; k < inicio[t + 1]; k++) {
      const i = ordem[k];
      const pi = rP[i];
      if (carimbo[pi] === t) continue;
      carimbo[pi] = t;
      gP[gN] = pi;
      gLat[gN] = rLat[i];
      gLon[gN] = rLon[i];
      gN++;
    }
    processar(textosTs[t], gN, gP, gLat, gLon);
  }
  return { encontros, pessoas, linhas: nl, timestamps: nT };
}

/* ------------------------------------------------------------------ */
/* API pública                                                         */
/* ------------------------------------------------------------------ */

/**
 * Detecta os encontros de um arquivo.
 * opcoes.incluirVitimas: registra vítima x não-agressor como "generico".
 * opcoes.info: objeto que recebe { modo, linhas, timestamps, pessoas }.
 */
function detectar(caminho, opcoes = {}) {
  const classificar = criarClassificador(!!opcoes.incluirVitimas);
  let modo = 'streaming';
  let r = detectarStreaming(caminho, classificar);
  if (!r) {
    modo = 'memoria';
    r = detectarMemoria(caminho, classificar);
  }
  if (opcoes.info) Object.assign(opcoes.info, { modo, linhas: r.linhas, timestamps: r.timestamps, pessoas: r.pessoas.length });
  return r.encontros;
}

/** Só o cadastro de pessoas (usado pelo validador para explicar divergências). */
function carregarPessoas(caminho) {
  const parser = criarParser();
  lerLinhas(caminho, (buf, s, e) => {
    parser.ler(buf, s, e);
  });
  const mapa = new Map();
  for (const p of parser.pessoas) mapa.set(p.id, p);
  return mapa;
}

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const pos = args.filter((a) => !a.startsWith('--'));
  if (!pos[0]) {
    console.error('Uso: node src/detector.js <entrada.txt> [saida.json] [--incluir-vitimas] [--pretty]');
    process.exit(1);
  }
  const entrada = pos[0];
  const saida = pos[1] || path.join('saida', path.basename(entrada).replace(/\.txt$/i, '') + '.json');

  const info = {};
  const t0 = process.hrtime.bigint();
  const encontros = detectar(entrada, { incluirVitimas: flags.has('--incluir-vitimas'), info });
  const t1 = process.hrtime.bigint();

  fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
  fs.writeFileSync(saida, JSON.stringify(encontros, null, flags.has('--pretty') ? 2 : 0));

  const porTipo = encontros.reduce((acc, e) => ((acc[e.tipo] = (acc[e.tipo] || 0) + 1), acc), {});
  console.error(
    `${path.basename(entrada)}: ${encontros.length} encontros ${JSON.stringify(porTipo)} ` +
      `em ${(Number(t1 - t0) / 1e6).toFixed(1)} ms [${info.modo}, ${info.linhas} linhas] -> ${saida}`
  );
}

module.exports = { detectar, haversine, carregarPessoas };

if (require.main === module) main();
