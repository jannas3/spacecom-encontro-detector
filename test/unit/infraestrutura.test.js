'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gravarJsonSeguro, lerJson } = require('../../src/infrastructure/gravador-json');
const { lerLinhas } = require('../../src/infrastructure/leitor-dataset');
const { criarLogger } = require('../../src/observability/logger');
const { ErroEntrada, ErroEscrita, ErroDados } = require('../../src/core/erros');
const { pastaTemporaria } = require('../helpers/util');

test('gravação atômica: conteúdo correto e nenhum temporário sobrando', (t) => {
  const dir = pastaTemporaria(t);
  const destino = path.join(dir, 'sub', 'saida.json');
  const r1 = gravarJsonSeguro(destino, [{ a: 1 }]);
  assert.deepStrictEqual(lerJson(destino), [{ a: 1 }]);
  assert.strictEqual(r1.alterado, true);
  assert.strictEqual(gravarJsonSeguro(destino, [{ a: 1 }]).alterado, false);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(destino)), ['saida.json']);
});

test('guarda a versão anterior quando o conteúdo muda', (t) => {
  const dir = pastaTemporaria(t);
  const destino = path.join(dir, 'd.json');
  gravarJsonSeguro(destino, [1]);
  const r = gravarJsonSeguro(destino, [2], { copiaAnteriorEm: path.join(dir, 'anteriores') });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(r.copiaAnterior, 'utf8')), [1]);
  assert.deepStrictEqual(lerJson(destino), [2]);
});

test('erro de serialização vira ErroEscrita com mensagem clara', (t) => {
  const dir = pastaTemporaria(t);
  const circular = {};
  circular.eu = circular;
  assert.throws(() => gravarJsonSeguro(path.join(dir, 'x.json'), circular), (e) => e instanceof ErroEscrita && /converter o resultado em JSON/.test(e.message));
});

test('JSON inválido e arquivo inexistente geram erros contextualizados', (t) => {
  const dir = pastaTemporaria(t);
  fs.writeFileSync(path.join(dir, 'ruim.json'), '[{');
  assert.throws(() => lerJson(path.join(dir, 'ruim.json')), ErroDados);
  assert.throws(() => lerJson(path.join(dir, 'nao-existe.json')), (e) => e instanceof ErroEntrada && /não encontrado/.test(e.message));
});

test('leitor: arquivo inexistente, vazio e pasta', (t) => {
  const dir = pastaTemporaria(t);
  fs.writeFileSync(path.join(dir, 'vazio.txt'), '');
  assert.throws(() => lerLinhas(path.join(dir, 'x.txt'), () => {}), /não encontrado/);
  assert.throws(() => lerLinhas(path.join(dir, 'vazio.txt'), () => {}), /Arquivo vazio/);
  assert.throws(() => lerLinhas(dir, () => {}), /é uma pasta/);
});

test('leitor: linhas divididas entre blocos, CRLF, BOM, sem quebra no fim', (t) => {
  const dir = pastaTemporaria(t);
  const linhas = Array.from({ length: 500 }, (_, i) => `linha número ${i} ${'x'.repeat(i % 37)}`);
  fs.writeFileSync(path.join(dir, 'a.txt'), '﻿' + linhas.join('\r\n'));
  for (const tamanhoBloco of [64, 100, 1000, 1 << 20]) {
    const lidas = [];
    lerLinhas(path.join(dir, 'a.txt'), (buf, s, e) => lidas.push(buf.toString('utf8', s, e).replace(/\r$/, '')), { tamanhoBloco });
    assert.deepStrictEqual(lidas, linhas, `bloco ${tamanhoBloco}`);
  }
});

test('leitor: UTF-8 com acentos não se quebra entre blocos', (t) => {
  const dir = pastaTemporaria(t);
  const linhas = Array.from({ length: 200 }, (_, i) => `facção-ã-é-${i}`);
  fs.writeFileSync(path.join(dir, 'u.txt'), linhas.join('\n'));
  const lidas = [];
  lerLinhas(path.join(dir, 'u.txt'), (buf, s, e) => lidas.push(buf.toString('utf8', s, e)), { tamanhoBloco: 67 });
  assert.deepStrictEqual(lidas, linhas);
});

test('logger: níveis, arquivos separados, rotação e sem quebrar sem pasta', (t) => {
  const dir = pastaTemporaria(t);
  const log = criarLogger({ pasta: dir, nivel: 'INFO', tamanhoMaxBytes: 300, arquivosMantidos: 2 });
  log.debug('não deve aparecer');
  log.info('olá', { n: 1 });
  log.error('falhou', { erro: new ErroDados('x', { codigo: 'C' }) });
  log.performance('perf', { ms: 1 });
  for (let i = 0; i < 20; i++) log.execucao('execução ' + i, { i });
  const app = fs.readFileSync(path.join(dir, 'aplicacao.log'), 'utf8');
  assert.ok(!app.includes('não deve aparecer'));
  assert.match(fs.readFileSync(path.join(dir, 'erros.log'), 'utf8'), /\[ERROR\] falhou .*"codigo":"C"/);
  assert.match(fs.readFileSync(path.join(dir, 'performance.log'), 'utf8'), /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} \[INFO\] perf/);
  const arquivos = fs.readdirSync(dir);
  assert.ok(arquivos.includes('execucoes.1.log'));
  assert.ok(!arquivos.includes('execucoes.3.log'));
  const semArquivo = criarLogger({ pasta: null });
  semArquivo.error('ok mesmo sem pasta');
});
