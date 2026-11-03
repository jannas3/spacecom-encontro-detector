'use strict';

/**
 * Configurações centralizadas. As regras de negócio do desafio ficam aqui e
 * não devem ser alteradas sem revisar os gabaritos oficiais.
 */

const MiB = 1024 * 1024;

module.exports = Object.freeze({
  // Regras do desafio (NÃO ALTERAR)
  RAIO_TERRA_METROS: 6371000,
  LIMITE_METROS: 20,
  TIPOS: Object.freeze(['protetiva', 'faccao', 'generico']),
  CABECALHO_ESPERADO: Object.freeze([
    'idMonitorado',
    'faccaoMonitorado',
    'timestamp',
    'latitude',
    'longitude',
    'medidaProtetiva',
    'idsRestricaoMedida',
  ]),

  // Otimização (não muda o resultado: a decisão final é sempre o Haversine)
  CELULA_METROS: 25,
  LIMIAR_FORCA_BRUTA: 32,
  // Acima dessa |latitude| a largura da célula em longitude perde a garantia de
  // cobertura (cos φ → 0); o grupo inteiro é comparado por força bruta.
  LATITUDE_MAX_GRADE: 85,
  // Perto de ±180° dois pontos vizinhos ficam em células opostas da grade;
  // o grupo inteiro é comparado por força bruta.
  LONGITUDE_MAX_GRADE: 179.5,

  // Leitura
  TAMANHO_BLOCO_LEITURA: 16 * MiB,

  // Pastas padrão (relativas ao diretório de execução)
  DIRETORIOS: Object.freeze({
    dados: 'dados',
    saida: 'saida',
    logs: 'logs',
    relatorios: 'relatorios',
  }),

  // Logs
  LOG: Object.freeze({
    nivelPadrao: 'INFO',
    tamanhoMaxBytes: 5 * MiB,
    arquivosMantidos: 3,
  }),
});
