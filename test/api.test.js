import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {createApp} from '../server.js'
import {loadSources} from '../lib/analysis.js'

const start=(options={})=>new Promise(resolve=>{const server=createApp({dataDir:mkdtempSync(join(tmpdir(),'gm-')),...options});server.listen(0,()=>resolve({server,base:`http://127.0.0.1:${server.address().port}`}))})
const call=async(base,method,path,payload,code)=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(code?{'x-access-code':code}:{})},body:payload?JSON.stringify(payload):undefined});return {status:response.status,data:await response.json()}}

test('fluxo completo: produtor, cotação, pedido com análise, fechamento e alvo atingido',async()=>{
 const {server,base}=await start()
 try{
  const producer=(await call(base,'POST','/api/producers',{name:'João da Silva',municipality:'São Luiz Gonzaga',storageT:1200,cost_soja:120,area_soja:200,yield_soja:60,fixed_soja:10,riskTolerance:'media',cashMonths:['10']})).data.producer
  assert.equal(producer.crops.soja.areaHa,200);assert.deepEqual(producer.cashMonths,[10])
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
  assert.equal(bootstrap.data.portfolio.commodities.find(c=>c.commodity==='soja').productionSc,12000)
  assert.ok(bootstrap.data.catalog.producerOptions.riskTolerance.baixa)
  assert.ok(created.data.request.analysis.position)
  assert.ok(bootstrap.data.catalog.sources.some(item=>item.id==='coopatrigo'&&item.url))
  assert.ok(bootstrap.data.catalog.references.length>=3)
  const fromCatalog=await call(base,'POST','/api/quotes',{sourceId:'cotrisal',commodity:'milho',price:62})
  assert.equal(fromCatalog.status,201);assert.equal(fromCatalog.data.quote.region,'Noroeste/RS (Cotrisal)');assert.equal(fromCatalog.data.quote.sourceId,'cotrisal')
  const page=await (await fetch(base+'/')).text()
  assert.ok((page.match(/class="guide"/g)||[]).length>=4)
  assert.match(page,/select name="sourceId"/)
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

test('preço C.Vale manual, comparativo automático e salvamento das leituras',async()=>{
 const html=`<html><body><table><tr><td>Soja (60kg) 72hs</td><td>R$ 143,00</td></tr><tr><td>Milho (60kg)</td><td>R$ 61,00</td></tr></table><p>27/09/2026</p></body></html>`
 const site=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});await new Promise(r=>site.listen(0,r));const siteBase=`http://127.0.0.1:${site.address().port}`
 const real=loadSources();const sourcesOverride={...real,sources:real.sources.map(s=>s.fetch&&!s.own?{...s,url:siteBase+'/'+s.id}:s)}
 const {server,base}=await start({sourcesOverride})
 try{
  const producer=(await call(base,'POST','/api/producers',{name:'Ana',area_soja:100,yield_soja:60})).data.producer
  const own=await call(base,'POST','/api/own-quotes',{soja:'140,50',milho:'',trigo:'',paymentTerms:'72 h'})
  assert.equal(own.status,201);assert.equal(own.data.quotes.length,1);assert.equal(own.data.quotes[0].sourceId,'cvale');assert.equal(own.data.quotes[0].price,140.5)
  assert.equal((await call(base,'POST','/api/own-quotes',{soja:''})).status,400)
  const refresh=await call(base,'POST','/api/comparison/refresh')
  assert.equal(refresh.status,200);assert.ok(refresh.data.comparison.okCount>=1)
  const coop=refresh.data.comparison.results.find(r=>r.sourceId==='coopatrigo');assert.equal(coop.prices.soja.price,143)
  const saved=await call(base,'POST','/api/comparison/save',{sourceId:'coopatrigo',commodity:'soja'})
  assert.equal(saved.status,201);assert.equal(saved.data.quotes[0].automatic,true);assert.match(saved.data.quotes[0].notes,/Leitura automática/)
  const analysis=await call(base,'POST','/api/analyze',{producerId:producer.id,commodity:'soja',volume:1000,targetPrice:150,deliveryLocation:'São Luiz Gonzaga'})
  const comp=analysis.data.analysis.marketReading.competition
  assert.equal(comp.own.price,140.5);assert.equal(comp.best.sourceName,'Coopatrigo');assert.equal(comp.gapSc,2.5)
  assert.ok(analysis.data.analysis.alerts.some(a=>/acima da C\.Vale/.test(a)))
  const boot=await call(base,'GET','/api/bootstrap');assert.equal(boot.data.ownSource.id,'cvale');assert.ok(boot.data.comparison.fetchedAt)
 }finally{server.close();site.close()}
})
