'use strict';

const { ErroDados } = require('../core/erros');

/**
 * Decide, a partir das estatísticas do parser, o que é erro recuperável
 * (vira aviso) e o que impede gerar um resultado confiável (vira ErroDados).
 *
 * @param {object} est  estatísticas de infrastructure/parser
 * @param {string} caminho
 * @returns {{avisos: string[]}}
 * @throws {ErroDados} quando não há nenhuma linha válida
 */
function avaliarEntrada(est, caminho) {
  const avisos = [];

  if (est.cabecalho === 'ausente') avisos.push('Arquivo sem cabeçalho: a primeira linha foi tratada como dado.');
  if (est.cabecalho === 'divergente') avisos.push('Cabeçalho diferente do esperado; os campos foram lidos pela posição.');

  if (est.linhasValidas === 0) {
    throw new ErroDados(`Nenhuma linha válida em ${caminho}. Motivos: ${descreverMotivos(est.motivos) || 'arquivo sem registros'}.`, {
      codigo: 'SEM_LINHAS_VALIDAS',
      contexto: { caminho, motivos: est.motivos },
    });
  }

  if (est.linhasInvalidas > 0) {
    const pct = ((est.linhasInvalidas / (est.linhasValidas + est.linhasInvalidas)) * 100).toFixed(2);
    avisos.push(`${est.linhasInvalidas} linha(s) rejeitada(s) (${pct}%): ${descreverMotivos(filtrarRejeicoes(est))}.`);
  }
  if (est.linhasDuplicadas > 0) avisos.push(`${est.linhasDuplicadas} linha(s) duplicada(s) ignorada(s) (mesma pessoa, timestamp e posição).`);
  if (est.duplicadasConflitantes > 0) {
    avisos.push(`${est.duplicadasConflitantes} linha(s) com a mesma pessoa e timestamp mas posição diferente; foi mantida a primeira.`);
  }
  if (est.avisos > 0) avisos.push(`${est.avisos} linha(s) aceita(s) com campo fora do padrão: ${descreverMotivos(filtrarAvisos(est))}.`);

  return { avisos };
}

const MOTIVOS_DE_REJEICAO = new Set([
  'campos_insuficientes',
  'id_vazio',
  'timestamp_invalido',
  'latitude_invalida',
  'latitude_fora_do_intervalo',
  'longitude_invalida',
  'longitude_fora_do_intervalo',
]);

const filtrarRejeicoes = (est) => Object.fromEntries(Object.entries(est.motivos).filter(([m]) => MOTIVOS_DE_REJEICAO.has(m)));
const filtrarAvisos = (est) =>
  Object.fromEntries(Object.entries(est.motivos).filter(([m]) => !MOTIVOS_DE_REJEICAO.has(m) && !m.startsWith('duplicada')));

function descreverMotivos(motivos) {
  return Object.entries(motivos)
    .map(([m, q]) => `${m.replace(/_/g, ' ')} (${q})`)
    .join(', ');
}

module.exports = { avaliarEntrada, MOTIVOS_DE_REJEICAO };
