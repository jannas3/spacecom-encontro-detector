'use strict';

/**
 * Erros da aplicação. Todo erro esperado (arquivo inexistente, dados inválidos,
 * falha de escrita) vira uma destas classes, com mensagem clara para o usuário
 * e contexto para o log. Erros fora destas classes são tratados como bugs.
 */
class ErroAplicacao extends Error {
  /**
   * @param {string} mensagem  texto para o usuário (sem stack trace)
   * @param {{codigo?: string, contexto?: object, causa?: Error}} [extra]
   */
  constructor(mensagem, { codigo = 'ERRO_APLICACAO', contexto = {}, causa } = {}) {
    super(mensagem, causa ? { cause: causa } : undefined);
    this.name = this.constructor.name;
    this.codigo = codigo;
    this.contexto = contexto;
  }
}

/** Problema com o arquivo de entrada ou argumentos (não dá para continuar). */
class ErroEntrada extends ErroAplicacao {}

/** O arquivo foi lido, mas o conteúdo não permite gerar um resultado confiável. */
class ErroDados extends ErroAplicacao {}

/** Falha ao gravar a saída. */
class ErroEscrita extends ErroAplicacao {}

/** Traduz erros de sistema de arquivos em mensagens compreensíveis. */
function erroDeArquivo(err, caminho, acao) {
  const mensagens = {
    ENOENT: `Arquivo ou pasta não encontrado: ${caminho}`,
    EACCES: `Sem permissão para ${acao}: ${caminho}`,
    EPERM: `Operação não permitida ao ${acao}: ${caminho}`,
    EISDIR: `Era esperado um arquivo, mas é uma pasta: ${caminho}`,
    ENOSPC: `Sem espaço em disco ao ${acao}: ${caminho}`,
    EMFILE: `Arquivos abertos demais ao ${acao}: ${caminho}`,
  };
  const msg = mensagens[err && err.code] || `Falha ao ${acao} ${caminho}: ${err && err.message}`;
  const Classe = acao.startsWith('gravar') || acao.startsWith('criar') ? ErroEscrita : ErroEntrada;
  return new Classe(msg, { codigo: (err && err.code) || 'ERRO_ARQUIVO', contexto: { caminho, acao }, causa: err });
}

module.exports = { ErroAplicacao, ErroEntrada, ErroDados, ErroEscrita, erroDeArquivo };
