import test from 'node:test'
import assert from 'node:assert/strict'
import {analyzeRequest,buildBrief,buildPortfolio,checkTargets,cropPosition,fixingPace,loadPraca,loadSources,normalizeProducer,normalizeQuote,normalizeRequest} from '../lib/analysis.js'

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

test('ficha ampliada gera posição, ritmo de fixação e estratégia personalizada',()=>{
 const producer={id:'p2',...normalizeProducer({name:'Maria',area_soja:'200',yield_soja:'60',fixed_soja:'10',cost_soja:'120',riskTolerance:'baixa',decisionMaker:'familia',sellingStyle:'colheita',proofPreference:'numeros',paymentPreference:'h72',usualBuyers:'Coopatrigo, Cotrisal',cashMonths:['10','3'],storageT:'800',storageCostScMonth:'1.2'})}
 assert.deepEqual(producer.cashMonths,[3,10]);assert.deepEqual(producer.usualBuyers,['Coopatrigo','Cotrisal'])
 const position=cropPosition(producer,'soja');assert.equal(position.productionSc,12000);assert.equal(position.fixedSc,1200);assert.equal(position.openSc,10800)
 const pace=fixingPace(praca.commodities.soja.calendar,9,10);assert.equal(pace.phase,'preplanting');assert.equal(pace.status,'ok')
 assert.equal(fixingPace(praca.commodities.soja.calendar,11,10).status,'behind')
 assert.equal(fixingPace(praca.commodities.soja.calendar,4,90).status,'ahead')
 const request=normalizeRequest({producerId:'p2',commodity:'soja',volume:3000,targetPrice:150,objective:'equilibrio',deliveryLocation:'São Luiz Gonzaga'})
 const analysis=analyzeRequest({request,producer,quotes:[quote],praca},{now:new Date('2026-11-10T12:00:00.000Z')})
 assert.deepEqual(analysis.closingTargets.map(t=>t.share),[44,33,23])
 assert.equal(analysis.pace.status,'behind')
 assert.ok(analysis.strategy.some(x=>/abaixo do ritmo/.test(x)))
 assert.ok(analysis.strategy.some(x=>/família/.test(x)))
 assert.ok(analysis.strategy.some(x=>/Coopatrigo, Cotrisal/.test(x)))
 assert.ok(analysis.strategy.some(x=>/Custo de carregar/.test(x)))
 assert.ok(analysis.strategy.some(x=>/vender na colheita/.test(x)))
 assert.ok(analysis.alerts.some(x=>/vencida/.test(x)))
 assert.throws(()=>normalizeProducer({name:'X',fixed_soja:'120'}),/entre 0 e 100/)
})

test('portfólio consolida posição, fontes do dia, agenda e produtores abaixo do ritmo',()=>{
 const p1={id:'p1',name:'João',crops:{soja:{areaHa:100,yieldScHa:60,fixedPercent:5}},cashMonths:[10]}
 const p2={id:'p2',name:'Maria',crops:{soja:{areaHa:50,yieldScHa:60,fixedPercent:50}},cashMonths:[]}
 const req={id:'r1',producerId:'p1',producerName:'João',commodity:'soja',status:'open',volume:1000,volumeUnit:'sc_60kg',cashNeedBRL:50000,cashNeedDate:'2026-10-20',deliveryStart:'2026-10-15',createdAt:'2026-09-23T12:00:00.000Z',closings:[{price:140,volumeSc:200}],analysis:{request:{volumeSc:1000},closingTargets:[{price:140},{price:150},{price:156}]}}
 const quotes=[quote,{...quote,id:'q5',price:138,observedAt:'2026-09-20T09:00:00.000Z'},port]
 const pf=buildPortfolio({producers:[p1,p2],requests:[req],quotes,praca,sources:loadSources().sources},{now})
 const soja=pf.commodities.find(c=>c.commodity==='soja')
 assert.equal(soja.productionSc,9000);assert.equal(soja.fixedSc,1800);assert.equal(soja.series.length,2);assert.equal(soja.latest.price,140);assert.equal(soja.changePercent,1.4)
 assert.equal(pf.kpis.closedVolumeSc,200);assert.equal(pf.kpis.openVolumeSc,1000)
 assert.ok(pf.sourcesToday.find(f=>f.id==='cotrisal').done);assert.equal(pf.sourcesToday.find(f=>f.id==='coopatrigo').done,false)
 assert.ok(pf.agenda.some(a=>a.kind==='caixa'&&/João/.test(a.label)));assert.ok(pf.agenda.some(a=>a.kind==='entrega'))
 assert.equal(pf.attention.length,1);assert.equal(pf.attention[0].producerName,'João')
})
