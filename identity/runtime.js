import {FirstPartyClient} from './relying-party.js'
import {digest,seal,unseal,assertSameOrigin,fault} from './primitives.js'
import {randomBytes} from 'node:crypto'

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
export function createSogIdentity({store,roles,env=process.env}){
 if(env.VAL_IDENTITY_ENABLED!=='true')return {enabled:false}
 const tenantId=env.VAL_IDENTITY_TENANT_ID,issuer=env.VAL_IDENTITY_ISSUER
 const links=JSON.parse(env.VAL_IDENTITY_LINKS_JSON||'[]')
 if(!tenantId||!Array.isArray(links)||links.some(l=>!l.subjectId||!l.userId)||new Set(links.map(l=>l.subjectId)).size!==links.length)throw fault('identity_links_invalid',503)
 // Explicit central grants avoid creating a second login or local password.
 const access=JSON.parse(env.VAL_IDENTITY_ACCESS_JSON||'[]')
 if(!Array.isArray(access)||access.some(g=>typeof g.subjectId!=='string'||!g.subjectId||!Object.hasOwn(roles,g.role))||new Set(access.map(g=>g.subjectId)).size!==access.length||access.some(g=>links.some(l=>l.subjectId===g.subjectId)))throw fault('identity_access_invalid',503)
 const resolveAccount=async claims=>{
  if(claims.tenant_id!==tenantId||claims.auth_level!=='AAL2')return null
  const grant=access.find(g=>g.subjectId===claims.sub)
  if(grant){const id='val:'+digest(issuer+'\n'+tenantId+'\n'+claims.sub);const user={id,username:grant.username||'val-user',name:grant.name||'Conta VAL',role:grant.role,active:true,federated:true};return {id,role:user.role,user,via:'val-sso'}}
  const link=links.find(l=>l.subjectId===claims.sub),user=link&&(store.read().users||[]).find(u=>u.id===link.userId&&u.active!==false)
  return user&&Object.hasOwn(roles,user.role)?{id:user.id,role:user.role,user,via:'val-sso'}:null
 }
 const client=new FirstPartyClient({store:new EphemeralIdentityStore(),origin:env.VAL_SOG_ORIGIN,issuer,clientId:'val-sog',tenantId,resolveAccount,test:env.NODE_ENV==='test'&&env.VAL_IDENTITY_TEST==='true'})
 const redirect=(res,location,cookies)=>{res.writeHead(303,{Location:location,'Cache-Control':'no-store',...(cookies?{'Set-Cookie':cookies}:{})});res.end()}
 return {enabled:true,client,resolveAccount,async handle(req,res,url){
  if(url.pathname==='/auth/oidc/start'&&req.method==='GET'){const result=await client.start();redirect(res,result.url,result.cookie);return true}
  if(url.pathname==='/auth/oidc/callback'&&req.method==='GET'){const result=await client.callbackRequest(req);redirect(res,'/',[result.cookie,result.clearState]);return true}
  return false
 },async authenticate(req){return client.session(req)},guard(req){assertSameOrigin(req,client.origin)},async logout(req,res){assertSameOrigin(req,client.origin);res.setHeader('Set-Cookie',await client.logout(req))}}
}
