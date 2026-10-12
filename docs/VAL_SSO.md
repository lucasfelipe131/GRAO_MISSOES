# Acesso único VAL — aplicação SOG externa

Escopo corrigido pelo usuário em 06/10/2026: integrar a aplicação existente em https://web-production-704a3.up.railway.app e o DCRED em https://dcredc149-production.up.railway.app à entrada https://val-web-staging-production.up.railway.app/#acesso. Não criar substitutos para essas aplicações.

O cliente `val-sog` usa OIDC Code + PKCE, state e nonce, exige AAL2 e valida a sessão central em cada requisição. O cadastro do Authenticator e seu segredo pertencem somente à VAL. Cookies locais são HttpOnly/Secure/SameSite=Lax. Acesso direto usa permissões explícitas para a identidade central, sem conta ou senha locais. Vínculos com contas locais continuam opcionais para instalações que já os utilizam. Não há associação por nome ou concessão automática de gerencial.

Configuração de ativação (sem valores secretos):

- VAL_IDENTITY_ENABLED=true
- VAL_IDENTITY_ISSUER=https://val-web-staging-production.up.railway.app
- VAL_SOG_ORIGIN=https://web-production-704a3.up.railway.app
- VAL_IDENTITY_TENANT_ID: tenant central aprovado
- VAL_IDENTITY_ACCESS_JSON: lista de objetos com subjectId central, role SOG e rótulos opcionais username/name. Não cria cadastro local.
- VAL_IDENTITY_LINKS_JSON: opcional, apenas para associação a contas locais preexistentes; não necessário no fluxo solicitado.
- Callback registrado na VAL: https://web-production-704a3.up.railway.app/auth/oidc/callback

Quando ativada, autenticação legada por senha/código de equipe não autoriza APIs. Sem vínculo, o acesso é negado. Não ativar sem preparar os vínculos dos usuários que devem continuar acessando o sistema. Não copiar contas sintéticas de staging para produção nem executar bootstrap de staging em produção.

Sessões e desafios são efêmeros, cifrados em memória e limitados a 10.000 registros. Reiniciar o processo encerra sessões locais; a sessão central permite novo SSO. Usar uma única réplica (estado atual do serviço); múltiplas réplicas requerem adapter transacional compartilhado antes de escalar. Tokens não são gravados no volume de dados comerciais. Logout local encerra a sessão SOG; logout global é feito na VAL.

Validação local: teste HTTP real entre runtime VAL e cliente SOG, com PostgreSQL sintético central, MFA prévio, PKCE, role local, CSRF e revogação global. Testes de consumo único, cifra e vínculo explícito no próprio repositório. Implantação e Authenticator físico ainda pendentes.

## Correção confirmada pelo usuário às 21:31 BRT

Usar somente a identidade central integration01@val.test, cujo login foi confirmado, sem exigir login prévio no SOG. Resolver o subjectId estável dessa conta antes da ativação; nunca autorizar por rótulo username/name ou inferir um ID. O perfil SOG deve ser explícito; o claim de administrador central não concede perfil gerencial automaticamente. Cadastro e senha locais não são criados. O e-mail não é um segredo TOTP. Implantação permanece pendente.

## Identidade de serviço VAL ↔ SOG

`identity/service-identity.js` emite e verifica JWT ES256 com chave de máquina independente da chave OIDC humana, `typ=val-service+jwt`, `kind=service`, `service_id=sub`, issuer explícito por serviço, audience, tenant, scope e hash de método/caminho/corpo. O único scope SOG nesta etapa é `sog.integration.health`. O JWT vence em até 60 segundos e cada jti só pode ser consumido uma vez.

`GET /api/identity/service/health` exige a identidade de máquina autorizada para audience `val-sog` e tenant configurado; retorna apenas o estado operacional, sem dados comerciais. Cookie humano, token OIDC, query string e requisição sem bearer não autorizam esse endpoint. O helper também emite a identidade `val-sog-api` para o endpoint VAL `GET /api/security/service/health`, audience `val-web`, usando a chave exclusiva SOG. Um token de serviço não cria sessão de usuário.

Configuração de confiança adicional, sem registrar valores secretos no repositório:

- `VAL_SERVICE_TRUST_JSON`: registros com `service_id`, `status=active`, `issuer`, `audiences`, `tenants`, `allowed_scopes` e `key_ids` explícitos. O issuer usa a origem central como fallback legado, mas key_ids nunca é inferido do JWKS.
- Cada kid pertence a exatamente um service_id em todo o registro, inclusive serviços desativados. Registro ausente, serviço duplicado ou chave compartilhada falha fechado. A troca de titularidade exige novo kid e revisão do registro.
- `VAL_SERVICE_VERIFICATION_JWKS`: somente chaves públicas EC/P-256 autorizadas. Verificação seleciona exatamente uma chave pública pelo kid já vinculado à política do serviço; uma chave OIDC ou de outro serviço não pode assumir essa identidade.
- `VAL_SERVICE_SIGNING_JWK`: chave privada exclusiva SOG, necessária apenas para emitir chamadas de saída; deve corresponder ao kid aprovado para `val-sog-api`. Não reutilizar material OIDC e não expor a chave ao navegador.

O consumo de jti usa o store persistente existente com atualização síncrona e substituição atômica do arquivo. Grava somente hashes de issuer+jti, vencimento e auditoria limitada de identidade/escopo; tokens e chaves não são persistidos no volume comercial. A leitura estrita do arquivo nega autenticação se o store estiver ausente, corrompido ou não oferecer atualização síncrona persistente. Concorrência no único processo e reinício conservam a negação de replay. Usar uma única réplica: múltiplos processos/réplicas exigem ledger transacional compartilhado antes de ativar. Após restaurar backup antigo do volume, bloquear chamadas de máquina por pelo menos 60 segundos ou preservar o ledger atual para impedir reuso de um token ainda válido.

Validação desta revisão: suíte SOG com 73 testes aprovados, incluindo concorrência, replay após reinício, vínculo exclusivo de chave, tenant/audience/issuer/escopo e expiração. Fixture HTTP com os runtimes reais VAL e SOG validou ambos os sentidos e a separação entre usuário e máquina. Isso não ativa o serviço Railway, não configura chaves reais e não substitui o UAT humano do Authenticator. O destino identificado é somente production; sua ativação permanece condicionada à autorização explícita desse ambiente e aos grants humanos exatos.
