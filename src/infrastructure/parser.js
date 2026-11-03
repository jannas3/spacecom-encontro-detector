'use strict';

/**
 * Parse de uma linha do dataset, direto nos bytes, com validação e estatísticas.
 *
 * Formato: idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida
 *
 * Linhas rejeitadas NÃO são descartadas em silêncio: cada rejeição é contada por
 * motivo e os primeiros números de linha são guardados (sem coordenadas, para
 * não registrar posições pessoais em relatórios).
 */

const POW10 = Array.from({ length: 23 }, (_, i) => Number('1e' + i));
const MAX_EXEMPLOS_POR_MOTIVO = 5;

/* ---------- Leitura de campos (sem alocação) ---------- */

// Resultado do último trim (evita criar objeto por campo)
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

function lerInteiro(buf, a, b) {
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
 * Decimal como mantissa / 10^k. Mantissa e 10^k são inteiros exatos em double,
 * então a divisão (arredondamento IEEE correto) dá EXATAMENTE o mesmo valor que
 * parseFloat. Formatos fora do padrão caem no parseFloat.
 */
function lerDecimal(buf, a, b) {
  if (a >= b) return NaN;
  let i = a;
  let neg = false;
  if (buf[i] === 45) {
    neg = true;
    i++;
  } else if (buf[i] === 43) i++;
  let m = 0;
  let k = 0;
  let digitos = 0;
  let ponto = false;
  for (; i < b; i++) {
    const c = buf[i];
    if (c >= 48 && c <= 57) {
      m = m * 10 + (c - 48);
      digitos++;
      if (ponto) k++;
    } else if (c === 46 && !ponto) ponto = true;
    else return Number(buf.toString('latin1', a, b).replace(',', '.')); // Number() rejeita lixo no fim; vírgula decimal aceita
  }
  if (digitos === 0) return NaN;
  if (digitos > 15 || k > 22) return Number(buf.toString('latin1', a, b));
  const v = m / POW10[k];
  return neg ? -v : v;
}

const DIAS_NO_MES = new Int8Array([0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

/** Dois dígitos ASCII → número, ou -1. */
function doisDigitos(buf, i) {
  const a = buf[i] - 48;
  const b = buf[i + 1] - 48;
  return a >= 0 && a <= 9 && b >= 0 && b <= 9 ? a * 10 + b : -1;
}

/**
 * Valida o formato EXATO "YYYY-MM-DD HH:MM:SS" e devolve uma chave numérica
 * YYYYMMDDHHMMSS (14 dígitos, < 2^53). Como o formato é fixo, chaves iguais
 * ⇔ textos iguais, e a ordem numérica é a ordem cronológica.
 * Retorna -1 se o timestamp for inválido.
 */
function chaveTimestamp(buf, a, b) {
  if (b - a !== 19) return -1;
  if (buf[a + 4] !== 45 || buf[a + 7] !== 45 || buf[a + 10] !== 32 || buf[a + 13] !== 58 || buf[a + 16] !== 58) return -1;
  const s1 = doisDigitos(buf, a);
  const s2 = doisDigitos(buf, a + 2);
  const mes = doisDigitos(buf, a + 5);
  const dia = doisDigitos(buf, a + 8);
  const hora = doisDigitos(buf, a + 11);
  const min = doisDigitos(buf, a + 14);
  const seg = doisDigitos(buf, a + 17);
  if (s1 < 0 || s2 < 0 || mes < 1 || mes > 12 || dia < 1 || dia > DIAS_NO_MES[mes] || hora < 0 || hora > 23 || min < 0 || min > 59 || seg < 0 || seg > 59) return -1;
  return (((((s1 * 100 + s2) * 100 + mes) * 100 + dia) * 100 + hora) * 100 + min) * 100 + seg;
}

/** Valida um timestamp em texto (usado pelo validador de resultados). */
function timestampValido(texto) {
  if (typeof texto !== 'string') return false;
  const b = Buffer.from(texto, 'latin1');
  return chaveTimestamp(b, 0, b.length) !== -1;
}

const VERDADEIROS = new Set(['true', '1', 'sim', 's', 't', 'yes', 'y', 'verdadeiro']);
const FALSOS = new Set(['false', '0', 'nao', 'não', 'n', 'f', 'no', 'falso', '']);

/** @returns {true|false|null} null = valor não reconhecido */
function lerBooleano(texto) {
  const t = texto.toLowerCase();
  if (VERDADEIROS.has(t)) return true;
  if (FALSOS.has(t)) return false;
  return null;
}

/** Mesmo critério do campo idMonitorado: só dígitos (com '-' opcional) vira número. */
function normalizarId(texto) {
  return /^-?\d+$/.test(texto) ? Number(texto) : texto;
}

function lerRestricoes(texto) {
  const limpo = texto.replace(/["'\[\]\s]/g, '');
  if (!limpo) return [];
  return limpo.split(',').filter(Boolean).map(normalizarId);
}

/* ---------- Estatísticas ---------- */

function criarEstatisticas() {
  return {
    linhasLidas: 0,
    linhasVazias: 0,
    cabecalho: null, // 'ok' | 'divergente' | 'ausente'
    linhasValidas: 0,
    linhasInvalidas: 0,
    linhasDuplicadas: 0, // mesma pessoa, mesmo timestamp, mesma posição (ignorada)
    duplicadasConflitantes: 0, // mesma pessoa e timestamp, posição diferente (1ª mantida)
    avisos: 0, // linhas aceitas com algum campo fora do padrão
    motivos: {}, // motivo -> quantidade
    exemplos: {}, // motivo -> [números de linha]
  };
}

function registrar(est, motivo, linha) {
  est.motivos[motivo] = (est.motivos[motivo] || 0) + 1;
  const lista = est.exemplos[motivo] || (est.exemplos[motivo] = []);
  if (lista.length < MAX_EXEMPLOS_POR_MOTIVO) lista.push(linha);
}

/* ---------- Parser ---------- */

/**
 * Cria um parser com cadastro de pessoas e estatísticas próprias.
 * parser.ler(buf, s, e) → true se a linha é um registro válido (dados em parser.linha).
 */
function criarParser({ cabecalhoEsperado }) {
  const pessoas = []; // { id, faccao, vitima, restricoes:Set, restricoesLidas }
  const indicePessoa = new Map();
  const estatisticas = criarEstatisticas();
  const linha = { pessoa: -1, chave: 0, tsA: 0, tsB: 0, lat: 0, lon: 0, numero: 0 };

  const FS = new Int32Array(64);
  const FE = new Int32Array(64);
  let ultimoId;
  let ultimoIdx = -1;
  const cabecalhoNormalizado = cabecalhoEsperado.map((c) => c.toLowerCase());

  function rejeitar(motivo) {
    estatisticas.linhasInvalidas++;
    registrar(estatisticas, motivo, linha.numero);
    return false;
  }

  function avisar(motivo) {
    estatisticas.avisos++;
    registrar(estatisticas, motivo, linha.numero);
  }

  function ler(buf, s, e) {
    linha.numero = ++estatisticas.linhasLidas;

    // separa campos
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

    if (n < 5) {
      trim(buf, s, e);
      if (TB <= TA) {
        estatisticas.linhasVazias++;
        return false;
      }
    }

    // cabeçalho (só na primeira linha não vazia)
    if (estatisticas.cabecalho === null) {
      trim(buf, FS[0], FE[0]);
      const primeiro = buf.toString('utf8', TA, TB).toLowerCase();
      if (primeiro === cabecalhoNormalizado[0]) {
        const campos = [];
        for (let k = 0; k < n; k++) {
          trim(buf, FS[k], FE[k]);
          campos.push(buf.toString('utf8', TA, TB).toLowerCase());
        }
        const igual = campos.length === cabecalhoNormalizado.length && campos.every((c, k) => c === cabecalhoNormalizado[k]);
        estatisticas.cabecalho = igual ? 'ok' : 'divergente';
        return false;
      }
      estatisticas.cabecalho = 'ausente';
    }

    if (n < 5) return rejeitar('campos_insuficientes');
    if (n > 7) avisar('campos_extras_concatenados_em_idsRestricaoMedida');

    // id
    trim(buf, FS[0], FE[0]);
    if (TB <= TA) return rejeitar('id_vazio');
    let id = lerInteiro(buf, TA, TB);
    if (id !== id) id = buf.toString('utf8', TA, TB);

    // timestamp
    trim(buf, FS[2], FE[2]);
    const chave = chaveTimestamp(buf, TA, TB);
    if (chave === -1) return rejeitar('timestamp_invalido');
    linha.tsA = TA;
    linha.tsB = TB;
    linha.chave = chave;

    // coordenadas
    trim(buf, FS[3], FE[3]);
    const lat = lerDecimal(buf, TA, TB);
    if (!Number.isFinite(lat)) return rejeitar('latitude_invalida');
    if (lat < -90 || lat > 90) return rejeitar('latitude_fora_do_intervalo');
    trim(buf, FS[4], FE[4]);
    const lon = lerDecimal(buf, TA, TB);
    if (!Number.isFinite(lon)) return rejeitar('longitude_invalida');
    if (lon < -180 || lon > 180) return rejeitar('longitude_fora_do_intervalo');

    // cadastro da pessoa
    let pi;
    if (id === ultimoId) pi = ultimoIdx;
    else {
      pi = indicePessoa.get(id);
      if (pi === undefined) {
        pi = pessoas.length;
        pessoas.push({ id, faccao: '', vitima: false, restricoes: new Set(), restricoesLidas: false });
        indicePessoa.set(id, pi);
      }
      ultimoId = id;
      ultimoIdx = pi;
    }
    const p = pessoas[pi];

    if (p.faccao === '') {
      trim(buf, FS[1], FE[1]);
      if (TB > TA) p.faccao = buf.toString('utf8', TA, TB);
    }
    if (n > 5 && !p.vitima) {
      trim(buf, FS[5], FE[5]);
      // atalho para os valores mais comuns, sem criar string
      const c0 = buf[TA] | 32;
      const len = TB - TA;
      let valor;
      if (len === 5 && c0 === 102) valor = false; // false
      else if (len === 4 && c0 === 116) valor = true; // true
      else if (len === 0) valor = false;
      else valor = lerBooleano(buf.toString('utf8', TA, TB));
      if (valor === null) {
        avisar('medidaProtetiva_nao_reconhecida_tratada_como_false');
        valor = false;
      }
      if (valor) p.vitima = true;
    }
    if (n > 6 && !p.restricoesLidas) {
      trim(buf, FS[6], FE[n - 1]);
      if (TB > TA) {
        for (const r of lerRestricoes(buf.toString('utf8', TA, TB))) p.restricoes.add(r);
        p.restricoesLidas = true;
      }
    }

    linha.pessoa = pi;
    linha.lat = lat;
    linha.lon = lon;
    estatisticas.linhasValidas++;
    return true;
  }

  return { ler, linha, pessoas, estatisticas };
}

module.exports = { criarParser, chaveTimestamp, timestampValido, lerBooleano, lerRestricoes, normalizarId };
