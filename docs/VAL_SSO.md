# Acesso único VAL — aplicação SOG externa

Escopo corrigido pelo usuário em 06/10/2026: integrar a aplicação existente em https://web-production-704a3.up.railway.app e o DCRED em https://dcredc149-production.up.railway.app à entrada https://val-web-staging-production.up.railway.app/#acesso. Não criar substitutos para essas aplicações.

O cliente `val-sog` usa OIDC Code + PKCE, state e nonce, exige AAL2 e valida a sessão central em cada requisição. O cadastro do Authenticator e seu segredo pertencem somente à VAL. Cookies locais são HttpOnly/Secure/SameSite=Lax. Contas locais mantêm seus perfis e precisam de vínculo explícito. Não há associação por nome ou concessão automática de gerencial.

Configuração de ativação (sem valores secretos):

- VAL_IDENTITY_ENABLED=true
- VAL_IDENTITY_ISSUER=https://val-web-staging-production.up.railway.app
- VAL_SOG_ORIGIN=https://web-production-704a3.up.railway.app
- VAL_IDENTITY_TENANT_ID: tenant central aprovado
- VAL_IDENTITY_LINKS_JSON: lista de objetos com subjectId central e userId local aprovados
- Callback registrado na VAL: https://web-production-704a3.up.railway.app/auth/oidc/callback

Quando ativada, autenticação legada por senha/código de equipe não autoriza APIs. Sem vínculo, o acesso é negado. Não ativar sem preparar os vínculos dos usuários que devem continuar acessando o sistema. Não copiar contas sintéticas de staging para produção nem executar bootstrap de staging em produção.

Sessões e desafios são efêmeros, cifrados em memória e limitados a 10.000 registros. Reiniciar o processo encerra sessões locais; a sessão central permite novo SSO. Usar uma única réplica (estado atual do serviço); múltiplas réplicas requerem adapter transacional compartilhado antes de escalar. Tokens não são gravados no volume de dados comerciais. Logout local encerra a sessão SOG; logout global é feito na VAL.

Validação local: teste HTTP real entre runtime VAL e cliente SOG, com PostgreSQL sintético central, MFA prévio, PKCE, role local, CSRF e revogação global. Testes de consumo único, cifra e vínculo explícito no próprio repositório. Implantação e Authenticator físico ainda pendentes.
