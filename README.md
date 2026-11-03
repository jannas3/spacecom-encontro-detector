# Detector de Encontros — Trainee Tech Spacecom 2027

**Janaina dos Santos Ferreira**

![Visualizador do detector de encontros](docs/img/visualizador.png)

## Tecnologia utilizada

JavaScript com Node.js (versão 18 ou superior), sem dependências externas.

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
saida/             datasetN.json (resultado)
docs/              detalhes técnicos
```

## Como executar

Coloque os arquivos `datasetN.txt` e `respostasN.json` na pasta `dados/` e rode, na pasta do projeto:

```bash
npm start                     # gera saida/dataset1.json … dataset7.json e valida os datasets 1 e 2
npm test                      # roda os testes
start visualizador\index.html # abre o visualizador no navegador
```
