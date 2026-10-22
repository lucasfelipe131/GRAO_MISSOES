import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdtemp,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {generateKeyPair,exportJWK,SignJWT} from 'jose'
import {randomBytes} from 'node:crypto'
import {createApp} from '../server.js'
import {createStore} from '../lib/store.js'
import {digest} from '../identity/primitives.js'
const reference='r'.repeat(43),producerRef='p'.repeat(43)
async function fixture(fn,{localLink=false}={}){
 const root=await mkdtemp(join(tmpdir(),'val-sog-oidc-')),store=createStore(root),codes=new Map(),contexts=new Map(),returns=new Map(),returnCalls=[]
 store.update(data=>{data.producers=[{id:'producer-a',name:'Synthetic Producer'}];data.valProducerLinks=[{tenantId:'tenant-a',ownerUserId:'owner-a',clientId:'client-a',producerId:'producer-a',confirmed:true,reason:'Confirmação humana do vínculo',verifiedAt:new Date().toISOString()}];if(localLink)data.users=[{id:'local-a',username:'synthetic',name:'Synthetic user',role:'operador',active:true}]})
 const pair=await generateKeyPair('ES256',{extractable:true}),jwk={...await exportJWK(pair.publicKey),kid:'human-oidc-key'}
 let issuer,alive=true,noncePatch=null,claimPatch={},contextPatch={},tokenGrants=0,validationCalls=0,accessToken='synthetic-access-token',returnPatch=null,returnStatus=200,clock=Date.now()
 const send=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))}
 const provider=createServer(async(req,res)=>{
  try{
   if(req.url==='/.well-known/openid-configuration')return send(res,200,{issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['ES256'],token_endpoint_auth_methods_supported:['none']})
   if(req.url==='/jwks')return send(res,200,{keys:[jwk]})
   if(req.url.startsWith('/?producer_ref=')){
    const ref=new URL(req.url,issuer).searchParams.get('producer_ref'),saved=returns.get(ref);returns.delete(ref)
    return send(res,saved&&saved.expiresAt>clock?200:403,{returned:Boolean(saved&&saved.expiresAt>clock)})
   }
   let raw='';for await(const part of req)raw+=part
   if(req.url==='/token'){
    const input=new URLSearchParams(raw)
    if(input.get('grant_type')==='refresh_token'){
     assert.equal(input.get('refresh_token'),'synthetic-refresh-token');accessToken='synthetic-refreshed-access-token'
     return send(res,200,{token_type:'Bearer',access_token:accessToken,refresh_token:'synthetic-rotated-refresh-token',expires_in:300})
    }
    const pending=codes.get(input.get('code'));codes.delete(input.get('code'));assert.ok(pending)
    assert.equal(input.get('grant_type'),'authorization_code');assert.equal(input.get('client_id'),'val-sog');assert.equal(input.get('redirect_uri'),pending.callback)
    assert.equal(Buffer.from(digest(input.get('code_verifier')),'hex').toString('base64url'),pending.challenge);tokenGrants++
    const now=Math.floor(Date.now()/1000)
    const idToken=await new SignJWT({tenant_id:'tenant-a',auth_level:'AAL2',session_id:'central-session-a',mfa_authenticated_at:Math.floor(Date.now()/1000),role_ref:'admin',nonce:noncePatch||pending.nonce,...claimPatch}).setProtectedHeader({alg:'ES256',kid:jwk.kid}).setIssuer(issuer).setAudience('val-sog').setSubject('owner-a').setIssuedAt(now).setExpirationTime(now+300).sign(pair.privateKey)
    return send(res,200,{token_type:'Bearer',access_token:'synthetic-access-token',refresh_token:'synthetic-refresh-token',expires_in:300,id_token:idToken})
   }
   if(req.url==='/identity/validate'){
    assert.equal(req.headers.authorization,'Bearer '+accessToken);assert.equal(JSON.parse(raw).client_id,'val-sog');validationCalls++
    return send(res,alive?200:401,{active:alive,iss:issuer,aud:'val-sog',sub:'owner-a',tenant_id:'tenant-a',session_id:'central-session-a',auth_level:'AAL2',mfa_authenticated_at:Math.floor(Date.now()/1000),role_ref:'admin',...claimPatch})
   }
   if(req.url==='/identity/context'){
    assert.equal(req.headers.authorization,'Bearer synthetic-access-token');const input=JSON.parse(raw);assert.equal(input.client_id,'val-sog');const context=contexts.get(input.context_ref);contexts.delete(input.context_ref)
    return send(res,context?200:403,context?{...context,...contextPatch}:{error:'denied'})
   }
   if(req.url==='/identity/return'){
    assert.equal(req.method,'POST');assert.equal(req.headers.authorization,'Bearer '+accessToken)
    const input=JSON.parse(raw);returnCalls.push({input,authorization:req.headers.authorization})
    assert.deepEqual(input,{client_id:'val-sog',val_client_id:'val-client-private-a'})
    if(returnStatus!==200)return send(res,returnStatus,{error:'producer_scope_denied'})
    const ref=randomBytes(32).toString('base64url');returns.set(ref,{expiresAt:clock+300000})
    return send(res,200,{returnUrl:returnPatch===null?issuer+'/?producer_ref='+ref:returnPatch})
   }
   send(res,404,{error:'missing'})
  }catch{send(res,400,{error:'synthetic-provider-denied'})}
 })
 await new Promise(r=>provider.listen(0,'127.0.0.1',r));issuer='http://127.0.0.1:'+provider.address().port
 const env={NODE_ENV:'test',VAL_IDENTITY_TEST:'true',VAL_IDENTITY_ENABLED:'true',VAL_IDENTITY_TENANT_ID:'tenant-a',VAL_IDENTITY_ISSUER:issuer+'/',VAL_SOG_ORIGIN:'http://127.0.0.1/',...(localLink?{VAL_IDENTITY_LINKS_JSON:JSON.stringify([{subjectId:'owner-a',userId:'local-a'}])}:{VAL_IDENTITY_ACCESS_JSON:JSON.stringify([{subjectId:'owner-a',role:'operador'}])})}
 const app=createApp({dataDir:root,seedHistory:false,accessCode:'legacy-code',identityOptions:{env}})
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.address().port
 app.identity.client.origin=origin;app.identity.client.callback=origin+'/auth/oidc/callback'
 const begin=async(extra='')=>{
  const response=await fetch(origin+'/auth/oidc/start'+extra,{redirect:'manual'});assert.equal(response.status,303)
  const url=new URL(response.headers.get('location')),code=crypto.randomUUID();assert.equal(url.origin,issuer);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('acr_values'),extra.includes('step_up=1')?'urn:val:aal2:recent':'urn:val:aal2')
  codes.set(code,{nonce:url.searchParams.get('nonce'),challenge:url.searchParams.get('code_challenge'),callback:url.searchParams.get('redirect_uri')})
  return {state:url.searchParams.get('state'),code,cookie:response.headers.getSetCookie()[0].split(';')[0],url}
 }
 const callback=async(start,patch={})=>fetch(origin+'/auth/oidc/callback?'+new URLSearchParams({code:start.code,state:start.state,...patch}),{headers:{cookie:start.cookie},redirect:'manual'})
 const rpCookie=response=>response.headers.getSetCookie().find(c=>c.startsWith('val_rp_val_sog=')).split(';')[0]
 try{await fn({root,store,app,issuer,origin,begin,callback,rpCookie,contexts,returns,returnCalls,advance:ms=>{clock+=ms},clock:()=>clock,patchReturn:value=>{returnPatch=value},denyReturn:status=>{returnStatus=status},live:value=>{alive=value},patchClaims:p=>{claimPatch=p},patchNonce:p=>{noncePatch=p},patchContext:p=>{contextPatch=p},counts:()=>({tokenGrants,validationCalls})})}
 finally{await new Promise(r=>app.close(r));await new Promise(r=>provider.close(r));if(!resolve(root).startsWith(resolve(tmpdir())+sep+'val-sog-oidc-'))throw Error('UNSAFE_FIXTURE_CLEANUP');await rm(root,{recursive:true,force:true})}
}
test('real OIDC round trip checks PKCE/state/nonce, projects only explicitly mapped SOG role and revokes on next central check',async()=>fixture(async f=>{
 const start=await f.begin(),response=await f.callback(start);assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/')
 assert.equal((await f.callback(start)).status,401)
 const cookie=f.rpCookie(response),session=await fetch(f.origin+'/api/session',{headers:{cookie}}).then(r=>r.json())
 assert.equal(session.authorized,true);assert.equal(session.role,'operador');assert.equal(session.identityEnabled,true);assert.ok(!session.write.includes('usuarios'));assert.equal(session.valReturnUrl,'/auth/oidc/return');assert.equal(session.manageAccessUrl,f.issuer+'/?security=1')
 assert.equal((await fetch(f.origin+'/api/bootstrap',{headers:{cookie}})).status,200)
 const disk=await readFile(f.store.file,'utf8');assert.ok(!disk.includes('synthetic-access-token'));assert.ok(!disk.includes('synthetic-refresh-token'));assert.ok(!disk.includes('val_rp_val_sog'))
 f.live(false);assert.equal((await fetch(f.origin+'/api/bootstrap',{headers:{cookie}})).status,401)
 assert.equal((await fetch(f.origin+'/api/session',{headers:{cookie}}).then(r=>r.json())).authorized,false)
 assert.ok(f.counts().validationCalls>=3)
}))
test('wrong state, browser cookie, nonce and AAL1 cannot establish a SOG browser session',async()=>fixture(async f=>{
 let start=await f.begin();assert.equal((await f.callback(start,{state:'wrong-state'})).status,401)
 assert.equal((await f.callback({...start,cookie:'val_oidc_state=wrong-browser'})).status,401)
 start=await f.begin();f.patchNonce('wrong-nonce');assert.equal((await f.callback(start)).status,400);f.patchNonce(null)
 start=await f.begin();f.patchClaims({auth_level:'AAL1'});assert.equal((await f.callback(start)).status,403)
 assert.equal([...f.app.identity.client.store.records.keys()].filter(k=>k.startsWith('rp-session:')).length,0)
}))
test('one-use producer handoff accepts the existing tenant-owner link and rechecks it after unlink',async()=>fixture(async f=>{
 f.contexts.set(reference,{producerId:'producer-a',linked:true,returnUrl:f.issuer+'/?producer_ref='+producerRef})
 const start=await f.begin('?context_ref='+reference),response=await f.callback(start);assert.equal(response.status,303)
 const cookie=f.rpCookie(response);let session=await fetch(f.origin+'/api/session',{headers:{cookie}}).then(r=>r.json())
 assert.equal(session.selectedProducerId,'producer-a');assert.equal(session.valReturnUrl,'/auth/oidc/return')
 assert.equal(f.contexts.has(reference),false)
 // Alter the real business file without touching the ephemeral identity vault.
 const data=JSON.parse(await readFile(f.store.file,'utf8'));data.valProducerLinks=[];await import('node:fs/promises').then(fs=>fs.writeFile(f.store.file,JSON.stringify(data)))
 session=await fetch(f.origin+'/api/session',{headers:{cookie}}).then(r=>r.json());assert.equal(session.selectedProducerId,null)
}))
test('foreign-owner producer and external return links reject handoff and discard the newly created local session',async()=>fixture(async f=>{
 for(const patch of [{producerId:'producer-other',linked:true},{returnUrl:'https://evil.example.test/'}]){
  f.contexts.set(reference,{producerId:'producer-a',linked:true,returnUrl:f.issuer+'/?producer_ref='+producerRef});f.patchContext(patch)
  const start=await f.begin('?context_ref='+reference),response=await f.callback(start);assert.equal(response.status,403)
  assert.equal(response.headers.getSetCookie().length,0)
  assert.equal([...f.app.identity.client.store.records.keys()].filter(k=>k.startsWith('rp-session:')).length,0)
 }
 f.contexts.set(reference,{producerId:'producer-a',linked:true,returnUrl:f.issuer+'/?producer_ref='+producerRef});f.patchContext({})
 const data=JSON.parse(await readFile(f.store.file,'utf8'));data.valProducerLinks[0].ownerUserId='another-owner';await import('node:fs/promises').then(fs=>fs.writeFile(f.store.file,JSON.stringify(data)))
 assert.equal((await f.callback(await f.begin('?context_ref='+reference))).status,403)
}))
test('local logout is same-origin, clears the SOG cookie and provides a signed-out page without central logout',async()=>fixture(async f=>{
 const response=await f.callback(await f.begin('?step_up=1'));assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/?identity_confirmed=1')
 const cookie=f.rpCookie(response)
 assert.equal((await fetch(f.origin+'/api/logout',{method:'POST',headers:{cookie,origin:'http://evil.example.test'}})).status,403)
 const logout=await fetch(f.origin+'/api/logout',{method:'POST',headers:{cookie,origin:f.origin}});assert.equal(logout.status,200);assert.equal((await logout.json()).logoutUrl,'/?signed_out=1')
 assert.match(logout.headers.getSetCookie()[0],/Max-Age=0/);assert.equal((await fetch(f.origin+'/api/session',{headers:{cookie}}).then(r=>r.json())).authorized,false)
 assert.equal((await fetch(f.origin+'/auth/oidc/start?context_ref=invalid',{redirect:'manual'})).status,403)
}))

const producerLogin=async(f,{legacy=false}={})=>{
 f.contexts.set(reference,{producerId:'producer-a',linked:true,returnUrl:f.issuer+'/?producer_ref='+producerRef,...(legacy?{}:{valClientId:'val-client-private-a'})})
 const response=await f.callback(await f.begin('?context_ref='+reference));assert.equal(response.status,303)
 return f.rpCookie(response)
}

test('return link mints a new reference only on each click after reload, ignores browser client IDs and keeps private context server-side',async()=>fixture(async f=>{
 const cookie=await producerLogin(f),headers={cookie}
 for(const path of ['/api/session','/api/bootstrap','/api/session']){
  const response=await fetch(f.origin+path,{headers}),payload=await response.json(),session=payload.session||payload
  assert.equal(session.valReturnUrl,'/auth/oidc/return')
  assert.ok(!JSON.stringify(payload).includes('valClientId'));assert.ok(!JSON.stringify(payload).includes('val-client-private-a'))
 }
 assert.equal(f.returnCalls.length,0)
 f.advance(301000);assert.equal((await fetch(f.issuer+'/?producer_ref='+producerRef)).status,403)
 const urls=[]
 for(let click=0;click<2;click++){
  const response=await fetch(f.origin+'/auth/oidc/return?clientId=foreign&val_client_id=foreign&returnUrl=https://evil.example.test/',{headers,redirect:'manual'})
  assert.equal(response.status,303);assert.equal(response.headers.get('cache-control'),'no-store')
  const url=new URL(response.headers.get('location'));assert.equal(url.origin,f.issuer);assert.equal(url.pathname,'/');assert.match(url.searchParams.get('producer_ref'),/^[A-Za-z0-9_-]{43}$/)
  assert.equal(f.returns.get(url.searchParams.get('producer_ref')).expiresAt-f.clock(),300000)
  urls.push(url.href)
 }
 assert.notEqual(urls[0],urls[1]);assert.equal(f.returnCalls.length,2)
 assert.equal((await fetch(urls[0])).status,200);assert.equal((await fetch(urls[0])).status,403)
 f.advance(300001);assert.equal((await fetch(urls[1])).status,403)
}))

test('return uses the latest access token after RP session refresh',async()=>fixture(async f=>{
 const cookie=await producerLogin(f),id=cookie.split('=')[1]
 await f.app.identity.client.store.update('rp-session',id,value=>({...value,accessExpiresAt:Date.now()-1}))
 const response=await fetch(f.origin+'/auth/oidc/return',{headers:{cookie},redirect:'manual'})
 assert.equal(response.status,303);assert.equal(f.returnCalls[0].authorization,'Bearer synthetic-refreshed-access-token')
 assert.ok(!response.headers.get('location').includes('synthetic-'))
}))

test('legacy sessions return safely home and cannot reuse a frozen reference or a browser supplied client ID',async()=>fixture(async f=>{
 const cookie=await producerLogin(f,{legacy:true}),id=cookie.split('=')[1]
 await f.app.identity.client.store.update('rp-session',id,value=>({...value,context:{...value.context,returnUrl:'https://evil.example.test/'}}))
 const response=await fetch(f.origin+'/auth/oidc/return?val_client_id=val-client-private-a',{headers:{cookie},redirect:'manual'})
 assert.equal(response.status,303);assert.equal(response.headers.get('location'),f.issuer+'/');assert.equal(f.returnCalls.length,0)
}))

test('return revalidates live subject and active local account before minting, and respects central owner or app denial',async()=>{
 await fixture(async f=>{
  const cookie=await producerLogin(f);f.live(false)
  assert.equal((await fetch(f.origin+'/auth/oidc/return',{headers:{cookie},redirect:'manual'})).status,401);assert.equal(f.returnCalls.length,0)
 })
 await fixture(async f=>{
  const cookie=await producerLogin(f);f.patchClaims({sub:'foreign-owner'})
  assert.equal((await fetch(f.origin+'/auth/oidc/return',{headers:{cookie},redirect:'manual'})).status,401);assert.equal(f.returnCalls.length,0)
 })
 await fixture(async f=>{
  const cookie=await producerLogin(f);f.store.update(data=>{data.users[0].active=false})
  assert.equal((await fetch(f.origin+'/auth/oidc/return',{headers:{cookie},redirect:'manual'})).status,401);assert.equal(f.returnCalls.length,0)
 },{localLink:true})
 await fixture(async f=>{
  const cookie=await producerLogin(f);f.denyReturn(403)
  const response=await fetch(f.origin+'/auth/oidc/return',{headers:{cookie},redirect:'manual'})
  assert.equal(response.status,403);assert.equal(response.headers.get('location'),null)
 })
})

test('return rejects malformed or foreign central redirects and never forwards a browser return URL',async()=>fixture(async f=>{
 const cookie=await producerLogin(f)
 for(const value of ['https://evil.example.test/?producer_ref='+producerRef,f.issuer+'/other?producer_ref='+producerRef,f.issuer+'/?producer_ref='+producerRef+'#fragment',f.issuer.replace('://','://user:password@')+'/?producer_ref='+producerRef,f.issuer+'/?producer_ref=short',f.issuer+'/?producer_ref='+producerRef+'&producer_ref='+producerRef,f.issuer+'/?producer_ref='+producerRef+'&next=https://evil.example.test/',f.issuer+'/',123,'not a URL']){
  f.patchReturn(value);const response=await fetch(f.origin+'/auth/oidc/return?returnUrl=https://evil.example.test/',{headers:{cookie},redirect:'manual'})
  assert.equal(response.status,403,String(value));assert.equal(response.headers.get('location'),null)
 }
}))

test('invalid private VAL client context is rejected at callback without creating a usable RP session',async()=>fixture(async f=>{
 for(const valClientId of [{id:'foreign'},'https://evil.example.test/','']){
  f.contexts.set(reference,{producerId:'producer-a',linked:true,returnUrl:f.issuer+'/?producer_ref='+producerRef,valClientId})
  assert.equal((await f.callback(await f.begin('?context_ref='+reference))).status,403)
  assert.equal([...f.app.identity.client.store.records.keys()].filter(k=>k.startsWith('rp-session:')).length,0)
 }
}))
