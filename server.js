import {createServer} from 'node:http'
import {createReadStream,existsSync,statSync} from 'node:fs'
import {dirname,extname,join,normalize,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,timingSafeEqual} from 'node:crypto'
import {createStore} from './lib/store.js'
import {analyzeRequest,buildBrief,buildPortfolio,checkTargets,commodityLabels,loadPraca,loadSources,normalizeProducer,normalizeQuote,normalizeRequest,objectives,producerOptions,text} from './lib/analysis.js'
import {runComparison} from './lib/fetch.js'

const root=dirname(fileURLToPath(import.meta.url))
const publicDir=join(root,'public')
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json'}
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"}

export function createApp({dataDir=process.env.DATA_DIR||join(root,'.data'),accessCode=process.env.ACCESS_CODE||'',fetchImpl=globalThis.fetch,sourcesOverride=null}={}){
 const store=createStore(dataDir)
 const praca=loadPraca()
 const sources=sourcesOverride||loadSources()
 const ownSource=sources.sources.find(item=>item.own)||null
 let comparisonRunning=null
 const refreshComparison=async()=>{
  if(comparisonRunning)return comparisonRunning
  comparisonRunning=runComparison(sources.sources,{fetchImpl}).then(result=>{store.update(data=>{data.comparison=result});return result}).finally(()=>{comparisonRunning=null})
  return comparisonRunning
 }
 const quoteFromCandidate=(source,commodity,candidate,fetchedAt)=>normalizeQuote({sourceId:source.id,commodity,price:candidate.price,priceUnit:candidate.priceUnit,observedAt:candidate.observedDate?`${candidate.observedDate}T12:00:00Z`:fetchedAt,notes:`Leitura automática da página: “${candidate.snippet}”`})
 const json=(response,status,payload)=>{response.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(payload))}
 const body=request=>new Promise((resolvePromise,reject)=>{let raw='';request.on('data',chunk=>{raw+=chunk;if(raw.length>1_000_000){reject(Object.assign(new Error('Requisição muito grande.'),{statusCode:413}));request.destroy()}});request.on('end',()=>{try{resolvePromise(raw?JSON.parse(raw):{})}catch{reject(Object.assign(new Error('Conteúdo inválido.'),{statusCode:400}))}});request.on('error',reject)})
 const authorized=request=>{if(!accessCode)return true;const given=String(request.headers['x-access-code']||'');if(given.length!==accessCode.length)return false;return timingSafeEqual(Buffer.from(given),Buffer.from(accessCode))}
 const producerOf=(store,id)=>store.producers.find(item=>item.id===id)||null
 const withAnalysis=(store,item,now)=>{const producer=producerOf(store,item.producerId);return analyzeRequest({request:item,producer,quotes:store.quotes,praca},{now})}

 const api=async(request,response,url)=>{
  const path=url.pathname
  if(path==='/health'||path==='/api/health')return json(response,200,{status:'ok',service:'graos-missoes',praca:praca.id,protected:Boolean(accessCode)})
  if(path==='/api/session'&&request.method==='GET')return json(response,200,{protected:Boolean(accessCode),authorized:authorized(request)})
  if(!authorized(request))return json(response,401,{error:'Código de acesso inválido.'})
  if(path==='/api/bootstrap'&&request.method==='GET'){
   const data=store.read();const now=new Date()
   const requests=data.requests.map(item=>({...item,producerName:producerOf(data,item.producerId)?.name||'Produtor'})).sort((l,r)=>String(r.createdAt).localeCompare(String(l.createdAt)))
   return json(response,200,{producers:data.producers,quotes:[...data.quotes].sort((l,r)=>String(r.observedAt).localeCompare(String(l.observedAt))),requests,targetHits:checkTargets(requests,data.quotes,now),brief:buildBrief({praca,quotes:data.quotes},{now}),portfolio:buildPortfolio({producers:data.producers,requests,quotes:data.quotes,praca,sources:sources.sources},{now}),comparison:data.comparison||null,ownSource:ownSource?{id:ownSource.id,name:ownSource.name,region:ownSource.region,url:ownSource.url,commodities:ownSource.commodities}:null,catalog:{producerOptions,commodities:Object.entries(commodityLabels).map(([value,label])=>({value,label})),objectives:Object.entries(objectives).map(([value,item])=>({value,label:item.label,note:item.note})),sources:sources.sources,references:sources.references,sourcesVersion:sources.version},praca:{id:praca.id,label:praca.label,updatedAt:praca.updatedAt},governance:{automaticTrading:false,humanReviewRequired:true}})
  }
  if(path==='/api/producers'&&request.method==='POST'){const input=normalizeProducer(await body(request));const saved=store.update(data=>{const record={...input,id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};data.producers.push(record);return record});return json(response,201,{producer:saved})}
  const producerMatch=path.match(/^\/api\/producers\/([0-9a-f-]{36})$/i)
  if(producerMatch&&request.method==='PUT'){const input=normalizeProducer(await body(request));const saved=store.update(data=>{const current=producerOf(data,producerMatch[1]);if(!current)throw Object.assign(new Error('Produtor não encontrado.'),{statusCode:404});Object.assign(current,input,{updatedAt:new Date().toISOString()});return current});return json(response,200,{producer:saved})}
  if(path==='/api/quotes'&&request.method==='POST'){const input=normalizeQuote(await body(request));const saved=store.update(data=>{const record={...input,id:randomUUID(),createdAt:new Date().toISOString()};data.quotes.push(record);data.quotes=data.quotes.slice(-5000);return record});return json(response,201,{quote:saved})}
  const quoteMatch=path.match(/^\/api\/quotes\/([0-9a-f-]{36})$/i)
  if(quoteMatch&&request.method==='DELETE'){store.update(data=>{const quote=data.quotes.find(item=>item.id===quoteMatch[1]);if(!quote)throw Object.assign(new Error('Cotação não encontrada.'),{statusCode:404});quote.status='inactive'});return json(response,200,{removed:true})}
  if(path==='/api/own-quotes'&&request.method==='POST'){
   if(!ownSource)return json(response,400,{error:'Nenhuma fonte própria configurada.'})
   const payload=await body(request);const observedAt=payload.observedAt?new Date(payload.observedAt).toISOString():new Date().toISOString();const saved=[]
   for(const commodity of ownSource.commodities||[]){const price=payload[commodity];if(price===undefined||price===null||price==='')continue;const quote=normalizeQuote({sourceId:ownSource.id,commodity,price,priceUnit:'BRL/sc_60kg',paymentTerms:payload.paymentTerms||'',observedAt,notes:text(payload.notes,400)});saved.push(store.update(data=>{const record={...quote,id:randomUUID(),createdAt:new Date().toISOString()};data.quotes.push(record);data.quotes=data.quotes.slice(-5000);return record}))}
   if(!saved.length)return json(response,400,{error:'Informe ao menos um preço.'})
   return json(response,201,{quotes:saved})
  }
  if(path==='/api/comparison/refresh'&&request.method==='POST'){const result=await refreshComparison();return json(response,200,{comparison:result})}
  if(path==='/api/comparison/save'&&request.method==='POST'){
   const payload=await body(request);const data=store.read();const comparison=data.comparison;if(!comparison)return json(response,400,{error:'Ainda não há leitura automática para salvar.'})
   const wanted=Array.isArray(payload.items)?payload.items:[payload];const saved=[]
   for(const item of wanted){const result=comparison.results.find(r=>r.sourceId===item.sourceId);const source=sources.sources.find(f=>f.id===item.sourceId);const candidate=result?.prices?.[item.commodity];if(!result||!source||!candidate)continue;const quote=quoteFromCandidate(source,item.commodity,candidate,comparison.fetchedAt);saved.push(store.update(d=>{const record={...quote,id:randomUUID(),createdAt:new Date().toISOString(),confidence:Math.max(40,(source.confidence||60)-15),automatic:true};d.quotes.push(record);d.quotes=d.quotes.slice(-5000);return record}))}
   if(!saved.length)return json(response,400,{error:'Nenhum preço lido corresponde ao pedido de salvamento.'})
   return json(response,201,{quotes:saved})
  }
  if(path==='/api/analyze'&&request.method==='POST'){const input=normalizeRequest(await body(request));const data=store.read();const producer=producerOf(data,input.producerId);if(!producer)return json(response,404,{error:'Produtor não encontrado.'});return json(response,200,{analysis:analyzeRequest({request:input,producer,quotes:data.quotes,praca})})}
  if(path==='/api/requests'&&request.method==='POST'){
   const input=normalizeRequest(await body(request))
   const saved=store.update(data=>{const producer=producerOf(data,input.producerId);if(!producer)throw Object.assign(new Error('Produtor não encontrado.'),{statusCode:404});const now=new Date();const record={...input,id:randomUUID(),status:'open',createdAt:now.toISOString(),updatedAt:now.toISOString(),closings:[]};record.analysis=analyzeRequest({request:record,producer,quotes:data.quotes,praca},{now});data.requests.push(record);data.requests=data.requests.slice(-5000);return {...record,producerName:producer.name}})
   return json(response,201,{request:saved})
  }
  const requestMatch=path.match(/^\/api\/requests\/([0-9a-f-]{36})(?:\/(rerun|closings))?$/i)
  if(requestMatch&&requestMatch[2]==='rerun'&&request.method==='POST'){const saved=store.update(data=>{const item=data.requests.find(r=>r.id===requestMatch[1]);if(!item)throw Object.assign(new Error('Pedido não encontrado.'),{statusCode:404});item.analysis=withAnalysis(data,item,new Date());item.updatedAt=new Date().toISOString();return {...item,producerName:producerOf(data,item.producerId)?.name}});return json(response,200,{request:saved})}
  if(requestMatch&&requestMatch[2]==='closings'&&request.method==='POST'){
   const payload=await body(request);const price=Number(String(payload.price||'').replace(',','.'));const volumeSc=Number(String(payload.volumeSc||'').replace(',','.'))
   if(!(price>0)||!(volumeSc>0))return json(response,400,{error:'Informe preço e volume do fechamento.'})
   const saved=store.update(data=>{const item=data.requests.find(r=>r.id===requestMatch[1]);if(!item)throw Object.assign(new Error('Pedido não encontrado.'),{statusCode:404});item.closings.push({id:randomUUID(),price,volumeSc,buyer:text(payload.buyer,160),target:text(payload.target,60),closedAt:new Date().toISOString(),notes:text(payload.notes,1000)});const closed=item.closings.reduce((sum,c)=>sum+c.volumeSc,0);if(closed>=item.analysis.request.volumeSc)item.status='closed';item.updatedAt=new Date().toISOString();return {...item,producerName:producerOf(data,item.producerId)?.name}})
   return json(response,201,{request:saved})
  }
  if(requestMatch&&!requestMatch[2]&&request.method==='PATCH'){const payload=await body(request);const status=text(payload.status,20);if(!['open','closed','cancelled'].includes(status))return json(response,400,{error:'Estado inválido.'});const saved=store.update(data=>{const item=data.requests.find(r=>r.id===requestMatch[1]);if(!item)throw Object.assign(new Error('Pedido não encontrado.'),{statusCode:404});item.status=status;item.updatedAt=new Date().toISOString();return {...item,producerName:producerOf(data,item.producerId)?.name}});return json(response,200,{request:saved})}
  return false
 }

 const serveStatic=(response,url)=>{
  const relative=url.pathname==='/'?'/index.html':url.pathname
  const target=normalize(join(publicDir,relative))
  if(!target.startsWith(publicDir)||!existsSync(target)||statSync(target).isDirectory()){const index=join(publicDir,'index.html');response.writeHead(200,{...headers,'Content-Type':mime['.html']});return createReadStream(index).pipe(response)}
  response.writeHead(200,{...headers,'Content-Type':mime[extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});createReadStream(target).pipe(response)
 }

 const server=createServer(async(request,response)=>{
  const url=new URL(request.url,'http://localhost')
  if(url.pathname.startsWith('/api/')||url.pathname==='/health'){
   try{const handled=await api(request,response,url);if(handled===false)json(response,404,{error:'Rota não encontrada.'})}
   catch(error){json(response,Number(error.statusCode)||400,{error:error.message||'Não foi possível concluir a operação.'})}
   return
  }
  if(request.method!=='GET')return json(response,405,{error:'Método não permitido.'})
  serveStatic(response,url)
 })
 server.refreshComparison=refreshComparison
 return server
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||3000)
 const app=createApp()
 app.listen(port,'0.0.0.0',()=>console.log(`Grãos Missões ouvindo em :${port}`))
 const hours=Number(process.env.AUTO_FETCH_HOURS||4)
 if(hours>0){
  const run=()=>app.refreshComparison().then(result=>{console.log(`Comparativo atualizado: ${result.okCount}/${result.total} fontes lidas`);for(const r of result.results){const prices=Object.entries(r.prices||{}).map(([c,p])=>`${c}=${p.price}${p.priceUnit==='BRL/t'?'/t':''}`).join(' ');console.log(`  ${r.status.padEnd(7)} ${r.name}: ${prices||'-'}${r.pageDate?` (página ${r.pageDate})`:''}${r.error?` — ${r.error}`:''}${r.ms?` [${r.ms} ms]`:''}`)}}).catch(error=>console.error('Comparativo falhou',error.message))
  setTimeout(run,5000);setInterval(run,hours*3_600_000).unref()
 }
}
