# Acesso único VAL no SOG

Esta cópia deriva da fonte publicada `141e81097c0132208b56976942e2c416d33185e4`. Os arquivos de identidade foram lidos do commit `3d25b2d7cf9aa825cd6b8aecbff5a1136977473c` e integrados à ponte já publicada. Os arquivos de `reference/` são somente comparação e não fazem parte do delta de publicação.

Com `VAL_IDENTITY_ENABLED=true`, a entrada encaminha automaticamente para a VAL. PKCE S256, state de uso único, nonce e cookie HttpOnly do navegador protegem o retorno. O cadastro de contas e o segundo fator ficam na VAL; o papel SOG exige um vínculo/grant explícito ao subject central. Nenhum nome ou e-mail cria vínculo ou eleva acesso. As sessões e tokens humanos são cifrados apenas na memória; reiniciar o SOG exige entrar novamente pela sessão central. Cada chamada autenticada confere a sessão central ativa em AAL2.

`VAL_IDENTITY_ISSUER`, `VAL_IDENTITY_TENANT_ID`, `VAL_SOG_ORIGIN` e um dos registros explícitos `VAL_IDENTITY_ACCESS_JSON` / `VAL_IDENTITY_LINKS_JSON` precisam corresponder ao cliente OIDC val-sog cadastrado na VAL. A origem deve ser HTTPS e a callback exata é `/auth/oidc/callback`. As permissões SOG são gerencial, operador ou armazém conforme grant local. O origin deve corresponder ao domínio que o usuário abre.

A ponte mantém os endpoints e DTOs publicados em `/api/integrations/val/`. No modo corporativo, `VAL_BRIDGE_TOKEN` não autentica mais a ponte; `VAL_SERVICE_TRUST_JSON` e `VAL_SERVICE_VERIFICATION_JWKS` devem confiar somente na chave pública dedicada do serviço val-api. O registro permite audience val-sog, tenant exato e scopes:
- sog.integration.health: GET health, sem delegação humana.
- sog.context.read: GET context, owner igual actor do JWT e sessão central AAL2 ativa.
- sog.link.write: POST link/unlink, mesma sessão/owner, MFA nos últimos cinco minutos e grant SOG gerencial explícito.

Cada JWT de máquina dura no máximo 60 segundos, prende método, caminho com query e corpo bruto, e pode ser consumido uma única vez. A prova central POST `/identity/service/validate` usa o próprio JWT e confere conta/sessão antes do replay local. Apenas hashes de replay, expiração e auditoria mínima vão ao volume. Leitura e mutação falham fechado se o arquivo estiver corrompido. As gravações da ponte e do replay relêem o disco dentro da atualização síncrona e preservam produtores/vínculos/auditoria recentes de outra instância. O armazenamento de negócio continua sendo de réplica única.

O contexto de abertura usa a referência opaca central uma vez. O retorno confere tenant, owner e vínculo de produtor existente; não cria produtores nem operações financeiras. O botão sair do SOG remove só a sessão local e abre `?signed_out=1`, evitando a reentrada automática imediata. Gerenciar acesso e Voltar à VAL usam apenas a origem central validada; o encerramento global ocorre explicitamente na VAL.

Validação local: 25/25 testes focados passam, incluindo OIDC completo com provedor HTTP sintético, nonce/state/browser divergentes, AAL1 negada, handoff cruzado negado, revogação central, logout com origem, três scopes reais da ponte, MFA recente, papel independente, adulteração de query/corpo e replay com duas instâncias. A suíte completa passou 91/92; a única falha herdada é `test/api.test.js:75` (Cotrisal esperado 143, fonte local atual 136), também reproduzida no baseline antes desta integração. Nenhum serviço ou dado real foi alterado por estes testes.
