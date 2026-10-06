import test from 'node:test'
import assert from 'node:assert/strict'
import {EphemeralIdentityStore,createSogIdentity} from '../identity/runtime.js'

test('OIDC states consumed once, tokens encrypted and independent from business storage',async()=>{
 const store=new EphemeralIdentityStore();await store.put('rp-state','nonce',{verifier:'synthetic-verifier'},300)
 assert.ok(!JSON.stringify([...store.records]).includes('synthetic-verifier'))
 const values=await Promise.all([store.take('rp-state','nonce'),store.take('rp-state','nonce')]);assert.equal(values.filter(Boolean).length,1)
 await store.put('rp-session','session',{value:0},300);await Promise.all([store.update('rp-session','session',async v=>({value:v.value+1})),store.update('rp-session','session',async v=>({value:v.value+1}))]);assert.equal((await store.get('rp-session','session')).value,2)
})
test('SOG mapping requires explicit subject, active local user, tenant and AAL2; no auto role grants',async()=>{
 const user={id:'local-1',role:'operador',active:true},store={read:()=>({users:[user]})}
 const identity=createSogIdentity({store,roles:{operador:{}},env:{VAL_IDENTITY_ENABLED:'true',VAL_IDENTITY_TENANT_ID:'tenant-1',VAL_IDENTITY_ISSUER:'https://val-web-staging-production.up.railway.app',VAL_SOG_ORIGIN:'https://web-production-704a3.up.railway.app',VAL_IDENTITY_LINKS_JSON:JSON.stringify([{subjectId:'central-1',userId:user.id}])}})
 const claims={sub:'central-1',tenant_id:'tenant-1',auth_level:'AAL2'}
 assert.equal((await identity.resolveAccount(claims)).role,'operador')
 for(const patch of [{sub:'other'},{tenant_id:'other'},{auth_level:'AAL1'}])assert.equal(await identity.resolveAccount({...claims,...patch}),null)
 user.active=false;assert.equal(await identity.resolveAccount(claims),null)
 assert.throws(()=>identity.guard({method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'}}),/cross_origin_write_denied/)
})
