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
