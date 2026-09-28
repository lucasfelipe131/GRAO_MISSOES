# VAL-SOG — Grãos Missões

VAL-SOG (Sistema de Operações de Grãos) para a praça de São Luiz Gonzaga/RS, com a identidade visual azul da VAL e a fonte Manrope embutida. Cada pedido do produtor ("quero vender 3 mil sacas até março, preciso de caixa em outubro") vira uma análise personalizada: leitura de mercado, base contra porto, margem sobre custo, três alvos de fechamento escalonados por objetivo, cenários e dicas explicáveis.

Nada é executado automaticamente e nenhuma cotação é inventada. A comparação de preço usa apenas cotações registradas com fonte e horário. A decisão permanece com o consultor e o produtor.

## O que o sistema faz

- **Painel**: indicadores da carteira (produtores, pedidos abertos, alvos atingidos, cotações do dia, produtores abaixo do ritmo, volume fechado), posição por grão (produção estimada × fixado), agenda de fechamentos (caixa, entrega, revisão do Alvo 3, meses de caixa) e fontes principais pendentes.

- **Produtores**: ficha operacional sem dados confidenciais: área, produtividade e percentual já fixado por cultura; quem decide, tolerância a risco, hábito de venda, o que convence, prazo de pagamento preferido, compradores habituais; armazenagem e custo de carregar, distância, logística, meses de compromisso de caixa, canal de contato. A ficha mostra posição da safra, ritmo de fixação por fase e histórico de pedidos.
- **Estratégia por produtor**: a análise usa a ficha para ajustar as parcelas (risco baixo ou alto), medir o ritmo de fixação contra a faixa da fase (pré-plantio 10–30%, plantio 25–45%, desenvolvimento 40–60%, colheita 60–80%, pós-colheita 80–100%), calcular o custo de carregar o grão até a entressafra e gerar orientações de abordagem (decisão em família, prova preferida, compradores a consultar).
- **Ofertas**: composição de oferta por produtor com calculadora de frete (distância × tarifa por tonelada-quilômetro + parcela fixa, em R$/saca), projeção por vencimento (referência de porto ou C.Vale ajustada pelo índice sazonal observado do mês de entrega, com carrego), margem C.Vale configurável, comparação com o concorrente e com o preço C.Vale do dia, e a **pedida do produtor** (quanto ele quer para vender, em R$/sc): o sistema mostra a diferença por saca e no lote, diz se a oferta atende, se atenderia reduzindo a margem (e para quanto) ou se não fecha nem com margem zero, e aponta os vencimentos em que a pedida seria atendida. O painel também traz o **histórico de pedidas por produtor** (ofertas com pedida e pedidos com preço-alvo): média, mínima e máxima, prêmio que ele costuma pedir sobre o C.Vale do dia, diferença média para a oferta, taxa de aceite e quanto fechou em relação ao que pediu, com a mesma leitura na ficha do produtor. Cada oferta fica registrada com situação (rascunho, enviada, aceita, recusada, expirada, cancelada), preço fechado, histórico e campo de observações; exportação em CSV e em JSON (`GET /api/offers/export`) para cruzar com a VAL.
- **Preços do ano**: gráfico interativo (ao passar o mouse ou tocar aparece o preço exato de cada série no dia, a média de 12 meses de cada série em linha pontilhada e a média exata do dia; filtros por série para comparar C.Vale, média dos concorrentes, porto e cada concorrente ou trading individualmente; linhas com animação e tabela dos dados). Por grão, linha dos últimos 12 meses (C.Vale, média dos concorrentes e porto), estatísticas (atual, média, mínima, máxima, posição no intervalo), média mensal registrada, padrão sazonal observado (janela de 36 meses; calculado apenas com as cotações registradas ou importadas, incluindo o histórico diário da média do RS lido automaticamente das páginas de histórico do Agrolink para soja, milho e trigo: média de cada mês ÷ média dos meses observados × 100; meses sem cotação ficam vazios e não entram em projeção) com leitura para os próximos 3 meses quando há dados e importação de histórico em linhas data;preço.
- **Armazenagem (operação)**: cadastro das unidades de recebimento (capacidade estática, secagem e recebimento por dia, metas por grão e período da safra), padrões de qualidade por grão editáveis (referência IN MAPA), leituras de estoque e qualidade por unidade e grão (quantidade, umidade, temperatura, impurezas, avariados, PH…), recebimentos diários com acompanhamento de meta (percentual, ritmo em t/dia, dias para a meta, risco), ocupação por unidade, gráficos de padrões por cereal (valor × limite), volumes por grão e unidade e recebimentos dos últimos 30 dias, alertas e exportação JSON.
- **Mercado agora (página inicial)**: card com atualização automática (a página consulta `/api/market` a cada 5 minutos e ao voltar para a aba; as fontes são lidas pelo servidor a cada `AUTO_FETCH_HOURS`, com botão "Ler fontes agora"): por grão, preço C.Vale (ou média da praça), variação do dia e de 7 dias, melhor concorrente, média da praça, Rio Grande, Paranaguá e base; indicadores lidos automaticamente (dólar comercial e Chicago soja, milho e trigo em US¢/bu, Notícias Agrícolas) e manchetes do dia.
- **Relatórios em PDF**: gerados no servidor sem dependências (A4, cabeçalho VAL-SOG, resumo em cartões, tabelas com quebra de página, totais e observações). Ofertas: volume, valor, preço médio ofertado e fechado, oferta × pedida, tabela por oferta, resumo por situação e por grão. Recebimentos: metas da safra por unidade e grão (ritmo, dias para a meta, risco), recebimentos do período, totais por unidade e grão. Pedidos e análises: tabela dos pedidos (referência, alvo, mercado × alvo, alvos 1/2/3, fechado) e uma página de análise por pedido (leitura de mercado, target de fechamento, cenários, C.Vale × concorrência, razões, estratégia, dicas, alertas e fechamentos), além do PDF individual de cada pedido pelo botão "PDF" na lista. Cotações e comparativo: comparativo de compradores por grão (última cotação de cada fonte nos últimos 7 dias, tipo, praça, R$/sc, diferença vs C.Vale, base contra porto), estatísticas do período por série (mínima, média, máxima, última, variação), padrão sazonal observado e a lista das cotações do período com origem (manual, automática, editada, histórico). Produtores e carteira: carteira por grão (fase da praça, produção estimada, fixado, em aberto, produtores abaixo do ritmo, referência), tabela de produtores (município, distância, lavouras, produção, fixado, ritmo, perfil de risco e hábito, armazenagem, pedidos/ofertas, pedida média) e uma ficha por produtor (perfil de decisão, posição da safra por grão com custo e ritmo, histórico de pedidas, pedidos e ofertas recentes, observações); a ficha individual sai pelo botão "Ficha em PDF" na ficha do produtor. Armazenagem e qualidade: unidades (capacidade, estoque, livre, ocupação, qualidade, recebido na safra, meta), estoque e qualidade por unidade e grão na última leitura (umidade, temperatura, impurezas, avariados, PH coloridos pelo padrão, idade da leitura), padrões por cereal com a média ponderada do estoque contra o limite e o ideal, padrões em vigor, alertas, evolução das últimas leituras com variação de temperatura e a lista das leituras do período. Botões "Exportar PDF" nas abas Produtores, Cotações, Pedidos, Ofertas e Armazenagem, com filtros de período, situação, produtor, unidade e grão, e o relatório geral que junta os dois.
- **Identidade visual**: marca VAL atual (V em pedra com folha verde, wordmark VAL e "Inteligência que gera valor"), menu lateral verde-escuro e paleta verde-folha/pedra em toda a interface.
- **Armazenagem (guia)**: guia de pós-colheita por cultura (recebimento, secagem, umidade e temperatura de armazenagem, pragas, riscos que viram desconto, relação com a venda) e regras gerais de aeração, termometria, pragas, expurgo e checklists.
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
| `ACCESS_CODE` | código de acesso **gerencial** (tudo, inclusive parâmetros e padrões); aceita vários separados por vírgula; alias `ACCESS_CODE_GERENCIAL` |
| `ACCESS_CODE_OPERADOR` | código do **operador de compra de grãos**: pedidos, produtores, cotações e ofertas; armazenagem e parâmetros só leitura |
| `SESSION_SECRET` | segredo que assina as sessões de usuário e senha; vazio gera um segredo persistido no volume |
| `ACCESS_CODE_ARMAZEM` | código do **encarregado de armazém**: unidades, padrões, estoque, qualidade e recebimentos; comercial só leitura (abas Pedidos, Produtores e Ofertas ficam ocultas) |
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

**Logins e senhas.** A página inicial pede usuário e senha. Os logins são criados no painel **Administração** (aba visível só para o nível gerencial): nome, usuário, senha (mínimo 8 caracteres, guardada com scrypt), nível e situação; dá para editar, redefinir senha, desativar, reativar e remover, com proteções (não rebaixar nem remover o próprio usuário; manter ao menos um gerencial ativo). Cada usuário pode trocar a própria senha pelo botão "senha" no cartão do rodapé do menu. A sessão é um token assinado (Authorization: Bearer) válido por 30 dias. O código de acesso da equipe (variáveis ACCESS_CODE*) continua funcionando pelo atalho "Entrar com código" e serve para o gerencial criar os primeiros usuários; sem nenhum código e sem usuários, o sistema fica aberto (só para teste local) até o primeiro usuário ser criado.

Todas as rotas de `/api/`, exceto `/api/session` e `/api/login`, exigem sessão (token de usuário) ou o cabeçalho `x-access-code` quando o sistema está protegido. O código identifica o nível (gerencial, operador ou armazém); `/api/session` devolve o nível, as abas liberadas e as áreas com escrita. Escrita fora do nível responde 403.

| Rota | Método | Nível com escrita | Uso |
|---|---|---|---|
| `/api/market` | GET | todos | mercado agora: preços por grão, variações, portos, base, indicadores e última leitura |
| `/api/login` | POST | público | usuário e senha (ou código) → sessão |
| `/api/reports/ofertas.pdf` | GET | todos | relatório de ofertas em PDF (filtros from, to, status, producerId, commodity) |
| `/api/reports/recebimentos.pdf` | GET | todos | relatório de recebimentos em PDF (from, to, unitId, commodity), com metas da safra |
| `/api/reports/pedidos.pdf` | GET | todos | pedidos e análises dos produtores (from, to, status, producerId, commodity; detail=0 só a tabela) |
| `/api/reports/pedido/:id.pdf` | GET | todos | análise personalizada de um pedido para entregar ao produtor |
| `/api/reports/cotacoes.pdf` | GET | todos | cotações e comparativo de preços (from, to, commodity; sem datas usa 30 dias) |
| `/api/reports/produtores.pdf` | GET | todos | produtores e carteira (producerId, commodity; detail=0 só carteira e tabela) |
| `/api/reports/produtor/:id.pdf` | GET | todos | ficha de um produtor (perfil, posição da safra, pedidas, pedidos e ofertas) |
| `/api/reports/armazenagem.pdf` | GET | todos | armazenagem e qualidade dos grãos (from, to para as leituras; unitId, commodity) |
| `/api/reports/geral.pdf` | GET | todos | cotações (compacto), carteira, pedidos, ofertas, recebimentos e armazenagem (compacto) em um único PDF |
| `/api/users` | GET, POST | gerencial | lista e cria logins |
| `/api/users/:id` | PUT, DELETE | gerencial | edita (nome, usuário, nível, situação, senha) ou remove |
| `/api/users/:id/password` | POST | gerencial | redefine a senha de um login |
| `/api/me/password` | POST | todos com usuário | troca a própria senha |
| `/api/storage/units` | POST | armazém, gerencial | cadastra unidade de recebimento (capacidade, secagem, recebimento/dia, metas por grão, safra) |
| `/api/storage/units/:id` | PUT, DELETE | armazém, gerencial | edita ou remove a unidade |
| `/api/storage/standards` | PUT | armazém, gerencial | ajusta os padrões por grão (umidade, temperatura, impurezas, avariados, PH…) |
| `/api/storage/readings` | POST | armazém, gerencial | leitura de estoque e qualidade por unidade e grão |
| `/api/storage/receipts` | POST | armazém, gerencial | recebimento (data, grão, toneladas, cargas, umidade, produtor) |
| `/api/storage/export` | GET | todos | unidades, leituras, recebimentos e padrões em JSON |

## Base técnica da praça

`data/praca-sao-luiz-gonzaga.json` reúne aliases dos municípios da área da Coopatrigo, compradores com confiança declarada, frete e base históricos, calendário por cultura, padrões de qualidade, dicas de fechamento e o briefing de mercado de 22–23/09/2026 com fontes. Cada valor tem data e fonte; itens com confiança baixa precisam de confirmação da equipe local. Quando os relatórios internos forem entregues, eles substituem as fontes públicas.

## Integração futura com outros sistemas

O Grãos Missões é independente: tem cadastro, dados, acesso e deploy próprios. Outro sistema (um CRM, por exemplo) pode consumir a análise sem depender da interface, chamando `POST /api/analyze` com o cabeçalho `x-access-code` e o corpo do pedido, ou lendo `GET /api/bootstrap` para listar pedidos, alvos atingidos e briefing. Um token dedicado por integração e a exportação de produtores por planilha entram quando essa integração for decidida.

## Limites deste esboço

- Armazenamento em arquivo JSON: adequado para uma equipe; para várias unidades, migrar para PostgreSQL.
- Código de acesso único: não há usuários individuais nem trilha por consultor.
- A leitura automática depende do layout das páginas dos concorrentes; quando um site muda, a fonte aparece como “sem preço” ou “falhou” e o registro volta a ser manual até o ajuste em `data/sources.json`.
- A análise é determinística e explicável; não usa modelo de linguagem e não prevê preço.
