'use strict';

/**
 * Classificação de um par que já está a menos de 20 m. Um único tipo por par,
 * sempre o mais específico (prioridade: protetiva > faccao > generico).
 *
 * Interpretação documentada (preservada desde a versão validada nos gabaritos):
 * um encontro de vítima com quem NÃO é seu agressor não é registrado, porque o
 * enunciado define "genérico" como encontro "entre dois monitorados".
 * Com { incluirVitimas: true } esses pares viram "generico".
 *
 * Pessoa: { id, faccao: string, vitima: boolean, restricoes: Set }
 */
function criarClassificador({ incluirVitimas = false } = {}) {
  return function classificar(a, b) {
    if ((a.vitima && a.restricoes.has(b.id)) || (b.vitima && b.restricoes.has(a.id))) return 'protetiva';
    if (a.vitima || b.vitima) return incluirVitimas ? 'generico' : null;
    if (a.faccao !== '' && a.faccao === b.faccao) return 'faccao';
    return 'generico';
  };
}

module.exports = { criarClassificador };
