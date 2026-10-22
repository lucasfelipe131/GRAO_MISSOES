import {passwordSsoPolicy} from './password-sso.js'
import {FirstPartyClient} from './relying-party.js'
import {digest,seal,unseal,assertSameOrigin,fault,cookieValue,canonicalOrigin} from './primitives.js'
import {randomBytes} from 'node:crypto'
import {ServiceIdentity} from './service-identity.js'
import {identityJson} from './http-json.js'
import {readFileSync} from 'node:fs'

// Single-replica, ephemeral sessions. Restart requires central SSO again.
// Neither tokens nor PKCE verifiers are written into the business data volume.
export class EphemeralIdentityStore {
 constructor(){this.records=new Map();this.locks=new Map();this.key=randomBytes(32).toString('hex')}
 keyFor(ns,id){return ns+':'+digest(id)}
 async put(ns,id,value,seconds){const key=this.keyFor(ns,id);for(const [k,r] of this.records)if(r.expires<=Date.now())this.records.delete(k);if(!this.records.has(key)&&this.records.size>=10000)throw fault('identity_capacity',503);this.records.set(key,{payload:seal(value,this.key,key),expires:Date.now()+seconds*1000})}
 async get(ns,id){const key=this.keyFor(ns,id),r=this.records.get(key);if(!r||r.expires<=Date.now()){this.records.delete(key);return undefined}return unseal(r.payload,this.key,key)}
 async take(ns,id){const key=this.keyFor(ns,id),record=this.records.get(key);this.records.delete(key);if(!record||record.expires<=Date.now())return undefined;return unseal(record.payload,this.key,key)}
 async remove(ns,id){this.records.delete(this.keyFor(ns,id))}
 async update(ns,id,fn){const key=this.keyFor(ns,id),prior=this.locks.get(key)||Promise.resolve();const work=prior.catch(()=>{}).then(async()=>{const value=await this.get(ns,id),record=this.records.get(key);if(!value)throw fault('security_record_expired',401);const next=await fn(value);if(next&&this.records.get(key)===record)await this.put(ns,id,next,Math.max(0,(record.expires-Date.now())/1000));return next});this.locks.set(key,work);try{return await work}finally{if(this.locks.get(key)===work)this.locks.delete(key)}}
}
export function createSogIdentity({store,roles,env=process.env,fetcher=fetch}){
 if(env.VAL_IDENTITY_ENABLED!=='true')return {enabled:false}
 const tenantId=env.VAL_IDENTITY_TENANT_ID,issuer=canonicalOrigin(env.VAL_IDENTITY_ISSUER,{test:env.NODE_ENV==='test'&&env.VAL_IDENTITY_TEST==='true'})
 const passwordSso=passwordSsoPolicy(env,{issuer,tenantId,origin:canonicalOrigin(env.VAL_SOG_ORIGIN,{test:env.NODE_ENV==='test'&&env.VAL_IDENTITY_TEST==='true'}),clientId:'val-sog'})
 const links=JSON.parse(env.VAL_IDENTITY_LINKS_JSON||'[]')
 if(!tenantId||!Array.isArray(links)||links.some(l=>!l.subjectId||!l.userId)||new Set(links.map(l=>l.subjectId)).size!==links.length)throw fault('identity_links_invalid',503)
 // Explicit central grants avoid creating a second login or local password.
 const existingAccess=JSON.parse(env.VAL_IDENTITY_ACCESS_JSON||'[]'),additionalAccess=JSON.parse(env.VAL_UNIFIED_ACCESS_JSON||'[]')
 if(!Array.isArray(existingAccess)||!Array.isArray(additionalAccess))throw fault('identity_access_invalid',503)
 if(additionalAccess.some(g=>existingAccess.some(old=>old.subjectId===g?.subjectId&&old.role!==g?.role)))throw fault('identity_access_conflict',503)
 const access=[...existingAccess,...additionalAccess.filter(g=>!existingAccess.some(old=>old.subjectId===g?.subjectId))]
 if(!Array.isArray(access)||access.some(g=>typeof g.subjectId!=='string'||!g.subjectId||!Object.hasOwn(roles,g.role))||new Set(access.map(g=>g.subjectId)).size!==access.length||access.some(g=>links.some(l=>l.subjectId===g.subjectId)))throw fault('identity_access_invalid',503)
 const resolveAccount=async claims=>{
  if(claims.tenant_id!==tenantId||!(claims.auth_level==='AAL2'||passwordSso.permits(claims)))return null
  const grant=access.find(g=>g.subjectId===claims.sub)
  if(grant){const id='val:'+digest(issuer+'\n'+tenantId+'\n'+claims.sub);const user={id,username:grant.username||'val-user',name:grant.name||'Conta VAL',role:grant.role,active:true,federated:true};return {id,role:user.role,user,via:'val-sso'}}
  const link=links.find(l=>l.subjectId===claims.sub),data=link?(store.file?JSON.parse(readFileSync(store.file,'utf8')):store.read()):null,user=link&&(data.users||[]).find(u=>u.id===link.userId&&u.active!==false)
  return user&&Object.hasOwn(roles,user.role)?{id:user.id,role:user.role,user,via:'val-sso'}:null
 }
 const client=new FirstPartyClient({store:new EphemeralIdentityStore(),origin:env.VAL_SOG_ORIGIN,issuer,clientId:'val-sog',tenantId,resolveAccount,passwordSso,fetcher,test:env.NODE_ENV==='test'&&env.VAL_IDENTITY_TEST==='true'})
 const serviceIdentity=env.VAL_SERVICE_TRUST_JSON&&env.VAL_SERVICE_VERIFICATION_JWKS?new ServiceIdentity({store,issuer,fetcher,passwordSso,audience:'val-sog',services:JSON.parse(env.VAL_SERVICE_TRUST_JSON),signingJwk:env.VAL_SERVICE_SIGNING_JWK?JSON.parse(env.VAL_SERVICE_SIGNING_JWK):undefined,verificationJwks:JSON.parse(env.VAL_SERVICE_VERIFICATION_JWKS)}):null
 const redirect=(res,location,cookies)=>{res.writeHead(303,{Location:location,'Cache-Control':'no-store',...(cookies?{'Set-Cookie':cookies}:{})});res.end()}
 const scopedProducer=(producerId,subjectId)=>{
  const data=JSON.parse(readFileSync(store.file,'utf8'))
  if(!Array.isArray(data.producers)||!Array.isArray(data.valProducerLinks))throw fault('producer_scope_denied')
  const matches=data.valProducerLinks.filter(l=>l.tenantId===tenantId&&l.ownerUserId===subjectId&&l.producerId===producerId&&l.confirmed===true)
  if(matches.length!==1||!data.producers.some(p=>p.id===producerId))throw fault('producer_scope_denied')
  return producerId
 }
 const minimalContext=(context,subjectId)=>{
  if(!context||typeof context.linked!=='boolean'||context.linked!==(context.producerId!=null)||typeof context.returnUrl!=='string')throw fault('context_handoff_denied')
  const back=new URL(context.returnUrl)
  if(back.origin!==client.issuer||back.username||back.password||back.pathname!=='/'||back.hash||[...back.searchParams.keys()].some(k=>k!=='producer_ref')||back.searchParams.has('producer_ref')&&!/^[A-Za-z0-9_-]{43}$/.test(back.searchParams.get('producer_ref')))throw fault('return_origin_denied')
  if(context.producerId!==null&&(typeof context.producerId!=='string'||!/^[a-zA-Z0-9:_-]{1,180}$/.test(context.producerId)))throw fault('producer_scope_denied')
  return {linked:context.linked,producerId:context.producerId===null?null:scopedProducer(context.producerId,subjectId),returnUrl:back.href}
 }
 return {enabled:true,tenantId,client,serviceIdentity,resolveAccount,async canWriteLinks(subjectId){return (await resolveAccount({sub:subjectId,tenant_id:tenantId,auth_level:'AAL2'}))?.role==='gerencial'},async handle(req,res,url){
  if(url.pathname==='/api/identity/service/health'){
   if(req.method!=='GET')throw fault('method_not_allowed',405)
   if(url.search)throw fault('service_request_denied',401)
   const token=String(req.headers.authorization||'').match(/^Bearer (.+)$/)?.[1]
   if(!serviceIdentity||!token)throw fault('service_auth_denied',401)
   await serviceIdentity.verify(token,{tenantId,scope:'sog.integration.health',method:'GET',path:url.pathname})
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({status:'ok',service:'val-sog',identity:'service'}));return true
  }
  if(url.pathname==='/auth/oidc/start'&&req.method==='GET'){
   const contextRef=url.searchParams.get('context_ref')
   if(contextRef&&!/^[A-Za-z0-9_-]{43}$/.test(contextRef))throw fault('context_invalid')
   const stepUp=url.searchParams.get('step_up')==='1'
   const result=await client.start({contextRef,stepUp,returnTo:stepUp?'/?identity_confirmed=1':'/'})
   redirect(res,result.url,result.cookie);return true
  }
  if(url.pathname==='/auth/oidc/callback'&&req.method==='GET'){
   const result=await client.callbackRequest(req)
   try{
    const session=await client.store.get('rp-session',result.sessionId)
    if(!session)throw fault('context_handoff_denied')
    let context={producerId:null,linked:false,returnUrl:client.issuer+'/'}
    if(result.contextRef)context=minimalContext(await identityJson(fetcher,client.issuer+'/identity/context',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.tokens.access_token},body:JSON.stringify({client_id:'val-sog',context_ref:result.contextRef})}),session.userId)
    await client.store.update('rp-session',result.sessionId,value=>({...value,context}))
    redirect(res,result.returnTo,[result.cookie,result.clearState]);return true
   }catch(error){await client.store.remove('rp-session',result.sessionId);throw error}
  }
  return false
 },async authenticate(req){
  const account=await client.session(req)
  if(account?.context?.producerId){
   try{scopedProducer(account.context.producerId,account.identity.sub)}catch{account.context={...account.context,linked:false,producerId:null}}
  }
  return account
 },guard(req){assertSameOrigin(req,client.origin)},async logout(req,res){assertSameOrigin(req,client.origin);res.setHeader('Set-Cookie',await client.logout(req))}}
}
