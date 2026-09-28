import test from 'node:test'
import assert from 'node:assert/strict'
import {createPdf,drawTable,textWidth,toWinAnsi} from '../lib/pdf.js'
import {generalReport,normalizeReportFilters,offersReport,quotesReport,receiptsReport,requestReport,requestsReport} from '../lib/reports.js'
import {loadPraca} from '../lib/analysis.js'

const parse=buf=>{const s=buf.toString('latin1');const sx=Number(s.slice(s.lastIndexOf('startxref')+9).trim().split(/\s/)[0]);const lines=s.slice(sx).split('\n');assert.equal(lines[0],'xref');const count=Number(lines[1].split(' ')[1]);for(let i=1;i<count;i++){const off=Number(lines[2+i].slice(0,10));assert.equal(s.slice(off,off+`${i} 0 obj`.length),`${i} 0 obj`,'offset do objeto '+i)}return {text:s,objects:count-1}}

test('gerador de PDF: estrutura válida, acentos em WinAnsi e tabela com quebra de página',()=>{
 assert.equal(toWinAnsi('São Luiz — grão • 2ª'),'São Luiz \u0097 grão \u0095 2ª')
 assert.equal(toWinAnsi('→ ≈ ✓ ∑'),'-> ~ ok ?')
 assert.ok(textWidth('VAL',12,true)>textWidth('VAL',12,false))
 const doc=createPdf({title:'Teste'}).addPage()
 doc.text(40,60,'Título com acentuação: ção ã é ê',{size:14,bold:true})
 doc.text(500,80,'direita',{align:'right'});doc.rect(40,100,200,20,{fill:'#F3F6FA',stroke:'#0758B6'});doc.line(40,130,300,130)
 const rows=[...Array(120)].map((_,i)=>({a:'linha '+(i+1),b:(i*1.5).toFixed(2)}))
 drawTable(doc,{columns:[{key:'a',label:'Nome',width:200},{key:'b',label:'Valor',width:80,align:'right'}],rows,x:40,y:150})
 assert.ok(doc.pageCount()>=3)
 doc.eachPage((n,total)=>doc.text(40,820,`Página ${n} de ${total}`,{size:8}))
 const buf=doc.render();assert.equal(buf.slice(0,8).toString('latin1'),'%PDF-1.4')
 const p=parse(buf);assert.ok(p.objects>=doc.pageCount()*2+4);assert.match(p.text,/\/Type \/Catalog/);assert.equal((p.text.match(/\/Type \/Page\b/g)||[]).length,doc.pageCount());assert.match(p.text,/WinAnsiEncoding/);assert.match(p.text,/\(Página 1 de \d+\)/)
})

test('relatórios: ofertas, recebimentos e geral respeitam filtros e geram PDF válido',()=>{
 const now=new Date('2026-09-28T12:00:00Z')
 const offers=[{id:'o1',producerId:'p1',producerName:'João',status:'aceita',closedPrice:146,notes:'travar 2 mil sacas',createdAt:'2026-09-21T10:00:00Z',offer:{commodity:'soja',commodityLabel:'Soja',volumeSc:2000,deliveryLabel:'nov/26',reference:{price:163},freight:{perSc:21.5},margin:{perSc:2.5},offerPrice:139,offerTotal:278000,askingPrice:150}},{id:'o2',producerId:'p2',producerName:'Maria',status:'recusada',createdAt:'2026-08-05T10:00:00Z',offer:{commodity:'milho',commodityLabel:'Milho',volumeSc:500,deliveryLabel:'dez/26',reference:{price:65},freight:{perSc:3},margin:{perSc:2},offerPrice:60,offerTotal:30000}}]
 const units=[{id:'u1',name:'Unidade SLG',capacityT:10000,goals:{soja:8000},seasonStart:'2026-09-01',seasonEnd:'2027-05-31'}]
 const receipts=[{id:'r1',unitId:'u1',commodity:'soja',date:'2026-09-10',quantityT:200,loads:6,params:{moisture:14.8},producerName:'João'},{id:'r2',unitId:'u1',commodity:'soja',date:'2026-09-12',quantityT:300,loads:9,params:{moisture:13}},{id:'r3',unitId:'u1',commodity:'trigo',date:'2026-08-30',quantityT:50}]
 const filters=normalizeReportFilters({from:'2026-09-01',to:'2026-09-30',status:'',unitId:''})
 assert.throws(()=>normalizeReportFilters({from:'2026-09-30',to:'2026-09-01'}),/período/)
 const a=offersReport({offers,filters,now,user:'Chefe'});assert.equal(a.count,1);parse(a.buffer);assert.match(a.buffer.toString('latin1'),/Relatório de ofertas/);assert.equal(a.filename,'ofertas-2026-09-01-2026-09-30.pdf')
 const b=receiptsReport({units,readings:[],receipts,filters,now});assert.equal(b.count,2);parse(b.buffer);assert.match(b.buffer.toString('latin1'),/Metas da safra/)
 const g=generalReport({offers,units,readings:[],receipts,filters:normalizeReportFilters({}),now});assert.equal(g.count,5);const pg=parse(g.buffer);assert.ok((pg.text.match(/\/Type \/Page\b/g)||[]).length>=2)
 const empty=offersReport({offers:[],filters:normalizeReportFilters({producerId:'zzz'}),now});assert.equal(empty.count,0);assert.match(empty.buffer.toString('latin1'),/Nenhuma oferta/)
})

test('relatório de pedidos e análises: tabela, página por pedido e PDF individual',()=>{
 const now=new Date('2026-09-28T12:00:00Z')
 const analysis={rulesVersion:'analysis-v1',generatedAt:'2026-09-20T10:00:00Z',headline:'Soja: mercado 4,8% abaixo do alvo; escalonar em três parcelas.',request:{commodityLabel:'Soja',volumeSc:2000,objectiveLabel:'Equilíbrio',targetPriceSc:148,costPriceSc:120},producer:{name:'João da Silva',municipality:'São Luiz Gonzaga'},praca:{stage:{label:'Entressafra'}},marketReading:{reference:{price:141,sourceName:'C.Vale',freshness:'Atual',observedAt:'2026-09-20T09:00:00Z'},port:{price:163,region:'Rio Grande'},basisSc:-22,priceGapPercent:-4.8,marginPercent:17.5,competition:{own:{price:141,observedAt:'2026-09-20T09:00:00Z'},competitors:[{sourceName:'Coopatrigo',price:143,observedAt:'2026-09-20T09:00:00Z',automatic:true}]}},closingTargets:[{key:'trigger',label:'Alvo 1 — gatilho imediato',share:34,volumeSc:680,price:141,revenueBRL:95880,trigger:'Cotação registrada igual ou superior',condition:'Fechar ao preço executável hoje.'},{key:'target',label:'Alvo 2 — preço do produtor',share:33,volumeSc:660,price:148,revenueBRL:97680,trigger:'Ordem deixada com o comprador'},{key:'stretch',label:'Alvo 3 — esticada condicional',share:33,volumeSc:660,price:153.9,revenueBRL:101574,trigger:'Evento de mercado'}],ladder:{averagePriceSc:147.6,revenueBRL:295134,sharesNote:'34/33/33'},scenarios:[{label:'Pessimista',price:134,revenueBRL:268000,note:'Base piora 5%.'},{label:'Base',price:141,revenueBRL:282000,note:'Última referência.'},{label:'Otimista',price:148,revenueBRL:296000,note:'Alvo atingido.'}],tips:[{scope:'praca',text:'Escalonar vendas.'}],reasons:['Base local contra Rio Grande: −R$ 22,00 por saca.'],alerts:['Coopatrigo paga R$ 2,00 acima da C.Vale.'],strategy:[],assumptions:[],dataGaps:[]}
 const requests=[{id:'r1',producerId:'p1',producerName:'João da Silva',commodity:'soja',volume:2000,direction:'sell',objective:'equilibrio',status:'open',createdAt:'2026-09-20T10:00:00Z',request:'quer 148 até dezembro',closings:[{at:'2026-09-25T10:00:00Z',buyer:'Coopatrigo',volumeSc:300,price:143,target:'Alvo 1'}],analysis},{id:'r2',producerId:'p2',producerName:'Maria',commodity:'milho',volume:500,direction:'sell',objective:'caixa',status:'cancelled',createdAt:'2026-08-02T10:00:00Z',closings:[],analysis:{request:{commodityLabel:'Milho',volumeSc:500,objectiveLabel:'Caixa'},marketReading:{},closingTargets:[],tips:[],reasons:[],alerts:[],dataGaps:['Sem referência.']}}]
 const all=requestsReport({requests,filters:normalizeReportFilters({}),now,user:'Chefe'});assert.equal(all.count,2);const p=parse(all.buffer);assert.match(p.text,/Relat\u00f3rio de pedidos e an\u00e1lises/);assert.ok((p.text.match(/\/Type \/Page\b/g)||[]).length>=3);assert.match(p.text,/Target de fechamento/);assert.match(p.text,/Fechamentos registrados/)
 const table=requestsReport({requests,filters:normalizeReportFilters({from:'2026-09-01'}),now,detail:false});assert.equal(table.count,1);assert.equal((table.buffer.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1)
 const one=requestReport({request:requests[0],now,user:'Chefe'});assert.equal(one.count,1);parse(one.buffer);assert.equal(one.filename,'analise-joao-da-silva-2026-09-20.pdf');assert.match(one.buffer.toString('latin1'),/An\u00e1lise personalizada do pedido/)
 const g=generalReport({requests,offers:[],units:[],readings:[],receipts:[],filters:normalizeReportFilters({}),now});assert.equal(g.count,2);parse(g.buffer)
})

test('relatório de cotações e comparativo: compradores, estatísticas, sazonal e cotações do período',()=>{
 const now=new Date('2026-09-28T12:00:00Z');const praca=loadPraca()
 const q=(d,src,price,extra={})=>({id:src+d,sourceId:src.toLowerCase(),sourceName:src,commodity:'soja',price,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga',observedAt:d+'T10:00:00.000Z',status:'active',...extra})
 const quotes=[q('2026-09-27','C.Vale',141,{sourceId:'cvale'}),q('2026-09-27','Coopatrigo',143,{automatic:true}),q('2026-09-26','Cotrisal',140),q('2026-09-25','Bunge',163,{region:'Porto de Rio Grande'}),q('2026-09-27','Camera',158,{sourceId:'camera-slg',commodity:'canola'}),q('2026-09-01','Coopatrigo',135),q('2026-08-15','Coopatrigo',128,{imported:true}),q('2026-03-15','Coopatrigo',121,{imported:true}),q('2025-11-15','Coopatrigo',126,{imported:true}),q('2026-09-10','Coopatrigo',1400,{commodity:'trigo',priceUnit:'BRL/t'})]
 const r=quotesReport({quotes,praca,filters:normalizeReportFilters({}),now,user:'Chefe'})
 assert.equal(r.count,7);const p=parse(r.buffer);const txt=p.text
 assert.match(txt,/Relat\u00f3rio de cota\u00e7\u00f5es e comparativo/);assert.match(txt,/Comparativo de compradores/);assert.match(txt,/melhor concorrente Coopatrigo/);assert.match(txt,/Estat\u00edsticas do per\u00edodo/);assert.match(txt,/Padr\u00e3o sazonal observado/);assert.match(txt,/Cota\u00e7\u00f5es registradas no per\u00edodo/);assert.match(txt,/\\\(esmagadora\\\)/);assert.match(txt,/1\.400,00\/t/)
 const only=quotesReport({quotes,praca,filters:normalizeReportFilters({from:'2026-08-01',to:'2026-08-31',commodity:'soja'}),now});assert.equal(only.count,1);assert.match(only.buffer.toString('latin1'),/hist\u00f3rico/)
 const g=generalReport({quotes,praca,requests:[],offers:[],units:[],readings:[],receipts:[],filters:normalizeReportFilters({}),now});assert.equal(g.count,7);parse(g.buffer)
})
