import test from 'node:test'
import assert from 'node:assert/strict'
import {analyzeRequest,buildAskingHistory,buildBrief,buildSeasonality,buildPortfolio,buildPriceYear,checkTargets,cropPosition,fixingPace,loadPraca,loadSources,loadStorageGuide,normalizeImportLines,normalizeProducer,normalizeQuote,normalizeRequest} from '../lib/analysis.js'

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

test('painel de preços do ano consolida séries, estatísticas, média mensal e sazonalidade',()=>{
 const {quotes:imported,rejected}=normalizeImportLines({commodity:'soja',sourceName:'Coopatrigo',lines:'15/01/2026;130,00\n15/03/2026;120,00\n2026-06-15;135.5\nlinha ruim\n15/09/2026;141,00\n99/99/2026;1'})
 assert.equal(imported.length,4);assert.equal(rejected.length,2);assert.equal(imported[0].observedAt,'2026-01-15T12:00:00.000Z');assert.equal(imported[2].price,135.5)
 const own={commodity:'soja',price:141,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga (C.Vale)',sourceId:'cvale',sourceName:'C.Vale',observedAt:'2026-09-23T10:00:00.000Z',status:'active'}
 const year=buildPriceYear({quotes:[...imported,own,port],praca},{now})
 const sojaYear=year.find(c=>c.commodity==='soja');assert.ok(Array.isArray(sojaYear.sources)&&sojaYear.sources.length>=2);assert.ok(sojaYear.sources.some(s=>s.kind==='own'));assert.ok(sojaYear.sources.every(s=>s.points.length&&s.avg!=null&&s.label));assert.ok(sojaYear.seriesStats.own.avg>0)
 const soja=year.find(c=>c.commodity==='soja')
 assert.equal(soja.series.own.length,1);assert.equal(soja.series.competitors.length,4);assert.equal(soja.series.port.length,1)
 assert.equal(soja.stats.min,120);assert.equal(soja.stats.max,141);assert.equal(soja.stats.current,141);assert.equal(soja.stats.positionPercent,100)
 assert.equal(soja.monthly.find(m=>m.month===3).avg,120);assert.equal(soja.monthly.find(m=>m.month===9).n,2)
 assert.equal(soja.seasonal.currentMonth,9);assert.equal(soja.seasonal.source,'observado');assert.equal(soja.seasonal.observedMonths,4);assert.equal(soja.seasonal.index[1],null);assert.deepEqual(soja.seasonal.bestMonths.slice(0,1),[9]);assert.equal(soja.seasonal.next3Percent,null);assert.ok(soja.hints.some(h=>/não projeta o que não foi observado/.test(h)))
 assert.ok(soja.hints.some(h=>/acima da média/.test(h)))
 const milho=year.find(c=>c.commodity==='milho');assert.equal(milho.stats,null);assert.ok(milho.hints.some(h=>/importe um histórico/.test(h)));assert.equal(milho.seasonal.usable,false);assert.equal(milho.seasonal.next3Percent,null);assert.ok(milho.hints.some(h=>/padrão sazonal/.test(h)))
 assert.throws(()=>normalizeImportLines({commodity:'soja',sourceName:'X',lines:'nada'}),/Nenhuma linha válida/)
 const guide=loadStorageGuide();assert.deepEqual(Object.keys(guide.crops),['soja','milho','trigo','canola']);assert.ok(guide.general.fumigation.items.length>=4)
})

test('histórico de pedidas por produtor: ofertas e pedidos, prêmio sobre C.Vale e fechamento',()=>{
 const now=new Date('2026-09-27T12:00:00Z')
 const producers=[{id:'p1',name:'Ana'},{id:'p2',name:'Bento'}]
 const quotes=[{id:'q1',sourceId:'cvale',sourceName:'C.Vale',commodity:'soja',price:140,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga',observedAt:'2026-09-20T10:00:00Z'},{id:'q2',sourceId:'coopatrigo',sourceName:'Coopatrigo',commodity:'soja',price:142,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga',observedAt:'2026-09-20T10:00:00Z'}]
 const offers=[
  {id:'o1',producerId:'p1',status:'aceita',closedPrice:146,createdAt:'2026-09-21T10:00:00Z',offer:{commodity:'soja',commodityLabel:'Soja',volumeSc:1000,askingPrice:150,offerPrice:145,asking:{gapSc:-5,status:'ajustavel'},comparison:{cvale:140,competitor:{price:142,sourceName:'Coopatrigo'}}}},
  {id:'o2',producerId:'p1',status:'recusada',createdAt:'2026-09-25T10:00:00Z',offer:{commodity:'soja',commodityLabel:'Soja',volumeSc:500,askingPrice:154,offerPrice:147,asking:{gapSc:-7,status:'ajustavel'},comparison:{cvale:141,competitor:null}}},
  {id:'o3',producerId:'p1',status:'rascunho',createdAt:'2026-09-26T10:00:00Z',offer:{commodity:'milho',commodityLabel:'Milho',volumeSc:200,askingPrice:null,offerPrice:60,asking:null,comparison:{}}}
 ]
 const requests=[{id:'r1',producerId:'p2',status:'closed',commodity:'soja',createdAt:'2026-09-22T10:00:00Z',request:'quer 148',closings:[{price:143,volumeSc:300}],analysis:{request:{targetPriceSc:148,volumeSc:300,commodityLabel:'Soja'},marketReading:{reference:{price:142}}}}]
 const hist=buildAskingHistory({producers,offers,requests,quotes},{now})
 assert.equal(hist.length,2)
 const ana=hist.find(h=>h.producerId==='p1');assert.equal(ana.n,2);assert.equal(ana.entries[0].askingPrice,154)
 const soja=ana.byCommodity.find(c=>c.commodity==='soja');assert.equal(soja.n,2);assert.equal(soja.avgAsking,152);assert.equal(soja.minAsking,150);assert.equal(soja.maxAsking,154);assert.equal(soja.trendSc,4);assert.equal(soja.avgGapSc,-6);assert.equal(soja.avgPremiumVsCvaleSc,11.5);assert.equal(soja.acceptedRate,50);assert.equal(soja.avgClosedVsAsking,-4)
 assert.ok(ana.hints.some(h=>/acima do C.Vale/.test(h)))
 const bento=hist.find(h=>h.producerId==='p2');assert.equal(bento.entries[0].kind,'pedido');assert.equal(bento.entries[0].askingPrice,148);assert.equal(bento.entries[0].cvaleOnDay,140);assert.equal(bento.entries[0].competitorOnDay,142);assert.equal(bento.entries[0].closedPrice,143);assert.equal(bento.entries[0].gapSc,-6)
 assert.equal(buildAskingHistory({producers,offers:[],requests:[],quotes},{now}).length,0)
})

test('padrão sazonal só com cotações registradas: meses sem dado ficam vazios e nada é inventado',()=>{
 const now=new Date('2026-09-27T12:00:00Z')
 const q=(d,p,extra={})=>({commodity:'soja',price:p,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga',sourceName:'Coopatrigo',observedAt:d+'T12:00:00.000Z',status:'active',...extra})
 assert.equal(buildSeasonality({quotes:[],commodity:'soja'},{now}).usable,false)
 assert.equal(buildSeasonality({quotes:[q('2026-01-10',130),q('2026-02-10',125)],commodity:'soja'},{now}).usable,false)
 const s=buildSeasonality({quotes:[q('2026-01-10',130),q('2026-01-20',130),q('2026-05-10',120),q('2026-09-10',150),q('2026-09-11',150,{region:'Porto de Rio Grande'}),q('2025-09-10',150)],commodity:'soja'},{now})
 assert.equal(s.usable,true);assert.equal(s.observedMonths,3);assert.equal(s.mean,Number(((130+120+150)/3).toFixed(2)))
 assert.equal(s.index[0],Math.round(130/s.mean*100));assert.equal(s.index[4],Math.round(120/s.mean*100));assert.equal(s.index[8],Math.round(150/s.mean*100));assert.equal(s.index[1],null);assert.equal(s.index[11],null)
 assert.deepEqual(s.months[8].years,['2025','2026']);assert.equal(s.months[8].days,2)
})
