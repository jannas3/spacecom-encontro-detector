# Detector de Encontros — Trainee Tech Spacecom 2027

**Janaina dos Santos Ferreira**

![Visualizador do detector de encontros](docs/img/visualizador.png)

## Tecnologia utilizada

JavaScript com Node.js (versão 18 ou superior), sem dependências externas.

## Lógica utilizada

1. **Leitura em blocos de 16 MB**, com o parse feito direto nos bytes. Isso permite processar o dataset7 (638 MB, 12 milhões de linhas), que não caberia numa única string.
2. **Validação de cada linha** (timestamp, latitude, longitude). Linhas inválidas são contadas e informadas, não descartadas em silêncio.
3. **Agrupamento por timestamp exato**, porque só se comparam posições do mesmo instante. Como o arquivo vem ordenado, cada grupo é processado assim que termina, e a memória fica baixa.
4. **Grade espacial de 25 m.** Dois pontos a menos de 20 m sempre ficam na mesma célula ou em células vizinhas, então cada ponto só é comparado com a vizinhança. Perto dos polos e da longitude ±180°, onde essa garantia falha, o grupo usa comparação completa.
5. **Fórmula de Haversine** (raio de 6.371.000 m) decide se é encontro, com o limite estrito de `< 20 m` e sem arredondar.
6. **Classificação** por prioridade: `protetiva` (agressor e sua vítima) > `faccao` (mesma facção) > `generico`. Cada par aparece uma única vez por timestamp.

**Interpretação:** o encontro de uma vítima com alguém que não é o agressor dela não é registrado, porque o enunciado define "genérico" como encontro entre dois monitorados. Essa leitura é compatível com os gabaritos.

## Por que esta é a melhor abordagem

- **Precisão:** a grade só escolhe os candidatos; quem decide é sempre o Haversine. Testes automatizados comparam a grade com a comparação de todos contra todos e chegam sempre aos mesmos encontros. Os datasets 1 e 2 batem 100% com os gabaritos, inclusive na distância.
- **Desempenho:** comparar todos com todos seria O(n²). Com a grade, o dataset7 avalia **47 pares de 714 milhões** possíveis e é processado em poucos segundos.
- **Simplicidade:** sem dependências, com o código separado por responsabilidade e 57 testes automatizados.

## Estrutura

```
src/
  core/            detector, grade espacial, haversine, classificador
  infrastructure/  leitura do arquivo em blocos, parser, gravação do JSON
  validation/      validação da entrada e comparação com os gabaritos
  observability/   logs e métricas
  cli/             comandos (npm start, validate, benchmark)
  config/          regras e parâmetros
test/              testes automatizados
visualizador/      página de explicação e análise
dados/             datasetN.txt e respostasN.json (entrada)
saida/             datasetN.json (resultado dos 7 datasets)
docs/              detalhes técnicos
```

## Como executar

Coloque os arquivos `datasetN.txt` e `respostasN.json` na pasta `dados/` e rode, na pasta do projeto:

```bash
npm start                     # gera saida/dataset1.json … dataset7.json e valida os datasets 1 e 2
npm test                      # roda os testes
start visualizador\index.html # abre o visualizador no navegador
```
