import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {generateKeyPair,exportJWK,SignJWT,decodeJwt} from 'jose'
import {createApp} from '../server.js'
import {createStore} from '../lib/store.js'
import {digest} from '../identity/primitives.js'
import {SERVICE_SCOPES} from '../identity/service-identity.js'

const health='/api/integrations/val/health',context='/api/integrations/val/context?ownerUserId=owner-a&clientId=client-a',link='/api/integrations/val/link',unlink='/api/integrations/val/unlink'
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'val-sog-unified-')),store=createStore(root)
 store.update(data=>{data.producers=[{id:'producer-a',name:'PRIVATE PRODUCER',phone:'PRIVATE PHONE',crops:{soja:{areaHa:10,yieldScHa:50}}},{id:'producer-b',name:'OTHER PRODUCER'}];data.requests=[];data.quotes=[];data.valProducerLinks=[{tenantId:'tenant-a',ownerUserId:'owner-a',clientId:'client-a',producerId:'producer-a',confirmed:true,reason:'Conferência humana anterior',verifiedAt:new Date().toISOString()}]})
 const pair=await generateKeyPair('ES256',{extractable:true}),jwk={...await exportJWK(pair.publicKey),kid:'central-api-key'}
 let proofPatch={},proofCalls=0,stalled=false
 const fetcher=async(url,options)=>{
  assert.equal(url,'https://central.example.test/identity/service/validate')
  assert.equal(options.redirect,'error');const input=JSON.parse(options.body),claims=decodeJwt(options.headers.authorization.slice(7));proofCalls++
  assert.equal(input.audience,'val-sog');assert.equal(input.tenantId,'tenant-a')
  assert.equal(claims.request_hash,digest(input.method+'\n'+input.path+'\n'+input.body))
  if(stalled)return new Response(new ReadableStream({start(){}}),{status:200})
  return Response.json({active:true,tenantId:'tenant-a',actorId:claims.delegated_sub,sessionId:claims.session_id,authLevel:'AAL2',mfaAuthenticatedAt:Date.now(),...proofPatch})
 }
 const env={VAL_IDENTITY_ENABLED:'true',VAL_IDENTITY_TENANT_ID:'tenant-a',VAL_IDENTITY_ISSUER:'https://central.example.test',VAL_SOG_ORIGIN:'https://sog.example.test',VAL_IDENTITY_ACCESS_JSON:JSON.stringify([{subjectId:'owner-a',role:'gerencial'},{subjectId:'operator-a',role:'operador'}]),VAL_SERVICE_TRUST_JSON:JSON.stringify([{service_id:'val-api',status:'active',tenants:['tenant-a'],audiences:['val-sog'],allowed_scopes:SERVICE_SCOPES,key_ids:[jwk.kid]}]),VAL_SERVICE_VERIFICATION_JWKS:JSON.stringify({keys:[jwk]})}
 const apps=[]
 async function app(){
  const server=createApp({dataDir:root,seedHistory:false,accessCode:'legacy-code',valBridge:{token:'legacy-service-token-that-is-at-least32',tenantId:'tenant-a'},identityOptions:{env,fetcher}})
  server.identity.serviceIdentity.proofTimeoutMs=40
  await new Promise(r=>server.listen(0,'127.0.0.1',r));apps.push(server);return {server,origin:'http://127.0.0.1:'+server.address().port}
 }
 const a=await app()
 const sign=async({path=context,method='GET',body='',scope=path===health?'sog.integration.health':method==='GET'?'sog.context.read':'sog.link.write',actor='owner-a',session='session-a',delegated=scope!=='sog.integration.health',patch={},header={}}={})=>{
  const now=Math.floor(Date.now()/1000)
  return new SignJWT({kind:'service',service_id:'val-api',tenant_id:'tenant-a',scope,request_hash:digest(method+'\n'+path+'\n'+body),iss:env.VAL_IDENTITY_ISSUER,aud:'val-sog',sub:'val-api',jti:crypto.randomUUID(),iat:now,exp:now+60,...(delegated?{delegated_sub:actor,session_id:session,act:{sub:'val-api'}}:{}),...patch}).setProtectedHeader({alg:'ES256',typ:'val-service+jwt',kid:jwk.kid,...header}).sign(pair.privateKey)
 }
 const call=async(path=context,{method='GET',body='',token,tenant='tenant-a',origin=a.origin,...signOptions}={})=>{
  token=token||await sign({path,method,body,...signOptions})
  const response=await fetch(origin+path,{method,headers:{authorization:'Bearer '+token,'x-val-tenant-id':tenant,...(body?{'content-type':'application/json'}:{})},...(body?{body}:{})})
  return {status:response.status,data:await response.json(),token}
 }
 try{await fn({root,store,a,app,sign,call,setProof:p=>{proofPatch=p},stall:()=>{stalled=true},proofCalls:()=>proofCalls})}
 finally{for(const app of apps)await new Promise(r=>app.close(r));if(!resolve(root).startsWith(resolve(tmpdir())+sep+'val-sog-unified-'))throw Error('UNSAFE_FIXTURE_CLEANUP');await rm(root,{recursive:true,force:true})}
}
test('corporate bridge uses its JWT identity exclusively and returns existing scoped data without producer PII',async()=>fixture(async f=>{
 assert.equal((await f.call(health)).status,200)
 assert.equal((await f.call(health,{token:'legacy-service-token-that-is-at-least32'})).status,401)
 const result=await f.call();assert.equal(result.status,200);assert.equal(result.data.status,'LINKED');assert.equal(result.data.producer.id,'producer-a')
 assert.ok(!JSON.stringify(result.data).includes('PRIVATE'));assert.ok(!JSON.stringify(result.data).includes('producer-b'))
 assert.equal((await f.call(context,{delegated:false})).status,401)
 assert.equal((await f.call(context,{actor:'owner-b'})).status,401)
 assert.equal((await f.call(context,{tenant:'tenant-b'})).status,403)
 assert.equal((await f.call(context+'&tenantId=tenant-b')).status,403)
 assert.equal((await fetch(f.a.origin+'/api/bootstrap',{headers:{'x-access-code':'legacy-code'}})).status,401)
 const s=await fetch(f.a.origin+'/api/session').then(r=>r.json());assert.equal(s.identityEnabled,true);assert.equal(s.authorized,false);assert.equal(s.loginUrl,'/auth/oidc/start')
 assert.equal((await fetch(f.a.origin+'/api/login',{method:'POST',headers:{origin:'https://sog.example.test','content-type':'application/json'},body:JSON.stringify({code:'legacy-code'})})).status,403)
}))
test('link changes require central live AAL2, recent MFA and explicit SOG manager mapping',async()=>fixture(async f=>{
 const body=JSON.stringify({ownerUserId:'owner-a',clientId:'client-b',producerId:'producer-b',confirmed:true,reason:'Vínculo confirmado pelo gerente'})
 let result=await f.call(link,{method:'POST',body});assert.equal(result.status,200);assert.equal(result.data.linked,true)
 result=await f.call(link,{method:'POST',body});assert.equal(result.data.duplicate,true)
 f.setProof({mfaAuthenticatedAt:Date.now()-301000})
 assert.equal((await f.call(context)).status,200)
 assert.equal((await f.call(unlink,{method:'POST',body:JSON.stringify({ownerUserId:'owner-a',clientId:'client-b',confirmed:true,reason:'Revogação confirmada pelo gerente'})})).status,401)
 f.setProof({active:false});assert.equal((await f.call(context)).status,401)
 f.setProof({authLevel:'AAL1'});assert.equal((await f.call(context)).status,401)
 f.setProof({sessionId:'different-session'});assert.equal((await f.call(context)).status,401)
 f.setProof({actorId:'another-owner'});assert.equal((await f.call(context)).status,401)
 f.setProof({})
 const operatorBody=JSON.stringify({ownerUserId:'operator-a',clientId:'client-c',producerId:'producer-a',confirmed:true,reason:'Não pode conceder papel gerencial'})
 assert.equal((await f.call(link,{method:'POST',body:operatorBody,actor:'operator-a'})).status,403)
 assert.equal((await f.call(link,{method:'POST',body:JSON.stringify({...JSON.parse(body),confirmed:false})})).status,422)
 assert.equal((await f.call(unlink,{method:'POST',body:JSON.stringify({ownerUserId:'owner-a',clientId:'client-b',confirmed:true,reason:'Revogação confirmada pelo gerente'})})).status,200)
}))
test('machine claims bind exact query/body/audience/key/type and replay is not consumed by invalid central proof',async()=>fixture(async f=>{
 const token=await f.sign()
 assert.equal((await f.call(context+'&unused=1',{token})).status,401)
 for(const patch of [{aud:'val-cred'},{iss:'https://wrong.example.test'},{tenant_id:'tenant-b'},{scope:'sog.integration.health'},{act:{sub:'other-service'}},{session_id:''}]){
  assert.equal((await f.call(context,{token:await f.sign({patch})})).status,401)
 }
 assert.equal((await f.call(context,{token:await f.sign({header:{typ:'JWT'}})})).status,401)
 const body=JSON.stringify({ownerUserId:'owner-a',clientId:'client-b',producerId:'producer-b',confirmed:true,reason:'Vínculo confirmado pelo gerente'})
 const mutation=await f.sign({path:link,method:'POST',body});assert.equal((await f.call(link,{method:'POST',body:body+' ',token:mutation})).status,401)
 f.setProof({active:false});assert.equal((await f.call(context,{token})).status,401)
 f.setProof({});assert.equal((await f.call(context,{token})).status,200);assert.equal((await f.call(context,{token})).status,401)
 const disk=await readFile(f.store.file,'utf8');assert.ok(!disk.includes(token));assert.ok(!disk.includes('request_hash'));assert.ok(!disk.includes('session-a'))
}))
test('independent app caches preserve producers, links and replay when delegated machine requests share the volume',async()=>fixture(async f=>{
 const b=await f.app(),body=JSON.stringify({ownerUserId:'owner-a',clientId:'client-b',producerId:'producer-b',confirmed:true,reason:'Vínculo confirmado pela segunda instância'})
 assert.equal((await f.call(link,{method:'POST',body,origin:b.origin})).status,200)
 const token=await f.sign();assert.equal((await f.call(context,{token})).status,200)
 const data=JSON.parse(await readFile(f.store.file,'utf8'));assert.equal(data.producers.length,2);assert.equal(data.valProducerLinks.length,2);assert.equal(data.valBridgeAudit.length,1);assert.equal(Object.keys(data.valServiceReplay.used).length,2)
 assert.equal((await f.call(context,{token,origin:b.origin})).status,401)
 await writeFile(f.store.file,'{corrupt');assert.equal((await f.call(context)).status,401);assert.equal(await readFile(f.store.file,'utf8'),'{corrupt')
}))
test('stalled central proof bodies expire and leave the replay ledger and business data untouched',async()=>fixture(async f=>{
 const before=await readFile(f.store.file,'utf8');f.stall();const started=Date.now()
 assert.equal((await f.call(context)).status,401);assert.ok(Date.now()-started<1500);assert.equal(await readFile(f.store.file,'utf8'),before)
}))
