import {fault} from './primitives.js'

export const PASSWORD_SSO = Object.freeze({
 policy:'val.test-password-sso.v1', acr:'urn:val:aal1:password-only',
 issuer:'https://val-web-staging-production.up.railway.app',
 tenantId:'00000000-0000-4000-8000-000000000001'
})

// Explicit opt-in on both ends. This accepts a password assurance level; it
// never manufactures MFA or grants an application role from an identity token.
export function passwordSsoPolicy(env, {issuer,tenantId,origin,clientId}) {
 const enabled=env.VAL_TEST_PASSWORD_SSO==='true'
 let subjects=[]
 if(enabled){
  try {subjects=JSON.parse(env.VAL_PASSWORD_SSO_SUBJECTS_JSON)} catch {throw fault('password_sso_subjects_invalid',503)}
  const local=env.NODE_ENV==='test'&&env.VAL_IDENTITY_TEST==='true'&&/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(issuer)&&/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
  const expected=clientId==='val-sog'?'https://web-production-704a3.up.railway.app':clientId==='val-cred'?'https://dcredc149-production.up.railway.app':null
  if(!expected||tenantId!==PASSWORD_SSO.tenantId||!local&&(issuer!==PASSWORD_SSO.issuer||origin!==expected))throw fault('password_sso_scope_denied',503)
  if(!Array.isArray(subjects)||!subjects.length||subjects.length>20||subjects.some(s=>!s||typeof s.subjectId!=='string'||!s.subjectId||typeof s.roleRef!=='string'||!s.roleRef)||new Set(subjects.map(s=>s.subjectId)).size!==subjects.length)throw fault('password_sso_subjects_invalid',503)
 }
 function permits(claims){
  const now=Math.floor(Date.now()/1000)
  return enabled&&env.VAL_TEST_PASSWORD_SSO==='true'&&claims?.tenant_id===tenantId
   &&subjects.some(s=>s.subjectId===claims.sub&&s.roleRef===claims.role_ref)
   &&claims.auth_level==='AAL1'&&claims.password_only_policy===PASSWORD_SSO.policy
   &&claims.acr===PASSWORD_SSO.acr&&Array.isArray(claims.amr)&&claims.amr.length===1&&claims.amr[0]==='pwd'
   &&claims.mfa_authenticated_at===null&&Number.isInteger(claims.password_authenticated_at)
   &&claims.password_authenticated_at>0&&claims.password_authenticated_at<=now+5
   &&now-claims.password_authenticated_at<=43200
 }
 function permitsProof(proof){return permits({sub:proof?.actorId,tenant_id:proof?.tenantId,role_ref:proof?.roleRef,auth_level:proof?.authLevel,password_only_policy:proof?.passwordOnlyPolicy,password_authenticated_at:Number.isFinite(proof?.passwordAuthenticatedAt)?Math.floor(proof.passwordAuthenticatedAt/1000):NaN,mfa_authenticated_at:proof?.mfaAuthenticatedAt,acr:proof?.acr,amr:proof?.amr})}
 return {enabled,permits,permitsProof,acrValues:enabled?PASSWORD_SSO.acr+' urn:val:aal2':'urn:val:aal2'}
}
