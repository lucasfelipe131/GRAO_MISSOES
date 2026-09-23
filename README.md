# Grãos Missões

Sistema de oportunidades de grãos para a praça de São Luiz Gonzaga/RS. Cada pedido do produtor ("quero vender 3 mil sacas até março, preciso de caixa em outubro") vira uma análise personalizada: leitura de mercado, base contra porto, margem sobre custo, três alvos de fechamento escalonados por objetivo, cenários e dicas explicáveis.

Nada é executado automaticamente e nenhuma cotação é inventada. A comparação de preço usa apenas cotações registradas com fonte e horário. A decisão permanece com o consultor e o produtor.

## O que o sistema faz

- **Produtores**: cadastro com município, local usual de entrega, armazenagem, logística e custo de produção por grão.
- **Cotações**: registro com grão, preço, praça ou comprador, fonte, prazo de pagamento e horário de observação. Cotações com mais de 7 dias ficam marcadas como vencidas.
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
| `/api/quotes/:id` | DELETE | desativa cotação |
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
- Cotações são registradas manualmente; um conector para Coopatrigo, Cotrisal e CEPEA é o próximo passo.
- A análise é determinística e explicável; não usa modelo de linguagem e não prevê preço.
