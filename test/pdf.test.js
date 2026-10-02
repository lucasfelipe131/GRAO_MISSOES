import test from 'node:test'
import assert from 'node:assert/strict'
import {createPdf,drawTable,textWidth,toWinAnsi} from '../lib/pdf.js'
import {dashboardReport,generalReport,marketReport,normalizeReportFilters,offersReport,producerReport,producersReport,quotesReport,receiptsReport,requestReport,requestsReport,storageReport} from '../lib/reports.js'
import {defaultStandards} from '../lib/storage.js'
import {buildAskingHistory,buildPortfolio,checkTargets,loadPraca,loadSources,normalizeProducer,producerOptions} from '../lib/analysis.js'

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
 const g=generalReport({offers,units,readings:[],receipts,filters:normalizeReportFilters({}),now});assert.ok(g.count>=5);const pg=parse(g.buffer);assert.ok((pg.text.match(/\/Type \/Page\b/g)||[]).length>=2)
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
 const g=generalReport({quotes,praca,requests:[],offers:[],units:[],readings:[],receipts:[],filters:normalizeReportFilters({}),now});assert.ok(g.count>=7);parse(g.buffer)
})

test('relatório de produtores e carteira: carteira por grão, tabela e ficha por produtor',()=>{
 const now=new Date('2026-09-28T12:00:00Z');const praca=loadPraca();const sources=loadSources().sources
 const p1={...normalizeProducer({name:'João da Silva',municipality:'São Luiz Gonzaga',distanceKm:25,storageT:1200,cost_soja:120,area_soja:200,yield_soja:60,fixed_soja:10,riskTolerance:'media',sellingStyle:'escalona',cashMonths:['10'],usualBuyers:'Coopatrigo',notes:'Prefere visita.'}),id:'p1',createdAt:'2026-08-01T10:00:00Z'}
 const p2={...normalizeProducer({name:'Ana Ünica',municipality:'Bossoroca',area_milho:50,yield_milho:120,fixed_milho:80}),id:'p2',createdAt:'2026-08-02T10:00:00Z'}
 const quotes=[{id:'q1',sourceId:'cvale',sourceName:'C.Vale',commodity:'soja',price:141,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga',observedAt:'2026-09-27T10:00:00Z',status:'active'}]
 const offers=[{id:'o1',producerId:'p1',status:'aceita',closedPrice:146,createdAt:'2026-09-21T10:00:00Z',offer:{commodity:'soja',commodityLabel:'Soja',volumeSc:1000,askingPrice:150,offerPrice:145,asking:{gapSc:-5,status:'ajustavel'},comparison:{cvale:141}}}]
 const requests=[{id:'r1',producerId:'p1',producerName:'João da Silva',commodity:'soja',volume:500,status:'open',createdAt:'2026-09-22T10:00:00Z',closings:[],analysis:{request:{commodityLabel:'Soja',volumeSc:500,targetPriceSc:148},marketReading:{reference:{price:141}}}}]
 const producers=[p1,p2];const portfolio=buildPortfolio({producers,requests,quotes,praca,sources},{now});const askingHistory=buildAskingHistory({producers,offers,requests,quotes},{now})
 const all=producersReport({producers,portfolio,askingHistory,requests,offers,producerOptions,filters:normalizeReportFilters({}),now,user:'Chefe'})
 assert.equal(all.count,2);const p=parse(all.buffer);assert.match(p.text,/Relat\u00f3rio de produtores e carteira/);assert.match(p.text,/Carteira por gr\u00e3o/);assert.match(p.text,/Ficha do produtor \u0097 Jo\u00e3o da Silva/);assert.match(p.text,/Hist\u00f3rico de pedidas/);assert.match(p.text,/Prefere visita/);assert.ok((p.text.match(/\/Type \/Page\b/g)||[]).length>=3)
 const soja=producersReport({producers,portfolio,askingHistory,requests,offers,producerOptions,filters:normalizeReportFilters({commodity:'soja'}),now,detail:false});assert.equal(soja.count,1);assert.equal((soja.buffer.toString('latin1').match(/\/Type \/Page\b/g)||[]).length,1)
 const one=producerReport({producer:p2,portfolio,askingHistory,requests,offers,producerOptions,now});assert.equal(one.count,1);parse(one.buffer);assert.equal(one.filename,'ficha-ana-unica.pdf');assert.match(one.buffer.toString('latin1'),/Milho/)
 const g=generalReport({producers,portfolio,askingHistory,producerOptions,quotes,praca,requests,offers,units:[],readings:[],receipts:[],filters:normalizeReportFilters({}),now});assert.ok(g.count>=4);parse(g.buffer)
})

test('relatório de armazenagem e qualidade: unidades, estoque × padrões, alertas, evolução e leituras',()=>{
 const now=new Date('2026-09-28T12:00:00Z')
 const units=[{id:'u1',name:'Unidade São Luiz',kind:'misto',capacityT:10000,goals:{soja:8000},seasonStart:'2026-09-01',seasonEnd:'2027-05-31'},{id:'u2',name:'Bossoroca',kind:'silo',capacityT:3000,goals:{}}]
 const readings=[{id:'r1',unitId:'u1',commodity:'soja',date:'2026-09-20',quantityT:6000,params:{moisture:13,temperature:21,impurities:0.8}},{id:'r2',unitId:'u1',commodity:'soja',date:'2026-09-27',quantityT:7000,silo:'S1',params:{moisture:14.6,temperature:26,impurities:0.9,damaged:5},notes:'aeração ligada'},{id:'r3',unitId:'u2',commodity:'trigo',date:'2026-09-27',quantityT:900,params:{moisture:12.5,ph:80}}]
 const receipts=[{id:'x1',unitId:'u1',commodity:'soja',date:'2026-09-25',quantityT:200,loads:6,params:{moisture:14}}]
 const r=storageReport({units,readings,receipts,standards:defaultStandards,filters:normalizeReportFilters({}),now,user:'Encarregado'})
 assert.equal(r.count,2);const p=parse(r.buffer);const txt=p.text
 assert.match(txt,/Relat\u00f3rio de armazenagem e qualidade/);assert.match(txt,/Unidades de recebimento/);assert.match(txt,/Estoque e qualidade por unidade/);assert.match(txt,/Padr\u00f5es por cereal/);assert.match(txt,/Padr\u00f5es de qualidade em vigor/);assert.match(txt,/Evolu\u00e7\u00e3o das \u00faltimas leituras/);assert.match(txt,/Leituras registradas no per\u00edodo \\\(3\\\)/);assert.match(txt,/Aten\u00e7\u00e3o/);assert.match(txt,/aera\u00e7\u00e3o ligada/)
 const one=storageReport({units,readings,receipts,standards:defaultStandards,filters:normalizeReportFilters({unitId:'u2',commodity:'trigo'}),now});assert.equal(one.count,1);assert.doesNotMatch(one.buffer.toString('latin1'),/Unidade S\u00e3o Luiz \| Soja/)
 const g=generalReport({units,readings,receipts,standards:defaultStandards,quotes:[],praca:null,requests:[],offers:[],producers:[],filters:normalizeReportFilters({}),now});assert.ok(g.count>=2);parse(g.buffer)
})

test('relatório do mercado agora: cartões por grão, indicadores, concorrentes e leitura do dia',()=>{
 const now=new Date('2026-09-29T12:00:00Z');const praca=loadPraca()
 const q=(d,src,price,extra={})=>({id:src+d,sourceId:src.toLowerCase(),sourceName:src,commodity:'soja',price,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga',observedAt:d,status:'active',...extra})
 const quotes=[q('2026-09-29T10:00:00Z','C.Vale',141,{sourceId:'cvale'}),q('2026-09-29T09:00:00Z','Coopatrigo',143,{automatic:true}),q('2026-09-28T09:00:00Z','Coopatrigo',142),q('2026-09-28T09:00:00Z','C.Vale',140,{sourceId:'cvale'}),q('2026-09-26T09:00:00Z','Bunge',163,{region:'Porto de Rio Grande'}),q('2026-09-29T09:00:00Z','Cotrisal',62,{commodity:'milho'})]
 const indicators={dolar:{label:'Dólar comercial',value:5.1991,display:'R$ 5,1991',changePercent:0.38,observedAt:'2026-09-29T12:00:00.000Z',sourceName:'NA'},'cbot-soja':{label:'Chicago soja',value:1288.5,display:'US$ 12,89/bu',observedAt:'2026-09-29T12:00:00.000Z'}}
 const r=marketReport({quotes,praca,indicators,automation:{lastRun:'2026-09-29T11:00:00Z'},now,user:'Chefe'})
 assert.equal(r.count,2);const p=parse(r.buffer);const txt=p.text
 assert.match(txt,/Mercado agora/);assert.match(txt,/Indicadores \\\(d\u00f3lar e Chicago\\\)/);assert.match(txt,/US\$ 12,89\/bu/);assert.match(txt,/Concorrentes com cota\u00e7\u00e3o/);assert.match(txt,/Coopatrigo/);assert.match(txt,/Leitura do dia/);assert.match(r.filename,/^mercado-agora-2026-09-29/)
 const empty=marketReport({quotes:[],praca,indicators:{},now});assert.equal(empty.count,0);assert.match(empty.buffer.toString('latin1'),/Sem cota\u00e7\u00f5es recentes/)
 const g=generalReport({quotes,praca,indicators,automation:{},producers:[],portfolio:null,askingHistory:[],requests:[],offers:[],units:[],readings:[],receipts:[],filters:normalizeReportFilters({}),now});assert.ok(g.count>=2);parse(g.buffer)
})

test('relatório do painel de originação: KPIs, carteira, concorrência, alvos, agenda, ritmo e fontes',()=>{
 const now=new Date('2026-09-29T12:00:00Z');const praca=loadPraca();const sources=loadSources().sources
 const p1={...normalizeProducer({name:'João da Silva',municipality:'São Luiz Gonzaga',area_soja:200,yield_soja:60,fixed_soja:5,cashMonths:['10']}),id:'p1',createdAt:'2026-08-01T10:00:00Z'}
 const quotes=[{id:'q1',sourceId:'cvale',sourceName:'C.Vale',commodity:'soja',price:141,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga',observedAt:'2026-09-29T10:00:00Z',status:'active'},{id:'q2',sourceId:'coopatrigo',sourceName:'Coopatrigo',commodity:'soja',price:149,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga',observedAt:'2026-09-29T09:00:00Z',status:'active'}]
 const requests=[{id:'r1',producerId:'p1',producerName:'João da Silva',commodity:'soja',volume:500,status:'open',createdAt:'2026-09-22T10:00:00Z',closings:[{price:143,volumeSc:100}],cashNeedBRL:50000,cashDeadline:'2026-10-15',analysis:{request:{commodityLabel:'Soja',volumeSc:500,targetPriceSc:148},marketReading:{reference:{price:141}},closingTargets:[{key:'trigger',label:'Alvo 1',price:141,volumeSc:170,priceUnit:'BRL/sc_60kg',trigger:'Cotação registrada igual ou superior'},{key:'target',label:'Alvo 2',price:148,volumeSc:165,priceUnit:'BRL/sc_60kg'}]}}]
 const portfolio=buildPortfolio({producers:[p1],requests,quotes,praca,sources},{now});const targetHits=checkTargets(requests,quotes,now)
 const r=dashboardReport({portfolio,targetHits,quotes,praca,indicators:{},automation:{lastRun:'2026-09-29T11:00:00Z'},now,user:'Chefe'})
 assert.equal(r.count,portfolio.commodities.length);const p=parse(r.buffer);const txt=p.text
 assert.match(txt,/Painel de origina\u00e7\u00e3o/);assert.match(txt,/Posi\u00e7\u00e3o da carteira por gr\u00e3o/);assert.match(txt,/C\.Vale \u00d7 concorr\u00eancia/);assert.match(txt,/Agenda de fechamentos/);assert.match(txt,/abaixo do ritmo de prote\u00e7\u00e3o/);assert.match(txt,/Cota\u00e7\u00f5es de hoje por fonte/);assert.match(txt,/Jo\u00e3o da Silva/)
 if(targetHits.length)assert.match(txt,/Alvos atingidos por cota\u00e7\u00e3o/)
 const g=generalReport({portfolio,targetHits,quotes,praca,indicators:{},automation:{},producers:[p1],askingHistory:[],requests,offers:[],units:[],readings:[],receipts:[],filters:normalizeReportFilters({}),now});assert.ok(g.count>=3);parse(g.buffer)
})

test('imagem JPEG embutida no PDF (XObject DCTDecode) e relatório do mapa com imagem',async()=>{
 const {createPdf,jpegSize}=await import('../lib/pdf.js');const {mapReport}=await import('../lib/reports.js');const {buildMap}=await import('../lib/geo.js')
 const jpg=Buffer.concat([Buffer.from([0xFF,0xD8,0xFF,0xE0,0,16]),Buffer.from([0x4A,0x46,0x49,0x46,0,1,1,0,0,1,0,1,0,0]),Buffer.from([0xFF,0xC0,0,17,8,0x01,0x2C,0x02,0x58,3,1,0x22,0,2,0x11,1,3,0x11,1]),Buffer.from([0xFF,0xD9])])
 assert.deepEqual(jpegSize(jpg),{width:600,height:300,components:3});assert.equal(jpegSize(Buffer.from('nope')),null)
 const doc=createPdf({title:'t'});doc.addPage();doc.image(40,60,300,150,jpg);const buf=doc.render();const t=buf.toString('latin1')
 assert.match(t,/\/Subtype \/Image \/Width 600 \/Height 300 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode/);assert.match(t,/\/XObject << \/Im1 \d+ 0 R >>/);assert.match(t,/\/Im1 Do Q/)
 const sx=Number(t.match(/startxref\n(\d+)/)[1]);assert.equal(t.slice(sx,sx+4),'xref');const offs=[...t.slice(sx).matchAll(/(\d{10}) 00000 n/g)].map(m=>Number(m[1]));assert.ok(offs.every((o,i)=>t.slice(o,o+String(i+1).length+6)===(i+1)+' 0 obj'))
 assert.throws(()=>doc.image(0,0,10,10,Buffer.from('x')),/JPEG/)
 const map=buildMap({producers:[{id:'p1',name:'João',municipality:'Bossoroca',crops:{}}],units:[]})
 const withImage=mapReport({map,mapImage:{jpeg:jpg,width:600,height:300,layer:'satelite'},now:new Date()});const tx=withImage.buffer.toString('latin1')
 assert.match(tx,/DCTDecode/);assert.match(tx,/Mapa com os pins/);assert.doesNotMatch(tx,/Esquema de posi/)
 const without=mapReport({map,now:new Date()});assert.match(without.buffer.toString('latin1'),/Esquema de posi/);assert.doesNotMatch(without.buffer.toString('latin1'),/DCTDecode/)
})

test('relatório de preços da região: tabela por grão com origem e comparação',async()=>{
 const {regionReport}=await import('../lib/reports.js');const {buildRegionalView,runRegional}=await import('../lib/geo.js')
 const html=`<table><tr><td>Cruz Alta/RS</td><td>146,00</td></tr><tr><td>Santa Rosa/RS (Cotrisal)</td><td>147,00</td></tr></table>`
 const reg=await runRegional([{id:'r1',name:'NA — soja',commodity:'soja',url:'http://x'}],{fetchImpl:async()=>({ok:true,status:200,text:async()=>html}),now:new Date('2026-09-29T12:00:00Z')})
 const quotes=[{commodity:'soja',price:140,priceUnit:'BRL/sc_60kg',sourceId:'cvale',observedAt:'2026-09-29T10:00:00Z',status:'active'},{commodity:'soja',price:143,priceUnit:'BRL/sc_60kg',sourceId:'coopatrigo',sourceName:'Coopatrigo',region:'São Luiz Gonzaga',observedAt:'2026-09-28T10:00:00Z',status:'active'}]
 const regional=buildRegionalView({regional:reg,quotes,sources:[{id:'coopatrigo',name:'Coopatrigo',region:'São Luiz Gonzaga (Coopatrigo)'}],ownSourceId:'cvale',lat:-28.41,lon:-54.96,now:new Date('2026-09-29T12:00:00Z')})
 const out=regionReport({regional,now:new Date('2026-09-29T12:00:00Z'),user:'teste'});const t=out.buffer.toString('latin1')
 assert.equal(out.count,1);assert.match(out.filename,/^precos-regiao-sao-luiz-gonzaga-2026-09-29\.pdf$/)
 for(const needle of ['Soja','Coopatrigo','Cruz Alta/RS','Santa Rosa/RS','147,00','+3,00','tabela p','Leitura'])assert.ok(t.includes(needle)||new RegExp(needle.replace(/[^a-zA-Z0-9,+ ]/g,'.')).test(t),needle)
 const empty=regionReport({regional:buildRegionalView({regional:null,quotes:[]}),now:new Date()});assert.equal(empty.count,0);assert.match(empty.buffer.toString('latin1'),/Nenhuma pra/)
})

test('relatório do histórico de pedidas: por grão, por produtor e lista com dicas',async()=>{
 const {askingReport}=await import('../lib/reports.js');const {buildAskingHistory}=await import('../lib/analysis.js')
 const producers=[{id:'p1',name:'João da Silva'},{id:'p2',name:'Maria'}]
 const quotes=[{commodity:'soja',price:140,priceUnit:'BRL/sc_60kg',sourceId:'cvale',sourceName:'C.Vale — São Luiz Gonzaga',region:'São Luiz Gonzaga (C.Vale)',observedAt:'2026-09-20T12:00:00Z',status:'active'}]
 const offers=[{id:'o1',producerId:'p1',createdAt:'2026-09-21T10:00:00Z',status:'aceita',closedPrice:146,offer:{commodity:'soja',commodityLabel:'Soja',volumeSc:1000,askingPrice:150,offerPrice:145,asking:{gapSc:-5,status:'ajustavel'},comparison:{cvale:140}}},{id:'o2',producerId:'p1',createdAt:'2026-09-25T10:00:00Z',status:'recusada',offer:{commodity:'soja',commodityLabel:'Soja',volumeSc:500,askingPrice:155,offerPrice:146,asking:{gapSc:-9,status:'inviavel'},comparison:{cvale:141}}},{id:'o3',producerId:'p2',createdAt:'2026-09-26T10:00:00Z',status:'enviada',offer:{commodity:'milho',commodityLabel:'Milho',volumeSc:800,askingPrice:62,offerPrice:63,asking:{gapSc:1,status:'atende'},comparison:{cvale:60}}}]
 const requests=[{id:'r1',producerId:'p2',createdAt:'2026-09-22T10:00:00Z',status:'open',commodity:'soja',volume:2000,analysis:{request:{commodityLabel:'Soja',volumeSc:2000,targetPriceSc:148},marketReading:{reference:{price:143}}},closings:[]}]
 const askingHistory=buildAskingHistory({producers,offers,requests,quotes},{now:new Date('2026-09-29T12:00:00Z')})
 assert.equal(askingHistory.length,2)
 const out=askingReport({askingHistory,producers,filters:{},now:new Date('2026-09-29T12:00:00Z'),user:'teste'});const t=out.buffer.toString('latin1')
 assert.equal(out.count,4);assert.match(out.filename,/^historico-pedidas-2026-09-29\.pdf$/)
 for(const needle of ['Hist','pedidas dos produtores','Pedidas por gr','Resumo por produtor','Jo','Maria','Soja','Milho','150,00','155,00','62,00','148,00','Aceita','Recusada','Aceite'])assert.ok(t.includes(needle),needle)
 const onlyMaria=askingReport({askingHistory,producers,filters:{producerId:'p2'},now:new Date()});assert.equal(onlyMaria.count,2);assert.doesNotMatch(onlyMaria.buffer.toString('latin1'),/155,00/)
 const soja=askingReport({askingHistory,producers,filters:{commodity:'soja'},detail:false,now:new Date()});assert.equal(soja.count,3);assert.doesNotMatch(soja.buffer.toString('latin1'),/62,00/)
 const empty=askingReport({askingHistory,producers,filters:{from:'2027-01-01'},now:new Date()});assert.equal(empty.count,0);assert.match(empty.buffer.toString('latin1'),/Nenhuma pedida/)
})

test('relatório do briefing da praça: grãos com momento e cotação, riscos, logística, compradores e fontes',async()=>{
 const {pracaReport}=await import('../lib/reports.js');const {buildBrief,loadPraca,loadSources}=await import('../lib/analysis.js')
 const praca=loadPraca();const quotes=[{commodity:'soja',price:141,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga',sourceName:'Coopatrigo',observedAt:'2026-09-29T10:00:00Z',status:'active'}]
 const brief=buildBrief({praca,quotes},{now:new Date('2026-09-29T12:00:00Z')})
 const out=pracaReport({brief,references:loadSources().references||[],now:new Date('2026-09-29T12:00:00Z'),user:'teste'});const t=out.buffer.toString('latin1')
 assert.equal(out.count,brief.commodities.length);assert.match(out.filename,/^briefing-praca-2026-09-29\.pdf$/)
 for(const needle of ['Briefing da pra','Soja','Coopatrigo','141,00','Riscos acompanhados','Compradores e refer','Cotrisal','Fontes do briefing','Dicas de fechamento'])assert.ok(t.includes(needle),needle)
 const strings=[...t.matchAll(/\(([^)]{3,80})\) Tj/g)].map(x=>x[1]);assert.ok(strings.some(x=>/COTA..O REGISTRADA/.test(x)))
 const empty=pracaReport({brief:null,now:new Date()});assert.equal(empty.count,0)
})
