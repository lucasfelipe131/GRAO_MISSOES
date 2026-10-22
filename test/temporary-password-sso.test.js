import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {generateKeyPair,exportJWK,SignJWT} from 'jose'
import {FirstPartyClient} from '../identity/relying-party.js'
import {passwordSsoPolicy,PASSWORD_SSO} from '../identity/password-sso.js'
import {createSogIdentity} from '../identity/runtime.js'

const subject='integration-account',tenantId=PASSWORD_SSO.tenantId
const claims=()=>({sub:subject,tenant_id:tenantId,role_ref:'technical_reviewer',auth_level:'AAL1',session_id:'central-session',acr:PASSWORD_SSO.acr,amr:['pwd'],password_only_policy:PASSWORD_SSO.temporaryPolicy,password_authenticated_at:Math.floor(Date.now()/1000),mfa_authenticated_at:null})
const enabledEnv=()=>({NODE_ENV:'test',VAL_IDENTITY_TEST:'true',VAL_MFA_DISABLED:'true'})
const clientId='val-sog'

test('temporary password mode preserves explicit SOG grants and never converts the central role into a local role',async()=>{
 const env={...enabledEnv(),VAL_IDENTITY_ENABLED:'true',VAL_IDENTITY_ISSUER:PASSWORD_SSO.issuer,VAL_SOG_ORIGIN:'https://web-production-704a3.up.railway.app',VAL_IDENTITY_TENANT_ID:tenantId,VAL_IDENTITY_ACCESS_JSON:JSON.stringify([{subjectId:subject,role:'operador'}])}
 const identity=createSogIdentity({env,store:{read:()=>({users:[]})},roles:{operador:{},gerencial:{}}})
 assert.equal((await identity.resolveAccount({...claims(),role_ref:'admin'})).role,'operador')
 assert.equal(await identity.resolveAccount({...claims(),sub:'unlinked'}),null)
 assert.equal(await identity.canWriteLinks(subject),false)
 env.VAL_MFA_DISABLED='false';assert.equal(await identity.resolveAccount(claims()),null)
})
test('temporary mode accepts password assurance for every existing account and restores MFA when disabled',()=>{
 const env=enabledEnv(),p=passwordSsoPolicy(env,{issuer:'http://127.0.0.1',origin:'http://127.0.0.1',tenantId,clientId})
 assert.equal(p.permits(claims()),true)
 for(const patch of [{sub:''},{tenant_id:'other'},{role_ref:''},{password_only_policy:'other'},{acr:'urn:val:aal2'},{amr:['pwd','mfa']},{amr:[]},{mfa_authenticated_at:0},{password_authenticated_at:NaN},{password_authenticated_at:Math.floor(Date.now()/1000)+60},{password_authenticated_at:1}])assert.equal(p.permits({...claims(),...patch}),false)
 env.VAL_MFA_DISABLED='false';assert.equal(p.permits(claims()),false)
 assert.throws(()=>passwordSsoPolicy(enabledEnv(),{issuer:'https://foreign.example',origin:'https://foreign.example',tenantId,clientId}),/scope_denied/)
 assert.equal(p.withoutMfa({...claims(),sub:'second-account',role_ref:'admin'}),false);env.VAL_MFA_DISABLED='true';assert.equal(p.withoutMfa({...claims(),sub:'second-account',role_ref:'admin'}),true)
})

test('real password-only OIDC callback and live validation; role change, policy disable and logout invalidate local access',async()=>{
 const pair=await generateKeyPair('ES256',{extractable:true}),jwk={...await exportJWK(pair.publicKey),kid:'synthetic-password-key'}
 const records=new Map(),pending=new Map()
 const store={put:async(ns,id,v)=>records.set(ns+id,v),get:async(ns,id)=>records.get(ns+id),take:async(ns,id)=>{const v=records.get(ns+id);records.delete(ns+id);return v},remove:async(ns,id)=>records.delete(ns+id),update:async(ns,id,fn)=>{const v=await fn(records.get(ns+id));records.set(ns+id,v);return v}}
 let issuer,patch={},alive=true
 const json=(r,s,v)=>{r.writeHead(s,{'content-type':'application/json'});r.end(JSON.stringify(v))}
 const server=createServer(async(req,res)=>{
  try{
   if(req.url==='/.well-known/openid-configuration')return json(res,200,{issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['ES256'],token_endpoint_auth_methods_supported:['none']})
   if(req.url==='/jwks')return json(res,200,{keys:[jwk]})
   let raw='';for await(const c of req)raw+=c
   if(req.url==='/token'){
    const input=new URLSearchParams(raw),p=pending.get(input.get('code'));pending.delete(input.get('code'));assert.ok(p)
    assert.equal(input.get('client_id'),clientId)
    const now=Math.floor(Date.now()/1000),token=await new SignJWT({...claims(),...patch,nonce:p.nonce}).setProtectedHeader({alg:'ES256',kid:jwk.kid}).setIssuer(issuer).setAudience(clientId).setIssuedAt(now).setExpirationTime(now+300).sign(pair.privateKey)
    return json(res,200,{token_type:'Bearer',access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:300,id_token:token})
   }
   if(req.url==='/identity/validate')return json(res,alive?200:401,{active:alive,iss:issuer,aud:clientId,...claims(),...patch})
   return json(res,404,{})
  }catch{json(res,400,{error:'invalid_test_request'})}
 })
 await new Promise(r=>server.listen(0,'127.0.0.1',r));issuer='http://127.0.0.1:'+server.address().port
 const env=enabledEnv(),origin='http://127.0.0.1:65530',passwordSso=passwordSsoPolicy(env,{issuer,origin,tenantId,clientId})
 const client=new FirstPartyClient({store,issuer,origin,clientId,tenantId,test:true,passwordSso,resolveAccount:async c=>c.sub===subject?{id:'local-account',role:'viewer'}:null})
 async function login(stepUp=false){
  const start=await client.start({stepUp}),u=new URL(start.url),code=crypto.randomUUID()
  assert.equal(u.searchParams.get('acr_values'),PASSWORD_SSO.acr+' urn:val:aal2')
  pending.set(code,{nonce:u.searchParams.get('nonce')})
  return client.callbackRequest({url:'/auth/oidc/callback?'+new URLSearchParams({code,state:u.searchParams.get('state')}),headers:{cookie:start.cookie.split(';')[0]}})
 }
 try{
  const first=await login(),request={headers:{cookie:first.cookie.split(';')[0]}}
  assert.equal((await client.session(request)).role,'viewer')
  patch={tenant_id:'foreign'};assert.equal(await client.session(request),null);patch={}
  const second=await login(),next={headers:{cookie:second.cookie.split(';')[0]}}
  env.VAL_MFA_DISABLED='false';assert.equal(await client.session(next),null);env.VAL_MFA_DISABLED='true'
  const third=await login(),last={headers:{cookie:third.cookie.split(';')[0]}}
  alive=false;assert.equal(await client.session(last),null);alive=true
  assert.ok((await login(true)).cookie,'old step-up URLs no longer ask for an authenticator')
  patch={sub:'other'};await assert.rejects(login(),/application_account_not_linked/)
 }finally{await new Promise(r=>server.close(r))}
})
