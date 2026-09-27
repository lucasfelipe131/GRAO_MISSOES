# VAL-SOG — Grãos Missões

VAL-SOG (Sistema de Operações de Grãos) para a praça de São Luiz Gonzaga/RS, com a identidade visual azul da VAL e a fonte Manrope embutida. Cada pedido do produtor ("quero vender 3 mil sacas até março, preciso de caixa em outubro") vira uma análise personalizada: leitura de mercado, base contra porto, margem sobre custo, três alvos de fechamento escalonados por objetivo, cenários e dicas explicáveis.

Nada é executado automaticamente e nenhuma cotação é inventada. A comparação de preço usa apenas cotações registradas com fonte e horário. A decisão permanece com o consultor e o produtor.

## O que o sistema faz

- **Painel**: indicadores da carteira (produtores, pedidos abertos, alvos atingidos, cotações do dia, produtores abaixo do ritmo, volume fechado), posição por grão (produção estimada × fixado), agenda de fechamentos (caixa, entrega, revisão do Alvo 3, meses de caixa) e fontes principais pendentes.

- **Produtores**: ficha operacional sem dados confidenciais: área, produtividade e percentual já fixado por cultura; quem decide, tolerância a risco, hábito de venda, o que convence, prazo de pagamento preferido, compradores habituais; armazenagem e custo de carregar, distância, logística, meses de compromisso de caixa, canal de contato. A ficha mostra posição da safra, ritmo de fixação por fase e histórico de pedidos.
- **Estratégia por produtor**: a análise usa a ficha para ajustar as parcelas (risco baixo ou alto), medir o ritmo de fixação contra a faixa da fase (pré-plantio 10–30%, plantio 25–45%, desenvolvimento 40–60%, colheita 60–80%, pós-colheita 80–100%), calcular o custo de carregar o grão até a entressafra e gerar orientações de abordagem (decisão em família, prova preferida, compradores a consultar).
- **Ofertas**: composição de oferta por produtor com calculadora de frete (distância × tarifa por tonelada-quilômetro + parcela fixa, em R$/saca), projeção por vencimento (referência de porto ou C.Vale ajustada pelo índice sazonal do mês de entrega, com carrego), margem C.Vale configurável, comparação com o concorrente e com o preço C.Vale do dia, e a **pedida do produtor** (quanto ele quer para vender, em R$/sc): o sistema mostra a diferença por saca e no lote, diz se a oferta atende, se atenderia reduzindo a margem (e para quanto) ou se não fecha nem com margem zero, e aponta os vencimentos em que a pedida seria atendida. Cada oferta fica registrada com situação (rascunho, enviada, aceita, recusada, expirada, cancelada), preço fechado, histórico e campo de observações; exportação em CSV e em JSON (`GET /api/offers/export`) para cruzar com a VAL.
- **Preços do ano**: por grão, linha dos últimos 12 meses (C.Vale, média dos concorrentes e porto), estatísticas (atual, média, mínima, máxima, posição no intervalo), média mensal registrada, índice sazonal indicativo com leitura para os próximos 3 meses e importação de histórico em linhas data;preço.
- **Armazenagem**: guia de pós-colheita por cultura (recebimento, secagem, umidade e temperatura de armazenagem, pragas, riscos que viram desconto, relação com a venda) e regras gerais de aeração, termometria, pragas, expurgo e checklists.
- **Preços de porto**: Bunge, ADM, LDC e Cargill no porto de Rio Grande, informados pela mesa ou corretora; base = C.Vale menos porto.
- **Tendência de preço**: gráfico simples por grão com as cotações locais registradas; exportação em CSV de cotações, pedidos e produtores.
- **Preço C.Vale hoje**: campo manual para a cotação própria da unidade de São Luiz Gonzaga (soja, milho, trigo e prazo). É a referência do comparativo.
- **Comparativo de compradores**: o servidor abre as páginas dos concorrentes (Coopatrigo, Cotrisal, Agrolink, Grão Direto, Notícias Agrícolas, CEPEA), procura o preço perto do nome do grão e mostra a diferença para a C.Vale. A leitura roda ao subir e a cada `AUTO_FETCH_HOURS` (padrão 4 h) e pode ser disparada pelo botão “Buscar agora”. Nada vira cotação sem clique em salvar; leituras salvas ficam marcadas como automáticas, com confiança reduzida e o trecho lido nas observações.
- **Abastecimento automático**: a cada `AUTO_FETCH_HOURS` (padrão 4 h) as leituras válidas dos concorrentes, do porto público (Rio Grande no mercado físico e Paranaguá CEPEA) e dos indicadores CEPEA viram cotações “auto”, uma por fonte, grão e dia; as páginas do CEPEA também alimentam o histórico de datas que exibem. `AUTO_SAVE=false` volta ao modo manual. Toda cotação tem **Editar** para corrigir divergências; a correção fica marcada, guarda o valor original e não é sobrescrita pela próxima leitura.
- **Histórico pesquisado**: `data/historico.json` traz pontos reais de fontes públicas (CEPEA trigo RS mensal, Emater e Agrolink milho RS, porto de Rio Grande, Paranaguá, Cotrisal) que são semeados uma única vez para o painel do ano começar com dados.
- **Cotações**: registro com grão, preço, praça ou comprador, fonte do catálogo (praça, unidade, prazo e link preenchidos), prazo de pagamento e horário de observação. Cotações com mais de 7 dias ficam marcadas como vencidas.
- **C.Vale × concorrência na análise**: cada pedido mostra o preço C.Vale contra o melhor concorrente das últimas 72 h; quando um concorrente paga mais, a análise alerta e sugere como conduzir.
- **Pedidos**: formulário com o pedido do produtor. A análise `analysis-v1` devolve manchete, referência usada, distância ao preço-alvo, margem, base contra porto, Alvo 1 (gatilho imediato), Alvo 2 (preço do produtor) e Alvo 3 (esticada condicional), cenários e dicas. O pedido fica em acompanhamento; fechamentos parciais são registrados com preço, volume e comprador.
- **Alvos atingidos**: sempre que uma cotação registrada alcança um alvo de um pedido aberto, o painel avisa.
- **Praça**: briefing datado de São Luiz Gonzaga (calendário, compradores, frete, base, riscos e fontes), separado das cotações operacionais.

Distribuição das parcelas por objetivo:

| Objetivo | Alvo 1 | Alvo 2 | Alvo 3 |
| --- | ---: | ---: | ---: |
| Fazer caixa | 50% | 30% | 20% |
| Melhor preço médio | 25% | 35% | 40% |
| Reduzir risco | 40% | 35% | 25% |
| Equilíbrio | 34% | 33% | 33% |

## Rodar localmente

```bash
npm test
npm start
# abre http://localhost:3000
```

Sem dependências externas: Node 20 ou superior. Os dados ficam em `DATA_DIR` (padrão `./.data/store.json`).

## Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `PORT` | porta HTTP; a Railway injeta automaticamente |
| `DATA_DIR` | pasta do arquivo de dados; na Railway use um volume montado em `/data` |
| `ACCESS_CODE` | código de acesso compartilhado da equipe; vazio deixa o acesso aberto (só para teste local) |
| `AUTO_FETCH_HOURS` | intervalo da leitura automática dos concorrentes em horas; `0` desliga (padrão 4) |
| `AUTO_SAVE` | `false` desliga o registro automático das leituras como cotações (padrão ligado) |

## Deploy na Railway

1. Conecte este repositório a um serviço na Railway (build Railpack detecta Node).
2. Crie um volume montado em `/data` e defina `DATA_DIR=/data`.
3. Defina `ACCESS_CODE` com um código forte.
4. Gere o domínio público. O healthcheck responde em `/health`.

Cada push na branch `main` gera um novo deploy.

## API

| Rota | Método | Função |
| --- | --- | --- |
| `/health` | GET | saúde do serviço |
| `/api/session` | GET | informa se há código de acesso e se o informado é válido |
| `/api/bootstrap` | GET | produtores, cotações, pedidos, alvos atingidos, briefing e catálogo |
| `/api/producers` | POST | cadastra produtor |
| `/api/producers/:id` | PUT | atualiza produtor |
| `/api/quotes` | POST | registra cotação |
| `/api/quotes/:id` | PUT | corrige uma cotação (preço, unidade, praça, prazo, data, motivo); marca como editada |
| `/api/quotes/:id` | DELETE | desativa cotação |
| `/api/own-quotes` | POST | registra o preço C.Vale do dia (soja, milho, trigo, prazo) |
| `/api/comparison/refresh` | POST | lê as páginas dos concorrentes agora |
| `/api/comparison/save` | POST | salva uma leitura como cotação (`sourceId`, `commodity`) |
| `/api/port-quotes` | POST | registra preços de porto de uma trading (`sourceId`, soja, milho, trigo, canola) |
| `/api/quotes/import` | POST | importa histórico de preços (`commodity`, `sourceName`, `lines`) |
| `/api/offer-settings` | PUT | tarifa de frete, fixo, margem padrão, carrego, validade e destinos |
| `/api/offers/preview` | POST | calcula uma oferta sem registrar |
| `/api/offers` | POST | registra a oferta |
| `/api/offers/:id` | PATCH | situação, preço fechado e observações |
| `/api/offers/export` | GET | ofertas, pedidos e produtores em JSON para integração |
| `/api/analyze` | POST | análise sem registrar o pedido |
| `/api/requests` | POST | registra pedido com análise |
| `/api/requests/:id/rerun` | POST | recalcula a análise com as cotações atuais |
| `/api/requests/:id/closings` | POST | registra fechamento parcial ou total |
| `/api/requests/:id` | PATCH | muda o estado (`open`, `closed`, `cancelled`) |

Todas as rotas de `/api/`, exceto `/api/session`, exigem o cabeçalho `x-access-code` quando `ACCESS_CODE` está definido.

## Base técnica da praça

`data/praca-sao-luiz-gonzaga.json` reúne aliases dos municípios da área da Coopatrigo, compradores com confiança declarada, frete e base históricos, calendário por cultura, padrões de qualidade, dicas de fechamento e o briefing de mercado de 22–23/09/2026 com fontes. Cada valor tem data e fonte; itens com confiança baixa precisam de confirmação da equipe local. Quando os relatórios internos forem entregues, eles substituem as fontes públicas.

## Integração futura com outros sistemas

O Grãos Missões é independente: tem cadastro, dados, acesso e deploy próprios. Outro sistema (um CRM, por exemplo) pode consumir a análise sem depender da interface, chamando `POST /api/analyze` com o cabeçalho `x-access-code` e o corpo do pedido, ou lendo `GET /api/bootstrap` para listar pedidos, alvos atingidos e briefing. Um token dedicado por integração e a exportação de produtores por planilha entram quando essa integração for decidida.

## Limites deste esboço

- Armazenamento em arquivo JSON: adequado para uma equipe; para várias unidades, migrar para PostgreSQL.
- Código de acesso único: não há usuários individuais nem trilha por consultor.
- A leitura automática depende do layout das páginas dos concorrentes; quando um site muda, a fonte aparece como “sem preço” ou “falhou” e o registro volta a ser manual até o ajuste em `data/sources.json`.
- A análise é determinística e explicável; não usa modelo de linguagem e não prevê preço.
