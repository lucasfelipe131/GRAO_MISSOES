# Ponte da aplicação VAL SOG para o ecossistema VAL

Este delta parte do commit publicado `e1904c3b95193e02a2e3ce7ff3a8df10e833244e` do repositório `lucasfelipe131/GRAO_MISSOES`. Os 38 arquivos do baseline foram conferidos contra os hashes Git blob remotos antes da edição. O patch de identidade pendente no Railway não faz parte desta mudança.

As quatro rotas novas usam `Authorization: Bearer <VAL_BRIDGE_TOKEN>` e `x-val-tenant-id: <VAL_BRIDGE_TENANT_ID>`. O token deve ter pelo menos 32 caracteres; configuração ausente ou tenant diferente nega acesso. O token é exclusivo de serviço e não autentica a API comercial, usuários ou relatórios. O login comercial existente permanece intacto.

- `GET /api/integrations/val/health`: contrato `val.sog.connection.v1`, ponte `val.sog.v1`, origem `val-sog`, tenant e data da conferência. Não lista produtores.
- `GET /api/integrations/val/context?ownerUserId=...&clientId=...`: devolve `NOT_LINKED` ou `LINKED` para aquele vínculo. O conteúdo inclui somente ID do produtor, perfil de grãos, posições, até 100 pedidos normalizados e até 40 cotações das culturas do produtor. A resposta declara quantos registros existem, quantos foram devolvidos e se a cobertura é completa. Registros inválidos são excluídos e contados; posições desconhecidas permanecem nulas.
- `POST /api/integrations/val/link`: corpo `{ownerUserId,clientId,producerId,confirmed:true,reason}`. O motivo precisa ter de 10 a 500 caracteres. O ID é conferido contra o cadastro SOG. O mesmo vínculo é idempotente; outro produtor para o cliente ou outro cliente da mesma carteira para o produtor resulta em 409. Trocas exigem revogação explícita.
- `POST /api/integrations/val/unlink`: corpo `{ownerUserId,clientId,confirmed:true,reason}`. Revoga somente o vínculo daquela carteira e cliente; os registros comerciais permanecem.

As respostas de mutação ecoam contrato, tenant, carteira e cliente para o consumidor conferir o escopo. A configuração fixa o tenant; query/body não podem trocá-lo. Links e revogações têm auditoria limitada a 1.000 eventos. Token não é persistido no store comercial. O ledger fica em `valProducerLinks` no store já existente e persiste após reinício. Cada mutação relê e valida o arquivo depois do corpo HTTP, dentro da atualização síncrona, preservando o estado mais recente mesmo com caches de instâncias diferentes no mesmo processo. Store corrompido ou vínculos ambíguos negam leitura e escrita da ponte; a implantação suporta a réplica única atual, sem garantia de concorrência entre processos.

O cadastro SOG publicado não contém CPF/CNPJ. O vínculo exige conferência humana explícita do ID da origem e registra essa forma de verificação; não declara uma verificação documental. Nome, contato, notas, compradores, localização pessoal e documentos não entram no contexto. Cotações são dados compartilhados de mercado, limitadas às culturas do produtor e com documentos mascarados em texto livre.

Pedidos de compra e venda mantêm sua direção original. Um pedido aberto aparece como `monitoring` com `sourceStatus:open`; não vira venda confirmada. Volumes fechados são lidos dos registros de fechamento já existentes. A ponte não registra operações financeiras, aprova crédito ou envia dados automaticamente ao VAL Cred. Um contexto parcial não deve ser apresentado como total global.

As aplicações abrem separadamente. O SOG mantém `frame-ancestors 'none'`; o ecossistema deve usar link em nova aba com `noopener noreferrer`, sem incorporar a aplicação em iframe.

Validação local: 7 testes novos de HTTP, autenticação, isolamento por escopo, idempotência, revogação, persistência, caches compartilhando um arquivo, corrupção durante recebimento do corpo, privacidade e cobertura passaram. Na verificação anterior da suíte completa, 70 de 71 testes passaram. A única falha, anterior ao delta, é o teste Cotrisal que espera 143 e lê 136; foi reproduzida no servidor exato do baseline. Não houve implantação, vínculo real ou alteração de serviço Railway.
