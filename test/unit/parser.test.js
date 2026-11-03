'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { criarParser, chaveTimestamp, timestampValido, lerBooleano, lerRestricoes } = require('../../src/infrastructure/parser');
const { CABECALHO_ESPERADO } = require('../../src/config/configuracoes');

function lerTudo(linhas) {
  const parser = criarParser({ cabecalhoEsperado: CABECALHO_ESPERADO });
  const registros = [];
  for (const l of linhas) {
    const buf = Buffer.from(l, 'utf8');
    if (parser.ler(buf, 0, buf.length)) {
      const p = parser.pessoas[parser.linha.pessoa];
      registros.push({ id: p.id, ts: buf.toString('latin1', parser.linha.tsA, parser.linha.tsB), lat: parser.linha.lat, lon: parser.linha.lon, chave: parser.linha.chave });
    }
  }
  return { registros, parser };
}

test('formato oficial: só o timestamp entre aspas', () => {
  const { registros, parser } = lerTudo([CABECALHO_ESPERADO.join(';'), '9;;"2024-01-01 00:00:00";1.64046;-69.53947;true;"10"']);
  assert.strictEqual(parser.estatisticas.cabecalho, 'ok');
  assert.deepStrictEqual(registros[0], { id: 9, ts: '2024-01-01 00:00:00', lat: 1.64046, lon: -69.53947, chave: 20240101000000 });
  const p = parser.pessoas[0];
  assert.strictEqual(p.vitima, true);
  assert.deepStrictEqual([...p.restricoes], [10]);
});

test('todos os campos entre aspas, espaços e CR no fim', () => {
  const { registros, parser } = lerTudo(['"44";"1";"2024-01-01 00:01:55"; -10.20000 ;-37.20000;"false";""\r']);
  assert.strictEqual(registros.length, 1);
  assert.strictEqual(registros[0].lat, -10.2);
  assert.strictEqual(parser.pessoas[0].faccao, '1');
  assert.strictEqual(parser.estatisticas.cabecalho, 'ausente');
});

test('coordenadas idênticas ao parseFloat (mesmo double)', () => {
  const valores = ['-10.07996', '-37.08384', '0.00001', '89.99999', '-179.99995', '12', '-0.5', '3,25'];
  for (const v of valores) {
    const num = parseFloat(v.replace(',', '.'));
    const cabeEmLatitude = Math.abs(num) <= 90;
    const { registros } = lerTudo([`1;;2024-01-01 00:00:00;${cabeEmLatitude ? v : '0'};${v};false;`]);
    if (cabeEmLatitude) assert.strictEqual(registros[0].lat, num, v);
    assert.strictEqual(registros[0].lon, num, v);
  }
});

test('rejeita e conta linhas inválidas, sem descartar em silêncio', () => {
  const { registros, parser } = lerTudo([
    '1;;2024-01-01 00:00:00;-10.1;-37.1;false;', // válida
    '2;;2024-13-01 00:00:00;-10.1;-37.1;false;', // mês 13
    '3;;2024-01-01 0:00:00;-10.1;-37.1;false;', // formato
    '4;;20240101000000;-10.1;-37.1;false;', // só dígitos
    '5;;2024-01-01 00:00:00;abc;-37.1;false;', // lat inválida
    '6;;2024-01-01 00:00:00;91;-37.1;false;', // lat fora
    '7;;2024-01-01 00:00:00;-10.1;181;false;', // lon fora
    ';;2024-01-01 00:00:00;-10.1;-37.1;false;', // id vazio
    '8;;2024-01-01 00:00:00', // campos insuficientes
    '', // vazia
    '9;;2024-01-01 00:00:00;-10.1abc;-37.1;false;', // lixo no número
  ]);
  const e = parser.estatisticas;
  assert.strictEqual(registros.length, 1);
  assert.strictEqual(e.linhasValidas, 1);
  assert.strictEqual(e.linhasInvalidas, 9);
  assert.strictEqual(e.linhasVazias, 1);
  assert.deepStrictEqual(e.motivos, {
    timestamp_invalido: 3,
    latitude_invalida: 2,
    latitude_fora_do_intervalo: 1,
    longitude_fora_do_intervalo: 1,
    id_vazio: 1,
    campos_insuficientes: 1,
  });
  assert.deepStrictEqual(e.exemplos.timestamp_invalido, [2, 3, 4]);
});

test('booleano desconhecido vira aviso e é tratado como false', () => {
  const { parser } = lerTudo(['1;;2024-01-01 00:00:00;-10.1;-37.1;talvez;"2"']);
  assert.strictEqual(parser.pessoas[0].vitima, false);
  assert.strictEqual(parser.estatisticas.avisos, 1);
});

test('cabeçalho divergente é reconhecido e informado', () => {
  const { parser } = lerTudo(['idMonitorado;faccao;ts;lat;lon;medida;ids', '1;;2024-01-01 00:00:00;-10.1;-37.1;false;']);
  assert.strictEqual(parser.estatisticas.cabecalho, 'divergente');
  assert.strictEqual(parser.estatisticas.linhasValidas, 1);
});

test('chave de timestamp: formato exato, bijetora e cronológica', () => {
  const k = (s) => chaveTimestamp(Buffer.from(s), 0, s.length);
  assert.strictEqual(k('2024-01-01 00:00:05'), 20240101000005);
  assert.ok(k('2024-01-01 00:00:05') < k('2024-01-01 00:00:10'));
  assert.ok(k('2024-12-31 23:59:59') < k('2025-01-01 00:00:00'));
  for (const ruim of ['2024-01-01T00:00:05', '2024-02-30 00:00:00', '2024-01-01 24:00:00', '2024-01-01 00:60:00', '2024-01-01 00:00:5', ' 2024-01-01 00:00:05']) {
    assert.strictEqual(k(ruim), -1, ruim);
  }
  assert.strictEqual(timestampValido('2024-01-01 00:01:50'), true);
  assert.strictEqual(timestampValido('2024-01-01'), false);
});

test('booleanos e listas de restrição', () => {
  for (const v of ['true', 'TRUE', '1', 'sim', 'yes']) assert.strictEqual(lerBooleano(v), true, v);
  for (const v of ['false', '0', 'não', 'nao', '']) assert.strictEqual(lerBooleano(v), false, v);
  assert.strictEqual(lerBooleano('talvez'), null);
  assert.deepStrictEqual(lerRestricoes('"1,2, 3"'), [1, 2, 3]);
  assert.deepStrictEqual(lerRestricoes('[10]'), [10]);
  assert.deepStrictEqual(lerRestricoes(''), []);
  assert.deepStrictEqual(lerRestricoes('a7,8'), ['a7', 8]);
});
