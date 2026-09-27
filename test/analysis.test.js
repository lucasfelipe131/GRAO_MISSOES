import test from 'node:test'
import assert from 'node:assert/strict'
import {analyzeRequest,buildBrief,checkTargets,loadPraca,loadSources,normalizeQuote,normalizeRequest} from '../lib/analysis.js'

const now=new Date('2026-09-23T12:00:00.000Z')
const praca=loadPraca()
const producer={id:'p1',name:'João da Silva',municipality:'São Luiz Gonzaga',storageT:1200,costs:{soja:120}}
const quote={id:'q1',commodity:'soja',region:'São Luiz Gonzaga',price:140,priceUnit:'BRL/sc_60kg',sourceName:'Cotrisal',observedAt:'2026-09-23T09:00:00.000Z',status:'active'}
const port={id:'q2',commodity:'soja',region:'Paranaguá/PR',price:161.52,priceUnit:'BRL/sc_60kg',sourceName:'CEPEA',observedAt:'2026-09-22T18:00:00.000Z',status:'active'}

test('praça carrega e pedido é normalizado com custo do cadastro',()=>{
 assert.equal(praca.id,'sao-luiz-gonzaga-rs')
 const request=normalizeRequest({producerId:'p1',commodity:'soja',volume:'3.000',targetPrice:'150',objective:'caixa',cashNeedBRL:200000,cashNeedDate:'2026-10-20'})
 const analysis=analyzeRequest({request,producer,quotes:[quote,port],praca},{now})
 assert.equal(analysis.request.costPriceSc,120)
 assert.ok(analysis.assumptions.some(item=>/cadastro do produtor/.test(item)))
 assert.equal(analysis.marketReading.basisSc,-21.52)
 assert.equal(analysis.marketReading.marginPercent,16.67)
 assert.deepEqual(analysis.closingTargets.map(t=>[t.price,t.share]),[[140,50],[150,30],[156,20]])
 assert.equal(analysis.praca.stage.key,'recovery')
 assert.equal(analysis.producer.storage,true)
})

test('sem cotação a análise declara lacuna; cotação vencida gera alerta',()=>{
 const request=normalizeRequest({producerId:'p1',commodity:'milho',volume:500})
 const none=analyzeRequest({request,producer,quotes:[],praca},{now})
 assert.equal(none.closingTargets.length,0)
 assert.match(none.headline,/Faltam dados/)
 const stale=analyzeRequest({request:normalizeRequest({producerId:'p1',commodity:'soja',volume:500,targetPrice:150}),producer,quotes:[{...quote,observedAt:'2026-08-01T09:00:00.000Z'}],praca},{now})
 assert.ok(stale.alerts.some(item=>/vencida/.test(item)))
})

test('cotações exigem fonte e não podem estar no futuro',()=>{
 assert.throws(()=>normalizeQuote({commodity:'soja',price:140,region:'SLG'}),/fonte/)
 assert.throws(()=>normalizeQuote({commodity:'soja',price:140,region:'SLG',sourceName:'X',observedAt:'2099-01-01'}),/futuro/)
 assert.equal(normalizeQuote({commodity:'trigo',price:'1.419,84',priceUnit:'BRL/t',region:'RS',sourceName:'CEPEA'}).price,1419.84)
})

test('briefing separa referências datadas e checagem de alvos detecta preço atingido',()=>{
 const brief=buildBrief({praca,quotes:[quote]},{now})
 assert.equal(brief.commodities.find(c=>c.commodity==='soja').registeredReference.price,140)
 assert.equal(brief.brief.stale,false)
 const request=normalizeRequest({producerId:'p1',commodity:'soja',volume:1000,targetPrice:150,deliveryLocation:'São Luiz Gonzaga'})
 const analysis=analyzeRequest({request,producer,quotes:[quote],praca},{now})
 const open={...request,id:'r1',status:'open',producerName:'João',analysis}
 assert.equal(checkTargets([open],[quote],now).length,1)
 const hits=checkTargets([open],[{...quote,id:'q9',price:151,observedAt:'2026-09-23T11:00:00.000Z'}],now)
 assert.equal(hits.length,2)
 assert.ok(hits.some(h=>/Alvo 2/.test(h.target)))
})

test('catálogo de fontes preenche praça, unidade, prazo e link ao registrar cotação',()=>{
 const sources=loadSources()
 assert.ok(sources.sources.length>=8)
 for(const item of sources.sources)assert.ok(item.howTo&&item.name&&item.priceUnit,item.id)
 assert.ok(sources.sources.filter(item=>item.primary).length>=3)
 const quote=normalizeQuote({sourceId:'coopatrigo',commodity:'soja',price:'141,50'})
 assert.equal(quote.sourceName,'Coopatrigo');assert.match(quote.sourceUrl,/coopatrigo/);assert.equal(quote.paymentTerms,'72 h');assert.equal(quote.sourceType,'cooperative');assert.equal(quote.confidence,85)
 const wheat=normalizeQuote({sourceId:'cepea-trigo',commodity:'trigo',price:'1.419,84'})
 assert.equal(wheat.priceUnit,'BRL/t');assert.equal(wheat.price,1419.84)
 assert.throws(()=>normalizeQuote({sourceId:'inexistente',commodity:'soja',price:1}),/catálogo/)
 assert.throws(()=>normalizeQuote({sourceId:'outra',commodity:'soja',price:1,region:'X'}),/fonte/)
})
