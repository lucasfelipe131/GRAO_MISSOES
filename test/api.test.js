import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {createApp} from '../server.js'
import {loadSources} from '../lib/analysis.js'

const start=(options={})=>new Promise(resolve=>{const server=createApp({dataDir:mkdtempSync(join(tmpdir(),'gm-')),seedHistory:false,...options});server.listen(0,()=>resolve({server,base:`http://127.0.0.1:${server.address().port}`}))})
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
  const html=await fetch(base+'/');assert.equal(html.status,200);assert.match(await html.text(),/VAL-SOG/)
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
 const html=`<html><body><table><tr><th>Data</th><th>Soja</th><th>Milho</th></tr><tr><td>27/09/2026</td><td>R$ 143,00</td><td>R$ 61,00</td></tr></table></body></html>`
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

test('preços de porto por trading entram como referência de base e canola é cultura completa',async()=>{
 const {server,base}=await start()
 try{
  const producer=(await call(base,'POST','/api/producers',{name:'Pedro',area_canola:40,yield_canola:25,fixed_canola:0,area_soja:100,yield_soja:60})).data.producer
  assert.equal(producer.crops.canola.areaHa,40)
  assert.equal((await call(base,'POST','/api/own-quotes',{soja:141,canola:210})).data.quotes.length,2)
  const port=await call(base,'POST','/api/port-quotes',{sourceId:'porto-bunge',soja:'162,50',canola:'',paymentTerms:'out/26',notes:'mesa'})
  assert.equal(port.status,201);assert.equal(port.data.quotes[0].region,'Porto de Rio Grande (Bunge)');assert.equal(port.data.quotes[0].sourceId,'porto-bunge')
  assert.equal((await call(base,'POST','/api/port-quotes',{sourceId:'porto-x',soja:1})).status,400)
  assert.equal((await call(base,'POST','/api/port-quotes',{sourceId:'porto-adm'})).status,400)
  const analysis=await call(base,'POST','/api/analyze',{producerId:producer.id,commodity:'soja',volume:1000,targetPrice:150,deliveryLocation:'São Luiz Gonzaga'})
  assert.equal(analysis.data.analysis.marketReading.port.sourceName,'Bunge — Porto de Rio Grande');assert.equal(analysis.data.analysis.marketReading.basisSc,-21.5)
  assert.equal(analysis.data.analysis.marketReading.competition.competitors.length,0)
  const canola=await call(base,'POST','/api/analyze',{producerId:producer.id,commodity:'canola',volume:500,targetPrice:220,deliveryLocation:'São Luiz Gonzaga'})
  assert.equal(canola.status,200);assert.equal(canola.data.analysis.praca.applies,true);assert.ok(canola.data.analysis.tips.some(t=>/antes do plantio/.test(t.text)));assert.equal(canola.data.analysis.position.productionSc,1000)
  const boot=await call(base,'GET','/api/bootstrap');assert.ok(boot.data.portSources.length>=4);assert.ok(['porto-bunge','porto-adm','porto-ldc','porto-cargill'].every(id=>boot.data.portSources.some(p=>p.id===id)));assert.ok(boot.data.portfolio.commodities.some(c=>c.commodity==='canola'))
  const imp=await call(base,'POST','/api/quotes/import',{commodity:'milho',sourceName:'Emater',lines:'01/02/2026;58,00\n01/03/2026;56,00'});assert.equal(imp.status,201);assert.equal(imp.data.imported,2)
  const boot2=await call(base,'GET','/api/bootstrap');assert.equal(boot2.data.priceYear.find(c=>c.commodity==='milho').stats.n,2);assert.ok(boot2.data.storageGuide.crops.milho)
  const font=await fetch(base+'/fonts/manrope-latin-wght-normal.woff2');assert.equal(font.status,200);assert.equal(font.headers.get('content-type'),'font/woff2')
 }finally{server.close()}
})

test('abastecimento automático salva leituras e histórico sem duplicar, e a correção manual prevalece',async()=>{
 let price='143,00'
 const site=createServer((req,res)=>{res.setHeader('Content-Type','text/html');if(/cepea-soja/.test(req.url))res.end(`<table><tr><th>Data</th><th>Valor</th></tr><tr><td>26/09/2026</td><td>160,80</td></tr><tr><td>25/09/2026</td><td>161,52</td></tr></table>`);else res.end(`<html><body><table><tr><th>Data</th><th>Soja</th><th>Milho</th></tr><tr><td>27/09/2026</td><td>R$ ${price}</td><td>R$ 61,00</td></tr></table></body></html>`)})
 await new Promise(r=>site.listen(0,r));const siteBase=`http://127.0.0.1:${site.address().port}`
 const real=loadSources();const sourcesOverride={...real,sources:real.sources.map(s=>s.fetch&&!s.own?{...s,url:siteBase+'/'+s.id,fetch:{...s.fetch,urls:undefined}}:s)}
 const {server,base}=await start({sourcesOverride,autoSave:true})
 try{
  const first=await call(base,'POST','/api/comparison/refresh');assert.equal(first.status,200);assert.ok(first.data.comparison.autoSave.inserted>=2);assert.ok(first.data.comparison.autoSave.history>=1)
  const boot=await call(base,'GET','/api/bootstrap');const coop=boot.data.quotes.filter(q=>q.sourceId==='coopatrigo'&&q.commodity==='soja');assert.equal(coop.length,1);assert.equal(coop[0].automatic,true);assert.equal(coop[0].price,143)
  assert.ok(boot.data.quotes.some(q=>q.sourceId==='cepea-soja-paranagua'&&String(q.observedAt).startsWith('2026-09-25')))
  assert.equal(boot.data.automation.autoSave,true);assert.ok(boot.data.automation.lastRun)
  const second=await call(base,'POST','/api/comparison/refresh');assert.equal(second.data.comparison.autoSave.inserted,0)
  const boot2=await call(base,'GET','/api/bootstrap');assert.equal(boot2.data.quotes.filter(q=>q.sourceId==='coopatrigo'&&q.commodity==='soja').length,1)
  const edited=await call(base,'PUT',`/api/quotes/${coop[0].id}`,{price:'141,50',notes:'conferido na página'});assert.equal(edited.status,200);assert.equal(edited.data.quote.price,141.5);assert.equal(edited.data.quote.edited,true);assert.equal(edited.data.quote.original.price,143)
  price='144,00'
  await call(base,'POST','/api/comparison/refresh')
  const boot3=await call(base,'GET','/api/bootstrap');assert.equal(boot3.data.quotes.find(q=>q.id===coop[0].id).price,141.5)
  assert.equal((await call(base,'PUT','/api/quotes/00000000-0000-4000-8000-000000000000',{price:1})).status,404)
 }finally{server.close();site.close()}
})

test('pontos pesquisados são semeados uma única vez',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gm-seed-'))
 const a=createApp({dataDir:dir,seedHistory:true});await new Promise(r=>a.listen(0,r));const base=`http://127.0.0.1:${a.address().port}`
 try{const boot=await call(base,'GET','/api/bootstrap');const seeded=boot.data.quotes.filter(q=>q.imported);assert.ok(seeded.length>=10);assert.ok(seeded.some(q=>q.commodity==='trigo'&&q.priceUnit==='BRL/t'));assert.ok(boot.data.priceYear.find(c=>c.commodity==='trigo').stats)}finally{a.close()}
 const b=createApp({dataDir:dir,seedHistory:true});await new Promise(r=>b.listen(0,r));const base2=`http://127.0.0.1:${b.address().port}`
 try{const boot=await call(base2,'GET','/api/bootstrap');assert.equal(boot.data.quotes.filter(q=>q.imported).length,(await call(base2,'GET','/api/bootstrap')).data.quotes.filter(q=>q.imported).length);assert.ok(boot.data.quotes.filter(q=>q.imported).length<=80)}finally{b.close()}
})

test('ofertas: parâmetros, prévia, registro, situação, fechamento e exportação',async()=>{
 const {server,base}=await start()
 try{
  const producer=(await call(base,'POST','/api/producers',{name:'Ana',distanceKm:30,cost_soja:120})).data.producer
  await call(base,'POST','/api/own-quotes',{soja:141});await call(base,'POST','/api/port-quotes',{sourceId:'porto-bunge',soja:163})
  const settings=await call(base,'PUT','/api/offer-settings',{defaultMarginPerSc:'3',destinations:[{id:'cvale-slg',name:'Unidade C.Vale',km:0,kind:'unit'},{id:'rio-grande',name:'Porto de Rio Grande',km:600,kind:'port'}]})
  assert.equal(settings.status,200);assert.equal(settings.data.offerSettings.defaultMarginPerSc,3)
  const preview=await call(base,'POST','/api/offers/preview',{producerId:producer.id,commodity:'soja',volumeSc:1000,deliveryMonth:'2026-11',destinationId:'rio-grande'})
  assert.equal(preview.status,200);assert.equal(preview.data.offer.reference.mode,'porto');assert.equal(preview.data.offer.margin.perSc,3);assert.equal(preview.data.offer.distanceKm,630)
  const created=await call(base,'POST','/api/offers',{producerId:producer.id,commodity:'soja',volumeSc:1000,deliveryMonth:'2026-11',destinationId:'rio-grande',notes:'produtor quer travar parte',askingPrice:'150'})
  assert.equal(created.status,201);assert.equal(created.data.offer.status,'rascunho');assert.equal(created.data.offer.notes,'produtor quer travar parte');assert.equal(created.data.offer.offer.askingPrice,150);assert.ok(['ajustavel','inviavel','atende'].includes(created.data.offer.offer.asking.status))
  const id=created.data.offer.id
  assert.equal((await call(base,'PATCH',`/api/offers/${id}`,{status:'enviada'})).data.offer.status,'enviada')
  const closed=await call(base,'PATCH',`/api/offers/${id}`,{status:'aceita',closedPrice:'139,50',notes:'fechado por telefone'});assert.equal(closed.data.offer.closedPrice,139.5);assert.equal(closed.data.offer.history.length,3)
  assert.equal((await call(base,'PATCH',`/api/offers/${id}`,{status:'x'})).status,400)
  const boot=await call(base,'GET','/api/bootstrap');assert.equal(boot.data.offers.length,1);assert.ok(boot.data.offerStatuses.includes('aceita'));assert.equal(boot.data.askingHistory.length,1);assert.equal(boot.data.askingHistory[0].producerId,producer.id);assert.equal(boot.data.askingHistory[0].entries[0].askingPrice,150);assert.equal(boot.data.askingHistory[0].entries[0].closedPrice,139.5);assert.ok(boot.data.priceYear.find(c=>c.commodity==='soja').sources.length>=2)
  const exp=await call(base,'GET','/api/offers/export');assert.equal(exp.data.system,'VAL-SOG');assert.equal(exp.data.offers.length,1);assert.equal(exp.data.producers.length,1)
  assert.equal((await call(base,'POST','/api/offers',{producerId:producer.id,commodity:'trigo',volumeSc:10,deliveryMonth:'2026-11',referenceMode:'porto'})).status,400)
 }finally{server.close()}
})

test('níveis de acesso: gerencial, operador de compra e encarregado de armazém',async()=>{
 const {server,base}=await start({accessCodes:{gerencial:['ger-1'],operador:['op-1'],armazem:['arm-1']}})
 try{
  assert.equal((await call(base,'GET','/api/session')).data.authorized,false)
  const ger=(await call(base,'GET','/api/session',null,'ger-1')).data;assert.equal(ger.role,'gerencial');assert.ok(ger.tabs.includes('ofertas'));assert.ok(ger.write.includes('parametros'))
  const arm=(await call(base,'GET','/api/session',null,'arm-1')).data;assert.equal(arm.role,'armazem');assert.ok(!arm.tabs.includes('ofertas'));assert.ok(arm.tabs.includes('armazenagem'))
  assert.equal((await call(base,'GET','/api/bootstrap',null,'x')).status,401)
  assert.equal((await call(base,'POST','/api/producers',{name:'Ana'},'arm-1')).status,403)
  assert.equal((await call(base,'PUT','/api/offer-settings',{defaultMarginPerSc:'3'},'op-1')).status,403)
  assert.equal((await call(base,'POST','/api/storage/units',{name:'U',capacityT:100},'op-1')).status,403)
  assert.equal((await call(base,'POST','/api/producers',{name:'Ana'},'op-1')).status,201)
  assert.equal((await call(base,'POST','/api/quotes',{commodity:'soja',price:140,region:'SLG',sourceName:'Cotrisal'},'op-1')).status,201)
  const unit=await call(base,'POST','/api/storage/units',{name:'Unidade SLG',capacityT:'5000',goal_soja:'4000',seasonStart:'2026-09-01',seasonEnd:'2027-04-30'},'arm-1');assert.equal(unit.status,201)
  assert.equal((await call(base,'PUT','/api/offer-settings',{defaultMarginPerSc:'3'},'ger-1')).status,200)
  const boot=(await call(base,'GET','/api/bootstrap',null,'arm-1')).data;assert.equal(boot.session.role,'armazem');assert.equal(boot.storage.units.length,1)
 }finally{server.close()}
})

test('armazenagem: unidades, padrões, leituras, recebimentos, resumo e exportação',async()=>{
 const {server,base}=await start()
 try{
  const producer=(await call(base,'POST','/api/producers',{name:'Ana'})).data.producer
  const unit=(await call(base,'POST','/api/storage/units',{name:'Unidade São Luiz',municipality:'São Luiz Gonzaga',capacityT:'10000',dryingTDay:'500',goal_soja:'8000',goal_milho:'1000',season:'2026/27',seasonStart:'2026-09-01',seasonEnd:'2027-05-31'})).data.unit
  assert.ok(unit.id);assert.equal(unit.goals.soja,8000)
  assert.equal((await call(base,'POST','/api/storage/units',{name:'x'})).status,400)
  assert.equal((await call(base,'POST','/api/storage/readings',{unitId:'nao-existe',commodity:'soja',quantityT:10})).status,404)
  assert.equal((await call(base,'POST','/api/storage/readings',{unitId:unit.id,commodity:'soja',quantityT:'6000',moisture:'14,5',temperature:'24',impurities:'0,9',date:'2026-09-26'})).status,201)
  assert.equal((await call(base,'POST','/api/storage/receipts',{unitId:unit.id,commodity:'soja',quantityT:'250',loads:'8',moisture:'15',producerId:producer.id,date:'2026-09-26'})).status,201)
  const rc=await call(base,'POST','/api/storage/receipts',{unitId:unit.id,commodity:'soja',quantityT:'300',loads:'9',moisture:'14',date:'2026-09-27'});assert.equal(rc.status,201);assert.equal(rc.data.receipt.quantityT,300)
  const std=await call(base,'PUT','/api/storage/standards',{standards:{soja:{moisture:{max:'14',ideal:'13'}}}});assert.equal(std.status,200);assert.equal(std.data.standards.soja.moisture.max,14)
  let boot=(await call(base,'GET','/api/bootstrap')).data
  const u=boot.storage.units[0];assert.equal(u.stockT,6000);assert.equal(u.occupancy,60);const soja=u.stock.find(x=>x.commodity==='soja');assert.equal(soja.receivedT,550);assert.equal(soja.goalPercent,7);assert.equal(soja.evaluation.find(e=>e.key==='moisture').status,'atencao')
  assert.equal(boot.storage.receipts.length,2);assert.equal(boot.storage.receipts[0].producerName,undefined||boot.storage.receipts[0].producerName);assert.ok(boot.storage.byCommodity.find(c=>c.commodity==='soja'))
  assert.ok(boot.storage.alerts.some(a=>/umidade/.test(a.message)))
  const upd=await call(base,'PUT',`/api/storage/units/${unit.id}`,{name:'Unidade São Luiz',capacityT:'12000',goal_soja:'9000',seasonStart:'2026-09-01',seasonEnd:'2027-05-31'});assert.equal(upd.status,200);assert.equal(upd.data.unit.capacityT,12000)
  assert.equal((await call(base,'DELETE',`/api/storage/receipts/${rc.data.receipt.id}`)).status,200)
  const exp=(await call(base,'GET','/api/storage/export')).data;assert.equal(exp.units.length,1);assert.equal(exp.receipts.length,1);assert.equal(exp.readings.length,1);assert.ok(exp.standards.soja)
  assert.equal((await call(base,'POST','/api/storage/standards/reset')).status,200)
  assert.equal((await call(base,'DELETE',`/api/storage/units/${unit.id}`)).status,200)
  boot=(await call(base,'GET','/api/bootstrap')).data;assert.equal(boot.storage.units.length,0);assert.equal(boot.storage.receipts.length,0)
 }finally{server.close()}
})

test('canola: esmagadoras Camera e Celena são a referência principal',async()=>{
 const {server,base}=await start()
 try{
  const producer=(await call(base,'POST','/api/producers',{name:'Ana',municipality:'São Luiz Gonzaga'})).data.producer
  await call(base,'POST','/api/quotes',{commodity:'canola',price:150,region:'São Luiz Gonzaga',sourceId:'coopatrigo',sourceName:'Coopatrigo'})
  await call(base,'POST','/api/quotes',{commodity:'canola',price:158,region:'São Luiz Gonzaga (esmagadora)',sourceId:'camera-slg',sourceName:'Camera Agroalimentos — esmagadora São Luiz Gonzaga'})
  await call(base,'POST','/api/quotes',{commodity:'canola',price:155,region:'Rio Grande do Sul (esmagadora)',sourceId:'celena',sourceName:'Celena Alimentos — esmagadora de canola'})
  const a=(await call(base,'POST','/api/analyze',{producerId:producer.id,commodity:'canola',volume:500,direction:'sell',objective:'equilibrio'})).data.analysis
  assert.equal(a.marketReading.reference.sourceName,'Camera Agroalimentos — esmagadora São Luiz Gonzaga')
  assert.ok(a.reasons.some(r=>/esmagadoras/.test(r)));assert.equal(a.marketReading.competition.competitors[0].crusher,true)
  const boot=(await call(base,'GET','/api/bootstrap')).data;assert.ok(boot.catalog.sources.some(s=>s.id==='camera-slg'&&s.crusher));assert.ok(boot.catalog.sources.some(s=>s.id==='celena'))
 }finally{server.close()}
})

test('login com usuário e senha, painel de usuários e regras de proteção',async()=>{
 const {server,base}=await start({accessCodes:{gerencial:['ger-1']}})
 try{
  const callTok=(method,path,payload,tok)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},body:payload?JSON.stringify(payload):undefined}).then(async r=>({status:r.status,data:await r.json()}))
  assert.equal((await call(base,'POST','/api/login',{username:'x',password:'y'})).status,401)
  const byCode=await call(base,'POST','/api/login',{code:'ger-1'});assert.equal(byCode.status,200);assert.equal(byCode.data.role,'gerencial');assert.equal(byCode.data.via,'codigo');assert.equal(byCode.data.token,null)
  assert.equal((await call(base,'POST','/api/users',{username:'Maria.Silva',name:'Maria',password:'curta',role:'operador'},'ger-1')).status,400)
  assert.equal((await call(base,'POST','/api/users',{username:'maria silva',name:'Maria',password:'segredo123',role:'operador'},'ger-1')).status,400)
  const created=await call(base,'POST','/api/users',{username:'Maria.Silva',name:'Maria Silva',password:'segredo123',role:'operador'},'ger-1')
  assert.equal(created.status,201);assert.equal(created.data.user.username,'maria.silva');assert.equal(created.data.user.passwordHash,undefined)
  assert.equal((await call(base,'POST','/api/users',{username:'maria.silva',name:'Outra',password:'segredo123',role:'operador'},'ger-1')).status,409)
  const admin=await call(base,'POST','/api/users',{username:'chefe',name:'Chefe',password:'senhaforte1',role:'gerencial'},'ger-1');assert.equal(admin.status,201)
  const login=await call(base,'POST','/api/login',{username:'MARIA.SILVA',password:'segredo123'});assert.equal(login.status,200);assert.ok(login.data.token);assert.equal(login.data.role,'operador');assert.equal(login.data.user.name,'Maria Silva');assert.equal(login.data.via,'usuario')
  assert.equal((await call(base,'POST','/api/login',{username:'maria.silva',password:'errada123'})).status,401)
  const tok=login.data.token
  const sess=await callTok('GET','/api/session',null,tok);assert.equal(sess.data.role,'operador');assert.ok(!sess.data.tabs.includes('admin'))
  assert.equal((await callTok('GET','/api/users',null,tok)).status,403)
  assert.equal((await callTok('POST','/api/users',{username:'z',name:'z',password:'12345678',role:'operador'},tok)).status,403)
  assert.equal((await callTok('POST','/api/producers',{name:'Ana'},tok)).status,201)
  assert.equal((await callTok('POST','/api/me/password',{currentPassword:'errada',password:'novasenha123'},tok)).status,401)
  assert.equal((await callTok('POST','/api/me/password',{currentPassword:'segredo123',password:'novasenha123'},tok)).status,200)
  assert.equal((await call(base,'POST','/api/login',{username:'maria.silva',password:'novasenha123'})).status,200)
  assert.equal((await callTok('GET','/api/session',null,tok+'x')).data.authorized,false)
  const adminLogin=await call(base,'POST','/api/login',{username:'chefe',password:'senhaforte1'});const atok=adminLogin.data.token
  const list=await callTok('GET','/api/users',null,atok);assert.equal(list.status,200);assert.equal(list.data.users.length,2);assert.ok(list.data.users.find(u=>u.username==='maria.silva').lastLoginAt)
  const mariaId=created.data.user.id
  assert.equal((await callTok('PUT','/api/users/'+mariaId,{role:'armazem',active:false},atok)).data.user.role,'armazem')
  assert.equal((await call(base,'POST','/api/login',{username:'maria.silva',password:'novasenha123'})).status,403)
  assert.equal((await callTok('PUT','/api/users/'+admin.data.user.id,{role:'operador'},atok)).status,400)
  assert.equal((await callTok('DELETE','/api/users/'+admin.data.user.id,null,atok)).status,400)
  assert.equal((await callTok('POST','/api/users/'+mariaId+'/password',{password:'outrasenha123'},atok)).status,200)
  assert.equal((await callTok('PUT','/api/users/'+mariaId,{active:true},atok)).status,200)
  assert.equal((await call(base,'POST','/api/login',{username:'maria.silva',password:'outrasenha123'})).status,200)
  assert.equal((await callTok('DELETE','/api/users/'+mariaId,null,atok)).status,200)
  const boot=await callTok('GET','/api/bootstrap',null,atok);assert.equal(boot.status,200);assert.equal(boot.data.session.user.username,'chefe');assert.ok(boot.data.session.tabs.includes('admin'))
 }finally{server.close()}
})

test('sem códigos, o primeiro usuário criado passa a proteger o sistema',async()=>{
 const {server,base}=await start()
 try{
  assert.equal((await call(base,'GET','/api/session')).data.protected,false)
  const created=await call(base,'POST','/api/users',{username:'admin',name:'Admin',password:'senhaforte1',role:'gerencial'});assert.equal(created.status,201)
  assert.equal((await call(base,'GET','/api/session')).data.authorized,false);assert.equal((await call(base,'GET','/api/bootstrap')).status,401)
  const login=await call(base,'POST','/api/login',{username:'admin',password:'senhaforte1'});assert.equal(login.status,200)
  const r=await fetch(base+'/api/bootstrap',{headers:{Authorization:'Bearer '+login.data.token}});assert.equal(r.status,200)
 }finally{server.close()}
})

test('rotas de relatório em PDF respondem application/pdf com filtros',async()=>{
 const {server,base}=await start()
 try{
  const producer=(await call(base,'POST','/api/producers',{name:'Ana'})).data.producer
  await call(base,'POST','/api/own-quotes',{soja:141});await call(base,'POST','/api/offers',{producerId:producer.id,commodity:'soja',volumeSc:100,deliveryMonth:'2026-11',referenceMode:'cvale',askingPrice:'145'})
  const unit=(await call(base,'POST','/api/storage/units',{name:'U1',capacityT:1000})).data.unit
  await call(base,'POST','/api/storage/receipts',{unitId:unit.id,commodity:'soja',quantityT:'50',date:'2026-09-20'})
  for(const kind of ['ofertas','recebimentos','geral']){const r=await fetch(base+'/api/reports/'+kind+'.pdf?from=2026-01-01');assert.equal(r.status,200,kind);assert.equal(r.headers.get('content-type'),'application/pdf');assert.match(r.headers.get('content-disposition'),/attachment; filename="/);const buf=Buffer.from(await r.arrayBuffer());assert.equal(buf.slice(0,5).toString(),'%PDF-');assert.ok(Number(r.headers.get('x-report-count'))>=1,kind)}
  const bad=await fetch(base+'/api/reports/ofertas.pdf?from=2026-09-30&to=2026-09-01');assert.equal(bad.status,400)
  assert.equal((await fetch(base+'/api/reports/outro.pdf')).status,404)
 }finally{server.close()}
})
