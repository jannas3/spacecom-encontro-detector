'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { criarClassificador } = require('../../src/core/classificador');

const pessoa = (id, { faccao = '', vitima = false, restricoes = [] } = {}) => ({ id, faccao, vitima, restricoes: new Set(restricoes) });
const classificar = criarClassificador();

test('genérico: dois monitorados sem facção em comum', () => {
  assert.strictEqual(classificar(pessoa(1, { faccao: '1' }), pessoa(2, { faccao: '2' })), 'generico');
  assert.strictEqual(classificar(pessoa(1), pessoa(2)), 'generico');
  assert.strictEqual(classificar(pessoa(1, { faccao: '1' }), pessoa(2)), 'generico');
});

test('facção vazia não conta como mesma facção', () => {
  assert.strictEqual(classificar(pessoa(1, { faccao: '' }), pessoa(2, { faccao: '' })), 'generico');
});

test('facção: mesma facção preenchida', () => {
  assert.strictEqual(classificar(pessoa(1, { faccao: '3' }), pessoa(2, { faccao: '3' })), 'faccao');
});

test('protetiva: vítima e agressor da lista, nas duas ordens', () => {
  const v = pessoa(9, { vitima: true, restricoes: [10] });
  const a = pessoa(10, { faccao: '1' });
  assert.strictEqual(classificar(v, a), 'protetiva');
  assert.strictEqual(classificar(a, v), 'protetiva');
});

test('prioridade: protetiva vence facção', () => {
  const v = pessoa(9, { faccao: '1', vitima: true, restricoes: [10] });
  const a = pessoa(10, { faccao: '1' });
  assert.strictEqual(classificar(v, a), 'protetiva');
});

test('vítima com quem não é seu agressor: ignorado (interpretação documentada)', () => {
  const v = pessoa(9, { vitima: true, restricoes: [10] });
  assert.strictEqual(classificar(v, pessoa(11)), null);
  assert.strictEqual(classificar(v, pessoa(12, { vitima: true })), null);
});

test('vítima com lista de restrição vazia: nunca protetiva', () => {
  assert.strictEqual(classificar(pessoa(9, { vitima: true }), pessoa(10)), null);
});

test('--incluir-vitimas transforma esses casos em genérico, sem afetar protetiva', () => {
  const c = criarClassificador({ incluirVitimas: true });
  const v = pessoa(9, { vitima: true, restricoes: [10] });
  assert.strictEqual(c(v, pessoa(11)), 'generico');
  assert.strictEqual(c(v, pessoa(10)), 'protetiva');
});
