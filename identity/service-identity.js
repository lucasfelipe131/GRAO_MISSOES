import {SignJWT,jwtVerify,importJWK,createLocalJWKSet,decodeJwt,decodeProtectedHeader} from 'jose'
import {readFileSync} from 'node:fs'
import {digest,fault} from './primitives.js'
import {identityJson} from './http-json.js'
import {randomUUID} from 'node:crypto'

export const SERVICE_SCOPES=Object.freeze(['sog.integration.health','sog.context.read','sog.link.write'])
const replayNamespace='valServiceReplay'
const maximumReplayEntries=10000

// Tokens and signing material never enter the business store. Only replay
// hashes, expiry and bounded authentication audit metadata are persisted.
export class ServiceIdentity {
 constructor({store,issuer,audience='val-sog',services,signingJwk,verificationJwks,clock=()=>Date.now(),fetcher=fetch,proofTimeoutMs=8000,passwordSso}){Object.assign(this,{store,issuer,audience,services,signingJwk,verificationJwks,clock,fetcher,proofTimeoutMs,passwordSso})}
 policy(id,tenantId,scope,audience){
  const matches=Array.isArray(this.services)?this.services.filter(s=>s.service_id===id):[]
  const p=matches.length===1&&matches[0]
  if(!p||p.status!=='active'||p.revoked_at||!Array.isArray(p.audiences)||!p.audiences.includes(audience)||!Array.isArray(p.tenants)||!p.tenants.includes(tenantId)||!Array.isArray(p.allowed_scopes)||!p.allowed_scopes.includes(scope)||!SERVICE_SCOPES.includes(scope)||!Array.isArray(p.key_ids)||!p.key_ids.length||p.key_ids.some(k=>typeof k!=='string'||!k||k.length>128)||new Set(p.key_ids).size!==p.key_ids.length)throw fault('service_scope_denied',401)
  if(this.services.some(other=>other.service_id!==id&&Array.isArray(other.key_ids)&&other.key_ids.some(k=>p.key_ids.includes(k))))throw fault('service_key_ownership_denied',401)
  return p
 }
 async issue({serviceId,tenantId,scope,audience,method,path,body='',actorId,sessionId}){
  const p=this.policy(serviceId,tenantId,scope,audience),key=this.signingJwk
  if(actorId||sessionId)throw fault('service_delegation_not_supported',401)
  if(!key||key.kty!=='EC'||key.crv!=='P-256'||!key.d||!p.key_ids.includes(key.kid))throw fault('service_signing_key_denied',401)
  const now=Math.floor(this.clock()/1000)
  return new SignJWT({kind:'service',service_id:serviceId,tenant_id:tenantId,scope,request_hash:digest(`${method}\n${path}\n${body}`)}).setProtectedHeader({typ:'val-service+jwt',alg:'ES256',kid:key.kid}).setIssuer(p.issuer||this.issuer).setAudience(audience).setSubject(serviceId).setJti(randomUUID()).setIssuedAt(now).setExpirationTime(now+60).sign(await importJWK(key,'ES256'))
 }
 readPersistent(){
  if(typeof this.store?.update!=='function'||typeof this.store?.read!=='function'||typeof this.store.file!=='string'||!this.store.file)throw fault('service_replay_store_required',503)
  const value=JSON.parse(readFileSync(this.store.file,'utf8'))
  const ledger=value?.[replayNamespace]
  if(!value||!Array.isArray(value.producers)||!Array.isArray(value.requests)||!Array.isArray(value.quotes)||ledger&&(ledger.version!==1||!ledger.used||typeof ledger.used!=='object'||Array.isArray(ledger.used)))throw fault('service_replay_store_invalid',503)
  return value
 }
 consume(p){
  this.readPersistent()
  const written=this.store.update(data=>{
   const latest=this.readPersistent()
   for(const key of Object.keys(data))delete data[key]
   Object.assign(data,latest)
   const existing=data[replayNamespace]
   if(existing&&(existing.version!==1||!existing.used||typeof existing.used!=='object'||Array.isArray(existing.used)))throw fault('service_replay_store_invalid',503)
   const used={...(existing?.used||{})},now=this.clock()
   for(const [key,expiry] of Object.entries(used)){if(!/^[a-f0-9]{64}$/.test(key)||!Number.isFinite(expiry))throw fault('service_replay_store_invalid',503);if(expiry<=now)delete used[key]}
   const hash=digest(p.iss+':'+p.jti)
   if(Object.hasOwn(used,hash))throw fault('service_replay_denied',401)
   if(Object.keys(used).length>=maximumReplayEntries)throw fault('service_replay_capacity',503)
   used[hash]=p.exp*1000
   data[replayNamespace]={version:1,used}
   data.valServiceAudit=[...(Array.isArray(data.valServiceAudit)?data.valServiceAudit:[]),{at:now,serviceId:p.sub,scope:p.scope,outcome:'success'}].slice(-200)
  })
  if(written&&typeof written.then==='function')throw fault('service_replay_store_required',503)
 }
 async verify(token,{tenantId,scope,method,path,body='',actorId,requireDelegation=false,recentMfa=false}){
  try{
   if(typeof token!=='string'||token.length>16384)throw fault('service_token_invalid',401)
   // Unverified metadata only selects a restrictive registry policy. It never
   // authorizes access before issuer, signature, audience and claims verify.
   const declared=decodeJwt(token),header=decodeProtectedHeader(token),p=this.policy(declared.sub,tenantId,scope,this.audience)
   if(header.typ!=='val-service+jwt'||header.alg!=='ES256'||!p.key_ids.includes(header.kid))throw fault('service_key_denied',401)
   const keys=this.verificationJwks?.keys?.filter(k=>k.kid===header.kid&&k.kty==='EC'&&k.crv==='P-256'&&!k.d)
   if(keys?.length!==1)throw fault('service_key_denied',401)
   const {payload:v}=await jwtVerify(token,createLocalJWKSet({keys}),{issuer:p.issuer||this.issuer,audience:this.audience,algorithms:['ES256'],typ:'val-service+jwt',maxTokenAge:60,clockTolerance:0,currentDate:new Date(this.clock()),requiredClaims:['sub','service_id','jti','iat','exp','tenant_id','scope','kind','request_hash']})
   if(v.sub!==p.service_id||v.service_id!==v.sub||v.kind!=='service'||v.tenant_id!==tenantId||v.scope!==scope||!Number.isInteger(v.exp)||!Number.isInteger(v.iat)||v.exp<=v.iat||v.exp-v.iat>60||v.iat>Math.floor(this.clock()/1000)||typeof v.jti!=='string'||!v.jti||v.jti.length>128||v.request_hash!==digest(`${method}\n${path}\n${body}`))throw fault('service_binding_denied',401)
   if(requireDelegation){
    if(typeof actorId!=='string'||!actorId||v.delegated_sub!==actorId||typeof v.session_id!=='string'||!v.session_id||v.session_id.length>180||!v.act||typeof v.act!=='object'||Array.isArray(v.act)||v.act.sub!==v.sub)throw fault('service_delegation_denied',401)
    const proof=await identityJson(this.fetcher,this.issuer+'/identity/service/validate',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({audience:this.audience,tenantId,scope,method,path,body})},{timeoutMs:this.proofTimeoutMs})
    if(proof.active!==true||proof.tenantId!==tenantId||proof.actorId!==actorId||proof.sessionId!==v.session_id||!((proof.authLevel==='AAL2'&&Number.isFinite(proof.mfaAuthenticatedAt)&&proof.mfaAuthenticatedAt>0&&proof.mfaAuthenticatedAt<=this.clock()+5000&&(!recentMfa||this.clock()-proof.mfaAuthenticatedAt<=300000))||(!recentMfa&&method==='GET'&&scope==='sog.context.read'&&this.passwordSso?.permitsProof(proof))))throw fault('central_delegation_denied',401)
   }else if(v.delegated_sub||v.session_id||v.act)throw fault('service_delegation_denied',401)
   this.consume(v)
   return v
  }catch{throw fault('service_auth_denied',401)}
 }
}
