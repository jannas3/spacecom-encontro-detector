#!/usr/bin/env node
'use strict';

/**
 * Processa todos os datasets, grava os JSONs oficiais, valida contra os gabaritos
 * disponíveis e gera um relatório de execução.
 *
 *   node src/cli/rodar-todos.js [dados] [saida] [--repeticoes=3] [--dataset=N] [--incluir-vitimas]
 *
 * Saídas:
 *   saida/datasetN.json                  resultado oficial (gravação atômica)
 *   relatorios/relatorio-execucao.json   métricas por dataset (o visualizador lê)
 *   relatorios/saidas-anteriores/<data>/ cópia de um JSON que mudou de conteúdo
 *   logs/*.log
 *
 * Código de saída: 0 = tudo certo | 2 = alguma validação com divergência | 1 = erro
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { analisar, carregarPessoas } = require('../core/detector');
const { gravarJsonSeguro, lerJson } = require('../infrastructure/gravador-json');
const { compararResultados, formatarRelatorio } = require('../validation/validador');
const { medirMemoria } = require('../observability/metricas');
const { ErroEntrada, erroDeArquivo } = require('../core/erros');
const { lerArgumentos, inteiroPositivo, executarCli } = require('./comum');
const { DIRETORIOS } = require('../config/configuracoes');

const media = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

executarCli('rodar-todos', ({ logger }) => {
  const { flags, posicionais } = lerArgumentos();
  const [pastaDados = DIRETORIOS.dados, pastaSaida = DIRETORIOS.saida] = posicionais;
  const repeticoes = inteiroPositivo(flags.repeticoes, 'repeticoes', 3);
  const so = flags.dataset !== undefined ? inteiroPositivo(flags.dataset, 'dataset') : null;
  const incluirVitimas = !!flags['incluir-vitimas'];

  let arquivos;
  try {
    arquivos = fs.readdirSync(pastaDados);
  } catch (err) {
    throw erroDeArquivo(err, pastaDados, 'listar a pasta');
  }
  const datasets = arquivos
    .map((f) => /^dataset(\d+)\.txt$/i.exec(f))
    .filter(Boolean)
    .map((m) => ({ numero: Number(m[1]), arquivo: m[0] }))
    .filter((d) => so === null || d.numero === so)
    .sort((a, b) => a.numero - b.numero);
  if (!datasets.length) {
    throw new ErroEntrada(`Nenhum datasetN.txt encontrado em "${pastaDados}"${so !== null ? ` (procurando dataset${so})` : ''}.`, { codigo: 'SEM_DATASETS' });
  }

  const inicio = new Date();
  const pastaAnteriores = path.join(DIRETORIOS.relatorios, 'saidas-anteriores', inicio.toISOString().replace(/[:.]/g, '-'));
  logger.execucao('rodar-todos: início', { datasets: datasets.map((d) => d.arquivo), repeticoes, incluirVitimas });

  const relatorio = {
    geradoEm: inicio.toISOString(),
    ambiente: { node: process.version, plataforma: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0] && os.cpus()[0].model },
    repeticoes,
    incluirVitimas,
    datasets: [],
  };
  let houveDivergencia = false;
  let houveErro = false;

  for (const d of datasets) {
    const entrada = path.join(pastaDados, d.arquivo);
    try {
      const tempos = [];
      let resultado;
      for (let r = 0; r < repeticoes; r++) {
        const atual = analisar(entrada, { incluirVitimas });
        tempos.push(atual.info.tempoTotalMs);
        if (r === 0) resultado = atual; // métricas da 1ª execução; as demais medem só o tempo
      }
      const { encontros, info } = resultado;
      for (const aviso of info.avisos) logger.warn(`${d.arquivo}: ${aviso}`);

      const saida = path.join(pastaSaida, `dataset${d.numero}.json`);
      const t0 = process.hrtime.bigint();
      const gravacao = gravarJsonSeguro(saida, encontros, { copiaAnteriorEm: pastaAnteriores });
      const escritaMs = Number(process.hrtime.bigint() - t0) / 1e6;

      const m = info.metricas;
      const item = {
        dataset: d.numero,
        arquivo: d.arquivo,
        tamanhoBytes: fs.statSync(entrada).size,
        modo: info.modo,
        linhas: {
          lidas: info.estatisticas.linhasLidas,
          validas: info.estatisticas.linhasValidas,
          invalidas: info.estatisticas.linhasInvalidas,
          duplicadas: info.estatisticas.linhasDuplicadas,
          duplicadasConflitantes: info.estatisticas.duplicadasConflitantes,
          motivos: info.estatisticas.motivos,
        },
        pessoas: info.pessoas,
        timestamps: info.timestamps,
        encontros: encontros.length,
        porTipo: info.porTipo,
        tempos: { mediaMs: media(tempos), minMs: Math.min(...tempos), execucoesMs: tempos, buscaMs: info.tempoBuscaMs, escritaMs },
        pares: {
          forcaBruta: m.paresForcaBruta,
          candidatos: m.paresCandidatos,
          haversine: m.calculosHaversine,
          gruposGrade: m.gruposGrade,
          gruposForcaBruta: m.gruposForcaBruta,
          gruposFallback: m.gruposFallback,
        },
        memoria: medirMemoria(),
        saida: { arquivo: saida, alterado: gravacao.alterado, copiaAnterior: gravacao.copiaAnterior },
        avisos: info.avisos,
        validacao: null,
      };

      const fmt = (n) => n.toLocaleString('pt-BR');
      console.log(
        `${d.arquivo.padEnd(14)} ${String(encontros.length).padStart(6)} encontros  média ${item.tempos.mediaMs.toFixed(1)} ms (${repeticoes}x)` +
          `  [${info.modo}, ${fmt(info.estatisticas.linhasValidas)} linhas, ${fmt(m.paresCandidatos)} pares avaliados de ${fmt(m.paresForcaBruta)}]` +
          (gravacao.alterado && gravacao.copiaAnterior ? '  (saída mudou; anterior guardada)' : '')
      );
      for (const aviso of info.avisos) console.log(`   Aviso: ${aviso}`);

      const resposta = path.join(pastaDados, `respostas${d.numero}.json`);
      if (fs.existsSync(resposta)) {
        const esperado = lerJson(resposta);
        const rel = compararResultados(encontros, esperado);
        item.validacao = {
          perfeito: rel.perfeito,
          score: rel.score,
          corretos: rel.corretos,
          falsosPositivos: rel.falsosPositivos.length,
          falsosNegativos: rel.falsosNegativos.length,
          tipoErrado: rel.tipoErrado.length,
          duplicados: rel.duplicados.length,
          invalidos: rel.invalidos.length,
          maiorDiferencaDistancia: rel.maiorDiferencaDistancia,
        };
        if (!rel.perfeito) houveDivergencia = true;
        const texto = formatarRelatorio(rel, { pessoas: rel.perfeito ? null : carregarPessoas(entrada), gerado: encontros, esperado });
        console.log(texto.split('\n').map((l) => '   ' + l).join('\n'));
        logger.execucao(`${d.arquivo}: validação`, item.validacao);
      }

      logger.execucao(`${d.arquivo} processado`, { modo: info.modo, linhas: item.linhas, encontros: encontros.length, porTipo: info.porTipo, saidaAlterada: gravacao.alterado });
      logger.performance(`${d.arquivo} desempenho`, { tempos: item.tempos, pares: item.pares, memoria: item.memoria });
      relatorio.datasets.push(item);
    } catch (err) {
      // um dataset com problema não impede os demais
      houveErro = true;
      console.log(`${d.arquivo.padEnd(14)} ERRO: ${err.message}`);
      logger.error(`${d.arquivo}: falha no processamento`, { erro: err });
      relatorio.datasets.push({ dataset: d.numero, arquivo: d.arquivo, erro: err.message });
    }
  }

  const ok = relatorio.datasets.filter((x) => !x.erro);
  relatorio.somaMediasMs = ok.reduce((a, x) => a + x.tempos.mediaMs, 0);
  relatorio.memoriaFinal = medirMemoria();
  const caminhoRelatorio = path.join(DIRETORIOS.relatorios, 'relatorio-execucao.json');
  gravarJsonSeguro(caminhoRelatorio, relatorio, { indentacao: 2 });

  console.log(`\nSoma dos tempos médios: ${relatorio.somaMediasMs.toFixed(1)} ms`);
  if (relatorio.memoriaFinal.picoRssMB) console.log(`Pico de memória do processo: ${relatorio.memoriaFinal.picoRssMB.toFixed(0)} MB`);
  console.log(`Relatório: ${caminhoRelatorio} | Logs: ${DIRETORIOS.logs}/`);
  logger.execucao('rodar-todos: fim', { somaMediasMs: relatorio.somaMediasMs, houveDivergencia, houveErro });

  return houveErro ? 1 : houveDivergencia ? 2 : 0;
});
