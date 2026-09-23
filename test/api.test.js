import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createApp} from '../server.js'

const start=(options={})=>new Promise(resolve=>{const server=createApp({dataDir:mkdtempSync(join(tmpdir(),'gm-')),...options});server.listen(0,()=>resolve({server,base:`http://127.0.0.1:${server.address().port}`}))})
const call=async(base,method,path,payload,code)=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(code?{'x-access-code':code}:{})},body:payload?JSON.stringify(payload):undefined});return {status:response.status,data:await response.json()}}

test('fluxo completo: produtor, cotação, pedido com análise, fechamento e alvo atingido',async()=>{
 const {server,base}=await start()
 try{
  const producer=(await call(base,'POST','/api/producers',{name:'João da Silva',municipality:'São Luiz Gonzaga',storageT:1200,cost_soja:120})).data.producer
  assert.ok(producer.id)
  assert.equal((await call(base,'POST','/api/quotes',{commodity:'soja',price:140,region:'São Luiz Gonzaga',sourceName:'Cotrisal'})).status,201)
  assert.equal((await call(base,'POST','/api/quotes',{commodity:'soja',price:161.52,region:'Paranaguá/PR',sourceName:'CEPEA'})).status,201)
  const preview=await call(base,'POST','/api/analyze',{producerId:producer.id,commodity:'soja',volume:3000,targetPrice:150,objective:'caixa'})
  assert.equal(preview.status,200);assert.equal(preview.data.analysis.closingTargets.length,3)
  const created=await call(base,'POST','/api/requests',{producerId:producer.id,commodity:'soja',volume:3000,targetPrice:150,objective:'caixa',deliveryLocation:'São Luiz Gonzaga'})
  assert.equal(created.status,201);assert.equal(created.data.request.status,'open');assert.equal(created.data.request.producerName,'João da Silva')
  const id=created.data.request.id
  const closing=await call(base,'POST',`/api/requests/${id}/closings`,{price:141,volumeSc:1500,buyer:'Coopatrigo',target:'Alvo 1'})
  assert.equal(closing.status,201);assert.equal(closing.data.request.closings.length,1);assert.equal(closing.data.request.status,'open')
  assert.equal((await call(base,'POST','/api/quotes',{commodity:'soja',price:151,region:'São Luiz Gonzaga',sourceName:'Coopatrigo'})).status,201)
  const bootstrap=await call(base,'GET','/api/bootstrap')
  assert.equal(bootstrap.status,200);assert.equal(bootstrap.data.producers.length,1);assert.equal(bootstrap.data.quotes.length,3)
  assert.ok(bootstrap.data.targetHits.some(h=>/Alvo 2/.test(h.target)))
  assert.equal(bootstrap.data.brief.praca.id,'sao-luiz-gonzaga-rs')
  const rerun=await call(base,'POST',`/api/requests/${id}/rerun`)
  assert.equal(rerun.data.request.analysis.marketReading.reference.price,151)
  assert.equal((await call(base,'POST','/api/requests',{producerId:'00000000-0000-4000-8000-000000000000',commodity:'soja',volume:10})).status,404)
  assert.equal((await call(base,'POST','/api/quotes',{commodity:'cafe',price:1,region:'x',sourceName:'y'})).status,400)
  const html=await fetch(base+'/');assert.equal(html.status,200);assert.match(await html.text(),/Grãos Missões/)
 }finally{server.close()}
})

test('código de acesso protege a API quando configurado',async()=>{
 const {server,base}=await start({accessCode:'missoes2026'})
 try{
  assert.equal((await call(base,'GET','/api/bootstrap')).status,401)
  assert.equal((await call(base,'GET','/api/bootstrap',null,'errado')).status,401)
  assert.equal((await call(base,'GET','/api/bootstrap',null,'missoes2026')).status,200)
  assert.equal((await call(base,'GET','/api/session')).data.protected,true)
  assert.equal((await fetch(base+'/health')).status,200)
 }finally{server.close()}
})
