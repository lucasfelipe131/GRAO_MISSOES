import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {request as httpRequest} from 'node:http'
import {createApp} from '../server.js'
import {buildSogContext} from '../lib/val-bridge.js'

const token='synthetic-token-only-for-bridge-test-123456'
const tenantId='tenant-test',ownerUserId='owner-a',clientId='client-a'
async function start(options={}){
 const dataDir=options.dataDir||mkdtempSync(join(tmpdir(),'gm-val-bridge-'))
 const server=createApp({dataDir,accessCode:'local-test-code',seedHistory:false,valBridge:{token,tenantId},...options})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const request=async(path,{method='GET',payload,auth=true,tenant=tenantId,headers={}}={})=>{
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token}`,'x-val-tenant-id':tenant}:{}),...headers},body:payload===undefined?undefined:JSON.stringify(payload)})
  return {status:response.status,data:await response.json()}
 }
 const local=(path,payload)=>request(path,{method:'POST',payload,auth:false,headers:{'x-access-code':'local-test-code'}})
 return {server,dataDir,base,request,local}
}
const scoped=(client=clientId,owner=ownerUserId)=>`/api/integrations/val/context?ownerUserId=${owner}&clientId=${client}`
const link=(producerId,overrides={})=>({ownerUserId,clientId,producerId,confirmed:true,reason:'Conferência humana do ID no cadastro de origem.',...overrides})

test('credencial de serviço e tenant são obrigatórios; login comercial e HMAC não abrem ponte',async t=>{
 const {server,request}=await start();t.after(()=>server.close())
 assert.equal((await request('/api/integrations/val/health',{auth:false})).status,401)
 assert.equal((await request('/api/integrations/val/health',{auth:false,headers:{'x-access-code':'local-test-code'}})).status,401)
 assert.equal((await request('/api/integrations/val/health',{auth:false,headers:{'X-Valor-Signature':'sha256='+ 'a'.repeat(64)}})).status,401)
 assert.equal((await request('/api/integrations/val/health',{headers:{Authorization:'Bearer wrong-token'}})).status,401)
 assert.equal((await request('/api/integrations/val/health',{tenant:'another-tenant'})).status,403)
 const health=await request('/api/integrations/val/health')
 assert.equal(health.status,200);assert.equal(health.data.contract,'val.sog.connection.v1');assert.equal(health.data.bridgeContract,'val.sog.v1');assert.equal(health.data.tenantId,tenantId);assert.ok(Number.isFinite(Date.parse(health.data.checkedAt)))
 assert.equal((await request('/api/integrations/val/health',{method:'POST',payload:{}})).status,405)
 assert.equal((await request('/api/bootstrap')).status,401)
 assert.equal((await request('/api/integrations/val/outbox')).status,401)
})

test('vínculo explícito, idempotência, unicidade por carteira e leitura sem cruzar clientes',async t=>{
 const {server,dataDir,request,local}=await start();t.after(()=>server.close())
 const p=(await local('/api/producers',{name:'Produtor A CPF 123.456.789-00',phone:'private-phone',notes:'private-note',area_soja:10,yield_soja:60,fixed_soja:20,storageT:80})).data.producer
 const other=(await local('/api/producers',{name:'Outra pessoa',area_milho:99,yield_milho:100})).data.producer
 const ask=(await local('/api/requests',{producerId:p.id,commodity:'soja',direction:'sell',volume:90,targetPrice:150,request:'confidential-request'})).data.request
 await local('/api/requests',{producerId:other.id,commodity:'milho',volume:900,targetPrice:60})
 await local('/api/quotes',{commodity:'soja',price:140,region:'São Luiz Gonzaga 123.456.789-00',sourceName:'Fonte 12345678900'})
 await local('/api/quotes',{commodity:'milho',price:65,region:'Outra praça',sourceName:'Cotrisal'})
 assert.equal((await request(scoped())).data.status,'NOT_LINKED')
 assert.equal((await request('/api/integrations/val/link',{method:'POST',payload:link(p.id,{confirmed:false})})).status,422)
 assert.equal((await request('/api/integrations/val/link',{method:'POST',payload:link(p.id,{reason:'curto'})})).status,422)
 assert.equal((await request('/api/integrations/val/link',{method:'POST',payload:link('missing')})).status,422)
 assert.equal((await request('/api/integrations/val/link',{method:'POST',payload:link(p.id,{tenantId:'spoof'})})).status,403)
 const accepted=await request('/api/integrations/val/link',{method:'POST',payload:link(p.id)})
 assert.deepEqual(accepted.data,{contract:'val.sog.v1',source:'val-sog',tenantId,ownerUserId,clientId,linked:true,producerId:p.id,duplicate:false})
 assert.equal((await request('/api/integrations/val/link',{method:'POST',payload:link(p.id)})).data.duplicate,true)
 assert.equal((await request('/api/integrations/val/link',{method:'POST',payload:link(other.id)})).status,409)
 assert.equal((await request('/api/integrations/val/link',{method:'POST',payload:link(p.id,{clientId:'client-b'})})).status,409)
 const context=await request(scoped())
 assert.equal(context.status,200);assert.equal(context.data.status,'LINKED');assert.equal(context.data.contract,'val.sog.v1');assert.equal(context.data.tenantId,tenantId);assert.equal(context.data.ownerUserId,ownerUserId);assert.equal(context.data.clientId,clientId)
 assert.deepEqual(context.data.producer,{id:p.id});assert.equal(context.data.positions[0].productionSc,600);assert.equal(context.data.positions[0].fixedSc,120);assert.equal(context.data.intentions[0].id,ask.id);assert.equal(context.data.intentions[0].status,'monitoring');assert.equal(context.data.marketSnapshots.length,1)
 const serialized=JSON.stringify(context.data)
 for(const secret of ['Produtor A','private-phone','private-note','confidential-request','Outra pessoa','123.456.789-00','12345678900'])assert.ok(!serialized.includes(secret),secret)
 assert.equal((await request(scoped('client-b'))).data.status,'NOT_LINKED')
 assert.equal((await request(scoped(clientId,'owner-b'))).data.status,'NOT_LINKED')
 assert.equal((await request(scoped()+'&tenantId=spoof')).status,403)
 const persisted=JSON.parse(readFileSync(join(dataDir,'store.json'),'utf8'))
 assert.equal(persisted.valProducerLinks.length,1);assert.equal(persisted.valBridgeAudit.length,1);assert.ok(!JSON.stringify(persisted.valProducerLinks).includes(token))
 assert.equal((await request('/api/integrations/val/unlink',{method:'POST',payload:{ownerUserId,clientId}})).status,422)
 const removed=await request('/api/integrations/val/unlink',{method:'POST',payload:{ownerUserId,clientId,confirmed:true,reason:'Revogação humana para corrigir vínculo.'}})
 assert.deepEqual(removed.data,{contract:'val.sog.v1',source:'val-sog',tenantId,ownerUserId,clientId,linked:false,producerId:null})
 assert.equal((await request(scoped())).data.status,'NOT_LINKED')
 const after=JSON.parse(readFileSync(join(dataDir,'store.json'),'utf8'))
 assert.equal(after.producers.length,2);assert.equal(after.requests.length,2);assert.equal(after.valBridgeAudit.length,2)
})

test('cobertura informa truncamento e registros inválidos; posições desconhecidas permanecem nulas',()=>{
 const producer={id:'producer-synthetic',crops:{soja:{areaHa:10,yieldScHa:60}},season:'2026/27'}
 const sample={id:'request-1',producerId:producer.id,commodity:'soja',direction:'buy',volume:100,volumeUnit:'sc_60kg',targetPrice:100,priceUnit:'BRL/sc_60kg',status:'open',updatedAt:'2026-10-12T12:00:00.000Z'}
 const data={producers:[producer],requests:[...Array.from({length:105},(_,i)=>({...sample,id:`request-${i}`})),{...sample,id:'request-invalid',updatedAt:'invalid-date'},{...sample,id:'request-no-crop',commodity:'milho'}],quotes:Array.from({length:41},(_,i)=>({id:`quote-${i}`,commodity:'soja',price:140,priceUnit:'BRL/sc_60kg',observedAt:'2026-10-12T12:00:00.000Z'}))}
 const dto=buildSogContext(data,{producerId:producer.id},{tenantId,ownerUserId,clientId})
 assert.equal(dto.intentions.length,100);assert.equal(dto.marketSnapshots.length,40);assert.equal(dto.intentions[0].direction,'buy')
 assert.equal(dto.coverage.intentionsTotal,107);assert.equal(dto.coverage.intentionsReturned,100);assert.equal(dto.coverage.intentionsRejected,1);assert.equal(dto.coverage.marketSnapshotsTotal,41);assert.equal(dto.coverage.complete,false)
 assert.ok(!dto.intentions.some(x=>x.id==='request-invalid'))
 assert.equal(dto.positions.find(p=>p.commodity==='soja').productionSc,600);assert.equal(dto.positions.find(p=>p.commodity==='soja').fixedPercent,null);assert.equal(dto.positions.find(p=>p.commodity==='soja').fixedSc,null)
 assert.deepEqual(dto.positions.find(p=>p.commodity==='milho'),{commodity:'milho',areaHa:null,yieldScHa:null,productionSc:null,fixedPercent:null,fixedSc:null,openSc:null})
})

test('vínculos persistem após reinício e dados corrompidos falham fechado sem sobrescrita',async t=>{
 const first=await start();t.after(()=>first.server.close())
 const producer=(await first.local('/api/producers',{name:'Produtor sintético'})).data.producer
 assert.equal((await first.request('/api/integrations/val/link',{method:'POST',payload:link(producer.id)})).status,200)
 const second=await start({dataDir:first.dataDir});t.after(()=>second.server.close())
 assert.equal((await second.request(scoped())).data.status,'LINKED')
 const file=join(first.dataDir,'store.json')
 const broken='{invalid-store'
 writeFileSync(file,broken)
 assert.equal((await second.request(scoped())).status,503)
 assert.equal((await second.request('/api/integrations/val/link',{method:'POST',payload:link(producer.id)})).status,503)
 assert.equal(readFileSync(file,'utf8'),broken)
})

test('configuração incompleta e excesso de corpo não concedem vínculo',async t=>{
 const disabled=await start({valBridge:{token:'short',tenantId}});t.after(()=>disabled.server.close())
 assert.equal((await disabled.request('/api/integrations/val/health')).status,401)
 const active=await start();t.after(()=>active.server.close())
 assert.equal((await active.request('/api/integrations/val/link',{method:'POST',payload:{ownerUserId,clientId,reason:'x'.repeat(5000)}})).status,413)
 assert.equal((await active.request('/api/integrations/val/link',{method:'POST',payload:[]})).status,400)
 assert.equal((await active.request('/api/integrations/val/link',{method:'POST',payload:link('synthetic',{ownerUserId:''})})).status,400)
})

test('mutações com cache antigo preservam produtores, vínculos e auditoria de outra instância',async t=>{
 const first=await start();t.after(()=>first.server.close())
 const a=(await first.local('/api/producers',{name:'Produtor sintético A'})).data.producer
 const second=await start({dataDir:first.dataDir});t.after(()=>second.server.close())
 const b=(await second.local('/api/producers',{name:'Produtor sintético B'})).data.producer
 assert.equal((await second.request('/api/integrations/val/link',{method:'POST',payload:link(b.id,{clientId:'client-b'})})).status,200)
 assert.equal((await first.request('/api/integrations/val/link',{method:'POST',payload:link(a.id)})).status,200)
 const file=join(first.dataDir,'store.json'),linked=JSON.parse(readFileSync(file,'utf8'))
 assert.deepEqual(linked.producers.map(p=>p.id),[a.id,b.id])
 assert.deepEqual(linked.valProducerLinks.map(l=>l.clientId),['client-b',clientId])
 assert.deepEqual(linked.valBridgeAudit.map(e=>e.clientId),['client-b',clientId])
 assert.equal((await second.request(scoped('client-b'))).data.status,'LINKED')
 // This instance still had the cache from before the first instance's link.
 assert.equal((await second.request('/api/integrations/val/unlink',{method:'POST',payload:{ownerUserId,clientId:'client-b',confirmed:true,reason:'Revogação humana do vínculo sintético B.'}})).status,200)
 const unlinked=JSON.parse(readFileSync(file,'utf8'))
 assert.deepEqual(unlinked.producers.map(p=>p.id),[a.id,b.id])
 assert.deepEqual(unlinked.valProducerLinks.map(l=>l.clientId),[clientId])
 assert.deepEqual(unlinked.valBridgeAudit.map(e=>[e.action,e.clientId]),[['val_link_verified','client-b'],['val_link_verified',clientId],['val_link_revoked','client-b']])
 assert.equal((await first.request(scoped())).data.status,'LINKED')
})

test('corrupção enquanto o corpo da mutação chega falha fechado sem sobrescrever o arquivo',async t=>{
 const active=await start();t.after(()=>active.server.close())
 const producer=(await active.local('/api/producers',{name:'Produtor sintético'})).data.producer
 assert.equal((await active.request('/api/integrations/val/link',{method:'POST',payload:link(producer.id)})).status,200)
 const file=join(active.dataDir,'store.json'),valid=readFileSync(file,'utf8'),broken='{corrupted-during-body'
 for(const operation of ['link','unlink']){
  writeFileSync(file,valid)
  const payload=JSON.stringify(link(producer.id))
  const response=await new Promise((resolve,reject)=>{
   const outgoing=httpRequest(active.base+`/api/integrations/val/${operation}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'x-val-tenant-id':tenantId}},incoming=>{
    const chunks=[];incoming.on('data',chunk=>chunks.push(chunk));incoming.on('error',reject);incoming.on('end',()=>resolve({status:incoming.statusCode,data:JSON.parse(Buffer.concat(chunks).toString())}))
   })
   outgoing.on('error',reject)
   active.server.once('request',()=>{
    // createApp's request handler has checked the original file and is waiting
    // for the remaining JSON. Replace it before permitting body completion.
    writeFileSync(file,broken)
    outgoing.end(payload.slice(10))
   })
   outgoing.write(payload.slice(0,10))
  })
  assert.equal(response.status,503,operation)
  assert.equal(readFileSync(file,'utf8'),broken,operation)
 }
})
