import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,sep} from 'node:path'
import {generateKeyPair,exportJWK,SignJWT} from 'jose'
import {createStore} from '../lib/store.js'
import {ServiceIdentity} from '../identity/service-identity.js'
import {digest} from '../identity/primitives.js'
import {passwordSsoPolicy,PASSWORD_SSO} from '../identity/password-sso.js'

const scope='sog.integration.health',path='/api/identity/service/health'
test('selected password session may delegate scoped reads, never bridge writes or recent MFA',async()=>fixture(async f=>{
 const tenantId=PASSWORD_SSO.tenantId,actorId='selected',scope='sog.context.read',path='/api/integrations/val/context'
 const env={VAL_TEST_PASSWORD_SSO:'true',VAL_PASSWORD_SSO_SUBJECTS_JSON:JSON.stringify([{subjectId:actorId,roleRef:'technical_reviewer'}])}
 const policy=passwordSsoPolicy(env,{issuer:PASSWORD_SSO.issuer,tenantId,origin:'https://web-production-704a3.up.railway.app',clientId:'val-sog'})
 let proof={active:true,actorId,tenantId,sessionId:'central',authLevel:'AAL1',roleRef:'technical_reviewer',acr:PASSWORD_SSO.acr,amr:['pwd'],passwordOnlyPolicy:PASSWORD_SSO.policy,passwordAuthenticatedAt:Date.now(),mfaAuthenticatedAt:null}
 const verifier=new ServiceIdentity({...f.options,passwordSso:policy,services:f.services.map(s=>({...s,tenants:[tenantId],allowed_scopes:[scope,'sog.link.write']})),fetcher:async()=>new Response(JSON.stringify(proof))})
 const request={tenantId,scope,path,method:'GET',actorId,requireDelegation:true}
 const token=()=>f.sign({tenant_id:tenantId,scope,request_hash:digest('GET\n'+path+'\n'),delegated_sub:actorId,session_id:'central',act:{sub:'val-api'}})
 assert.equal((await verifier.verify(await token(),request)).delegated_sub,actorId)
 await assert.rejects(verifier.verify(await token(),{...request,recentMfa:true}),/service_auth_denied/)
 proof={...proof,roleRef:'admin'};await assert.rejects(verifier.verify(await token(),request),/service_auth_denied/)
 proof={...proof,roleRef:'technical_reviewer'};env.VAL_TEST_PASSWORD_SSO='false';await assert.rejects(verifier.verify(await token(),request),/service_auth_denied/)
}))
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'val-sog-service-'))
 const pairs=await Promise.all(['val-api-key','sog-api-key','oidc-only-key'].map(async kid=>{const pair=await generateKeyPair('ES256',{extractable:true});return {key:pair.privateKey,private:{...await exportJWK(pair.privateKey),kid},public:{...await exportJWK(pair.publicKey),kid}}}))
 const [central,sog,human]=pairs,store=createStore(root),issuer='https://central.example.test',sogIssuer='https://sog.example.test'
 let now=Date.now()
 const services=[{service_id:'val-api',status:'active',tenants:['tenant-a'],audiences:['val-sog'],allowed_scopes:[scope],key_ids:[central.public.kid],issuer},{service_id:'val-sog-api',status:'active',tenants:['tenant-a'],audiences:['val-web'],allowed_scopes:[scope],key_ids:[sog.public.kid],issuer:sogIssuer}]
 const options={store,issuer,audience:'val-sog',services,signingJwk:central.private,verificationJwks:{keys:pairs.map(p=>p.public)},clock:()=>now}
 const verifier=new ServiceIdentity(options),issue={serviceId:'val-api',tenantId:'tenant-a',scope,audience:'val-sog',method:'GET',path}
 const sign=async(patch={},header={},pair=central)=>new SignJWT({kind:'service',service_id:'val-api',tenant_id:'tenant-a',scope,request_hash:digest(['GET',path,''].join('\n')),iss:issuer,aud:'val-sog',sub:'val-api',jti:crypto.randomUUID(),iat:Math.floor(now/1000),exp:Math.floor(now/1000)+60,...patch}).setProtectedHeader({alg:'ES256',typ:'val-service+jwt',kid:pair.public.kid,...header}).sign(pair.key)
 const request={tenantId:'tenant-a',scope,method:'GET',path}
 try{await fn({root,store,central,sog,human,options,services,verifier,issue,sign,request,advance:ms=>{now+=ms},sogIssuer})}
 finally{if(!resolve(root).startsWith(resolve(tmpdir())+sep+'val-sog-service-'))throw Error('UNSAFE_FIXTURE_CLEANUP');await rm(root,{recursive:true,force:true})}
}
test('SOG machine identity persists only replay hashes and rejects one token across concurrent calls and process restart',async()=>fixture(async f=>{
 const token=await f.verifier.issue(f.issue)
 const result=await Promise.allSettled(Array.from({length:8},()=>f.verifier.verify(token,f.request)))
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1)
 const persisted=await readFile(f.store.file,'utf8');assert.ok(!persisted.includes(token));assert.ok(!persisted.includes(f.central.private.d));assert.ok(!persisted.includes('request_hash'))
 const ledger=JSON.parse(persisted).valServiceReplay;assert.equal(Object.keys(ledger.used).length,1);assert.ok(Object.keys(ledger.used).every(k=>/^[a-f0-9]{64}$/.test(k)))
 const restarted=new ServiceIdentity({...f.options,store:createStore(f.root)});await assert.rejects(restarted.verify(token,f.request),/service_auth_denied/)
}))
test('SOG machine identity binds the signing kid to the exact service and rejects human OIDC keys, missing key registry and duplicate services',async()=>fixture(async f=>{
 await assert.rejects(f.verifier.verify(await f.sign({}, {},f.sog),f.request),/service_auth_denied/)
 await assert.rejects(f.verifier.verify(await f.sign({}, {},f.human),f.request),/service_auth_denied/)
 const missing=new ServiceIdentity({...f.options,services:f.services.map(p=>({...p,key_ids:undefined}))});await assert.rejects(missing.verify(await f.sign(),f.request),/service_auth_denied/)
 const duplicate=new ServiceIdentity({...f.options,services:[...f.services,f.services[0]]});await assert.rejects(duplicate.verify(await f.sign(),f.request),/service_auth_denied/)
 for(const status of ['active','disabled']){const ambiguous=new ServiceIdentity({...f.options,services:[f.services[0],{...f.services[1],status,key_ids:[f.central.public.kid]}]});await assert.rejects(ambiguous.verify(await f.sign(),f.request),/service_auth_denied/);await assert.rejects(ambiguous.issue(f.issue),/service_key_ownership_denied/)}
 await assert.rejects(new ServiceIdentity({...f.options,signingJwk:f.sog.private}).issue(f.issue),/service_signing_key_denied/)
}))
test('SOG machine identity denies wrong issuer/audience, tenant, scope, request body/path and service/human type',async()=>fixture(async f=>{
 for(const patch of [{aud:'val-cred'},{iss:'https://evil.example'},{tenant_id:'tenant-b'},{scope:'cred.summary.read'},{service_id:'val-sog-api'},{kind:'human'},{request_hash:digest('POST\n'+path+'\n')}]){
  // Standard JWT setters below are intentionally avoided for the overridden claims.
  const now=Math.floor(f.options.clock()/1000)
  const token=await new SignJWT({kind:'service',service_id:'val-api',tenant_id:'tenant-a',scope,request_hash:digest(['GET',path,''].join('\n')),iss:f.options.issuer,aud:'val-sog',sub:'val-api',jti:crypto.randomUUID(),iat:now,exp:now+60,...patch}).setProtectedHeader({alg:'ES256',typ:'val-service+jwt',kid:f.central.public.kid}).sign(f.central.key)
  await assert.rejects(f.verifier.verify(token,f.request),/service_auth_denied/)
 }
 await assert.rejects(f.verifier.verify(await f.sign(),{...f.request,path:'/api/business'}),/service_auth_denied/)
 await assert.rejects(f.verifier.verify(await f.sign(),{...f.request,body:'changed'}),/service_auth_denied/)
 await assert.rejects(f.verifier.verify(await f.sign({}, {typ:'JWT'}),f.request),/service_auth_denied/)
}))
test('SOG machine identity limits lifetime to 60 seconds and fails closed on inactive service and nonpersistent or corrupt replay store',async()=>fixture(async f=>{
 await assert.rejects(f.verifier.verify(await f.sign({exp:Math.floor(f.options.clock()/1000)+61}),f.request),/service_auth_denied/)
 const expired=await f.sign();f.advance(61000);await assert.rejects(f.verifier.verify(expired,f.request),/service_auth_denied/)
 const inactive=new ServiceIdentity({...f.options,services:f.services.map(p=>({...p,status:'disabled'}))});await assert.rejects(inactive.verify(await f.sign(),f.request),/service_auth_denied/)
 const memory=new ServiceIdentity({...f.options,store:{read:()=>({}),update:()=>{}}});await assert.rejects(memory.verify(await f.sign(),f.request),/service_auth_denied/)
 await writeFile(f.store.file,'{corrupt');await assert.rejects(f.verifier.verify(await f.sign(),f.request),/service_auth_denied/)
}))
test('SOG issues its own identity to VAL using its dedicated key and exact per-service issuer',async()=>fixture(async f=>{
 const outbound=new ServiceIdentity({...f.options,signingJwk:f.sog.private,audience:'val-web'})
 const token=await outbound.issue({...f.issue,serviceId:'val-sog-api',audience:'val-web',path:'/api/security/service/health'})
 assert.equal((await outbound.verify(token,{...f.request,path:'/api/security/service/health'})).sub,'val-sog-api')
 await assert.rejects(outbound.issue({...f.issue,serviceId:'val-sog-api',audience:'val-web',actorId:'human',sessionId:'session'}),/service_delegation_not_supported/)
}))
