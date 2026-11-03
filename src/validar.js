#!/usr/bin/env node
'use strict';

/**
 * Compara a saída gerada com a resposta oficial (respostas1.json / respostas2.json).
 *
 * Uso:
 *   node src/validar.js <gerado.json> <esperado.json> [entrada.txt]
 *
 * Um encontro é identificado por: timestamp + par de ids (ordem não importa).
 * Reporta acertos, falsos positivos, faltantes, tipo trocado e o score (acertos - errados).
 * Se a entrada for passada, explica o perfil das pessoas nos casos divergentes
 * (vítima? facção? está na lista de restrição?) — útil pra ajustar as regras.
 */

const fs = require('fs');
const { carregarPessoas } = require('./detector');

const chave = (e) => {
  const [a, b] = e.monitoradosEncontro.map(String).sort();
  return `${e.timestamp}|${a}|${b}`; // comparação estrita, igual à correção oficial
};

function indexar(lista) {
  const m = new Map();
  for (const e of lista) m.set(chave(e), e);
  return m;
}

function perfil(pessoas, id) {
  const p = pessoas.get(id) ?? pessoas.get(Number(id)) ?? pessoas.get(String(id));
  if (!p) return `${id}(?)`;
  const r = p.restricoes.size ? ` restr=[${[...p.restricoes].join(',')}]` : '';
  return `${id}(${p.vitima ? 'vitima' : 'monitorado'}${p.faccao ? ' fac=' + p.faccao : ''}${r})`;
}

function main() {
  const [gerPath, espPath, entrada] = process.argv.slice(2);
  if (!gerPath || !espPath) {
    console.error('Uso: node src/validar.js <gerado.json> <esperado.json> [entrada.txt]');
    process.exit(1);
  }
  const gerado = indexar(JSON.parse(fs.readFileSync(gerPath, 'utf8')));
  const esperado = indexar(JSON.parse(fs.readFileSync(espPath, 'utf8')));
  const pessoas = entrada ? carregarPessoas(entrada) : null;

  let corretos = 0;
  const tipoErrado = [];
  const falsosPositivos = [];
  const faltando = [];
  let maiorDifDist = 0;

  for (const [k, e] of gerado) {
    const ok = esperado.get(k);
    if (!ok) falsosPositivos.push(e);
    else if (ok.tipo !== e.tipo) tipoErrado.push({ gerado: e, esperado: ok });
    else {
      corretos++;
      maiorDifDist = Math.max(maiorDifDist, Math.abs(ok.distanciaMetros - e.distanciaMetros));
    }
  }
  for (const [k, e] of esperado) if (!gerado.has(k)) faltando.push(e);

  const contar = (l, f = (e) => e.tipo) => l.reduce((acc, e) => ((acc[f(e)] = (acc[f(e)] || 0) + 1), acc), {});

  console.log(`Esperados: ${esperado.size} ${JSON.stringify(contar([...esperado.values()]))}`);
  console.log(`Gerados:   ${gerado.size} ${JSON.stringify(contar([...gerado.values()]))}`);
  console.log(`Corretos:  ${corretos}`);
  console.log(`Tipo errado: ${tipoErrado.length} ${JSON.stringify(contar(tipoErrado, (x) => `${x.gerado.tipo}->${x.esperado.tipo}`))}`);
  console.log(`Falsos positivos: ${falsosPositivos.length} ${JSON.stringify(contar(falsosPositivos))}`);
  console.log(`Faltando: ${faltando.length} ${JSON.stringify(contar(faltando))}`);
  console.log(`Maior diferença de distância nos acertos: ${maiorDifDist.toExponential(2)} m`);
  console.log(`Score estimado (corretos - incorretos): ${corretos - falsosPositivos.length - tipoErrado.length}`);

  const mostrar = (titulo, lista, fmt) => {
    if (!lista.length) return;
    console.log(`\n${titulo} (até 10):`);
    for (const x of lista.slice(0, 10)) console.log('  ' + fmt(x));
  };
  const desc = (e) => {
    const [a, b] = e.monitoradosEncontro;
    const info = pessoas ? ` ${perfil(pessoas, a)} x ${perfil(pessoas, b)}` : ` [${a}, ${b}]`;
    return `${e.timestamp} ${e.tipo} ${e.distanciaMetros.toFixed(3)}m${info}`;
  };
  mostrar('Tipo errado', tipoErrado, (x) => `gerado=${x.gerado.tipo} esperado=${x.esperado.tipo} :: ${desc(x.esperado)}`);
  mostrar('Falsos positivos', falsosPositivos, desc);
  mostrar('Faltando', faltando, desc);

  const perfeito = !tipoErrado.length && !falsosPositivos.length && !faltando.length;
  console.log(perfeito ? '\n✅ Saída idêntica à resposta oficial.' : '\n❌ Há divergências — veja acima.');
  process.exit(perfeito ? 0 : 2);
}

main();
