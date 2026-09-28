import {createServer} from 'node:http'
import {createReadStream,existsSync,statSync} from 'node:fs'
import {dirname,extname,join,normalize,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID,timingSafeEqual} from 'node:crypto'
import {createStore} from './lib/store.js'
import {hashPassword,makeToken,normalizeUserInput,publicUser,verifyPassword,verifyToken} from './lib/auth.js'
import {generalReport,normalizeReportFilters,offersReport,quotesReport,receiptsReport,requestReport,requestsReport} from './lib/reports.js'
import {buildStorageSummary,defaultStandards,normalizeReading,normalizeReceipt,normalizeStandards,normalizeUnit} from './lib/storage.js'
import {analyzeRequest,buildAskingHistory,buildBrief,buildPortfolio,buildPriceYear,checkTargets,commodityLabels,loadPraca,loadSources,loadStorageGuide,normalizeImportLines,normalizeProducer,normalizeQuote,normalizeRequest,objectives,producerOptions,text} from './lib/analysis.js'
import {runComparison} from './lib/fetch.js'
import {buildOffer,defaultOfferSettings,normalizeOfferInput,normalizeOfferSettings,normalizeOfferStatus,offerStatuses} from './lib/offers.js'
import {readFileSync as readFile} from 'node:fs'

const root=dirname(fileURLToPath(import.meta.url))
const publicDir=join(root,'public')
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2'}
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"}

const splitCodes=v=>String(v||'').split(',').map(x=>x.trim()).filter(Boolean)
export const roles={
 gerencial:{label:'Gerencial',tabs:['painel','pedidos','cotacoes','produtores','ofertas','precos','armazenagem','praca','admin'],write:['comercial','parametros','armazem','cotacoes','usuarios']},
 operador:{label:'Operador de compra de grãos',tabs:['painel','pedidos','cotacoes','produtores','ofertas','precos','armazenagem','praca'],write:['comercial','cotacoes']},
 armazem:{label:'Encarregado de armazém',tabs:['painel','cotacoes','precos','armazenagem','praca'],write:['armazem']}
}
export function createApp({dataDir=process.env.DATA_DIR||join(root,'.data'),accessCode=process.env.ACCESS_CODE||'',accessCodes=null,fetchImpl=globalThis.fetch,sourcesOverride=null,autoSave=!/^(0|false|off|nao|não)$/i.test(String(process.env.AUTO_SAVE||'true')),seedHistory=true}={}){
 const store=createStore(dataDir)
 const praca=loadPraca()
 const sources=sourcesOverride||loadSources()
 const ownSource=sources.sources.find(item=>item.own)||null
 const portSources=sources.sources.filter(item=>item.port)
 const storageGuide=loadStorageGuide()
 let comparisonRunning=null
 const upsertAutomatic=(data,source,commodity,price,priceUnit,iso,snippet,kind)=>{
  const observedAt=`${iso}T12:00:00.000Z`
  const existing=data.quotes.find(q=>q.sourceId===source.id&&q.commodity===commodity&&String(q.observedAt).slice(0,10)===iso&&q.status!=='inactive')
  if(existing){if(existing.edited)return 'kept';if(Number(existing.price)!==Number(price)||existing.priceUnit!==priceUnit){existing.price=price;existing.priceUnit=priceUnit;existing.notes=`Leitura automática (${kind}): “${snippet}”`;existing.updatedAt=new Date().toISOString();return 'updated'}return 'same'}
  data.quotes.push({commodity,price,priceUnit,region:source.region,sourceName:source.name,sourceUrl:source.url,observedAt,marketKind:source.marketKind||'spot',paymentTerms:source.paymentTerms||'',notes:`Leitura automática (${kind}): “${snippet}”`,sourceId:source.id,sourceType:source.type,confidence:Math.max(40,(source.confidence||60)-15),automatic:true,status:'active',id:randomUUID(),createdAt:new Date().toISOString()})
  return 'inserted'
 }
 const applyAutoSave=result=>{
  const summary={inserted:0,updated:0,kept:0,history:0}
  store.update(data=>{
   for(const r of result.results){
    const source=sources.sources.find(f=>f.id===r.sourceId);if(!source||r.status!=='ok')continue
    const today=result.fetchedAt.slice(0,10)
    for(const [commodity,p] of Object.entries(r.prices||{})){const iso=p.observedDate||r.pageDate||today;const outcome=upsertAutomatic(data,source,commodity,p.price,p.priceUnit||source.priceUnit,iso,p.snippet||'',`${source.name}`);summary[outcome==='same'?'kept':outcome]++}
    for(const h of r.history||[]){const outcome=upsertAutomatic(data,source,h.commodity,h.price,source.fetch?.priceUnit||source.priceUnit,h.date,h.snippet||'','histórico');if(outcome==='inserted')summary.history++}
   }
   data.quotes=data.quotes.slice(-30000)
   data.automation={autoSave,lastRun:result.fetchedAt,lastSummary:summary}
  })
  return summary
 }
 const refreshComparison=async()=>{
  if(comparisonRunning)return comparisonRunning
  comparisonRunning=runComparison(sources.sources,{fetchImpl}).then(result=>{store.update(data=>{data.comparison=result});if(autoSave)result.autoSave=applyAutoSave(result);return result}).finally(()=>{comparisonRunning=null})
  return comparisonRunning
 }
 if(seedHistory){try{const seed=JSON.parse(readFile(join(root,'data','historico.json'),'utf8'));store.update(data=>{if(data.seededHistory===seed.version)return;for(const pt of seed.points||[]){const iso=pt.date;if(data.quotes.some(q=>q.sourceName===pt.sourceName&&q.commodity===pt.commodity&&String(q.observedAt).slice(0,10)===iso))continue;data.quotes.push({commodity:pt.commodity,price:pt.price,priceUnit:pt.priceUnit,region:pt.region,sourceName:pt.sourceName,sourceUrl:pt.sourceUrl||'',observedAt:`${iso}T12:00:00.000Z`,marketKind:'spot',paymentTerms:'',notes:`${pt.notes||''} — ponto pesquisado (${seed.version})`,sourceId:'',sourceType:'research',confidence:65,imported:true,status:'active',id:randomUUID(),createdAt:new Date().toISOString()})}data.seededHistory=seed.version})}catch(error){console.error('Semeadura do histórico falhou',error.message)}}
 const quoteFromCandidate=(source,commodity,candidate,fetchedAt)=>normalizeQuote({sourceId:source.id,commodity,price:candidate.price,priceUnit:candidate.priceUnit,observedAt:candidate.observedDate?`${candidate.observedDate}T12:00:00Z`:fetchedAt,notes:`Leitura automática da página: “${candidate.snippet}”`})
 const json=(response,status,payload)=>{response.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(payload))}
 const body=request=>new Promise((resolvePromise,reject)=>{let raw='';request.on('data',chunk=>{raw+=chunk;if(raw.length>1_000_000){reject(Object.assign(new Error('Requisição muito grande.'),{statusCode:413}));request.destroy()}});request.on('end',()=>{try{resolvePromise(raw?JSON.parse(raw):{})}catch{reject(Object.assign(new Error('Conteúdo inválido.'),{statusCode:400}))}});request.on('error',reject)})
 const codes={gerencial:[...splitCodes(accessCode),...splitCodes(process.env.ACCESS_CODE_GERENCIAL),...(accessCodes?.gerencial||[])],operador:[...splitCodes(process.env.ACCESS_CODE_OPERADOR),...(accessCodes?.operador||[])],armazem:[...splitCodes(process.env.ACCESS_CODE_ARMAZEM),...(accessCodes?.armazem||[])]}
 const sameCode=(given,expected)=>given.length===expected.length&&timingSafeEqual(Buffer.from(given),Buffer.from(expected))
 const authSecret=()=>{if(process.env.SESSION_SECRET)return process.env.SESSION_SECRET;const data=store.read();if(data.authSecret)return data.authSecret;return store.update(d=>{d.authSecret=d.authSecret||randomUUID()+randomUUID();return d.authSecret})}
 const activeUsers=data=>(data.users||[]).filter(u=>u.active!==false)
 const isProtected=()=>Object.values(codes).some(list=>list.length)||activeUsers(store.read()).length>0
 const identify=request=>{
  if(request._identity!==undefined)return request._identity
  const data=store.read();const protectedApp=isProtected()
  if(!protectedApp){request._identity={role:'gerencial',user:null,via:'aberto'};return request._identity}
  const auth=String(request.headers.authorization||'');const token=auth.startsWith('Bearer ')?auth.slice(7).trim():String(request.headers['x-session']||'')
  if(token){const t=verifyToken(token,authSecret());const user=t&&(data.users||[]).find(u=>u.id===t.userId&&u.active!==false);if(user&&roles[user.role]){request._identity={role:user.role,user,via:'usuario'};return request._identity}}
  const given=String(request.headers['x-access-code']||'')
  if(given){for(const role of ['gerencial','operador','armazem'])if(codes[role].some(c=>sameCode(given,c))){request._identity={role,user:null,via:'codigo'};return request._identity}}
  request._identity=null;return null
 }
 const roleOf=request=>identify(request)?.role||null
 const authorized=request=>Boolean(roleOf(request))
 const areaOf=(path,method)=>{if(method==='GET')return null;if(path==='/api/me/password'||path==='/api/logout')return null;if(path.startsWith('/api/users'))return 'usuarios';if(path.startsWith('/api/storage'))return 'armazem';if(path==='/api/offer-settings')return 'parametros';if(path.startsWith('/api/quotes')||path.startsWith('/api/own-quotes')||path.startsWith('/api/port-quotes')||path.startsWith('/api/comparison'))return 'cotacoes';return 'comercial'}
 const sessionInfo=request=>{const id=identify(request);const role=id?.role||null;const data=store.read();return {protected:isProtected(),authorized:Boolean(role),role,roleLabel:role?roles[role].label:null,via:id?.via||null,user:id?.user?{id:id.user.id,username:id.user.username,name:id.user.name}:null,tabs:role?roles[role].tabs:[],write:role?roles[role].write:[],usersCount:(data.users||[]).length,codesConfigured:Object.values(codes).some(list=>list.length),roles:Object.fromEntries(Object.entries(roles).map(([k,v])=>[k,{label:v.label,tabs:v.tabs,write:v.write,configured:codes[k].length>0}]))}}
 const producerOf=(store,id)=>store.producers.find(item=>item.id===id)||null
 const withAnalysis=(store,item,now)=>{const producer=producerOf(store,item.producerId);return analyzeRequest({request:item,producer,quotes:store.quotes,praca},{now})}

 const api=async(request,response,url)=>{
  const path=url.pathname
  if(path==='/health'||path==='/api/health')return json(response,200,{status:'ok',service:'graos-missoes',praca:praca.id,protected:Boolean(accessCode)})
  if(path==='/api/session'&&request.method==='GET')return json(response,200,sessionInfo(request))
  if(path==='/api/login'&&request.method==='POST'){
   const payload=await body(request);const username=text(payload.username,40).toLowerCase();const password=String(payload.password??'')
   if(payload.code&&!username){request.headers['x-access-code']=String(payload.code);request._identity=undefined;const info=sessionInfo(request);if(!info.authorized)return json(response,401,{error:'Código de acesso inválido.'});return json(response,200,{...info,token:null,code:String(payload.code)})}
   if(!username||!password)return json(response,400,{error:'Informe usuário e senha.'})
   const data=store.read();const user=(data.users||[]).find(u=>u.username===username)
   if(!user||!verifyPassword(password,user.passwordHash))return json(response,401,{error:'Usuário ou senha inválidos.'})
   if(user.active===false)return json(response,403,{error:'Usuário desativado. Fale com o gerencial.'})
   store.update(d=>{const u=d.users.find(x=>x.id===user.id);if(u)u.lastLoginAt=new Date().toISOString()})
   const token=makeToken(user.id,authSecret());request.headers.authorization=`Bearer ${token}`;request._identity=undefined
   return json(response,200,{...sessionInfo(request),token})
  }
  const role=roleOf(request);if(!role)return json(response,401,{error:'Código de acesso inválido.'})
  if(path==='/api/logout'&&request.method==='POST')return json(response,200,{ok:true})
  const singleRequest=path.match(/^\/api\/reports\/pedido\/([0-9a-f-]{36})\.pdf$/i)
  if(singleRequest&&request.method==='GET'){const data=store.read();const item=data.requests.find(r=>r.id===singleRequest[1]);if(!item)return json(response,404,{error:'Pedido não encontrado.'});const id=identify(request);const user=id?.user?.name||id?.user?.username||(id?.via==='codigo'?'código da equipe':'');const out=requestReport({request:{...item,producerName:producerOf(data,item.producerId)?.name||'Produtor'},now:new Date(),user});response.writeHead(200,{...headers,'Content-Type':'application/pdf','Content-Disposition':`${url.searchParams.get('inline')?'inline':'attachment'}; filename="${out.filename}"`,'Content-Length':out.buffer.length,'Cache-Control':'no-store','X-Report-Count':'1'});response.end(out.buffer);return true}
  const reportMatch=path.match(/^\/api\/reports\/(ofertas|recebimentos|pedidos|cotacoes|geral)\.pdf$/)
  if(reportMatch&&request.method==='GET'){
   const filters=normalizeReportFilters(Object.fromEntries(url.searchParams.entries()));const data=store.read();const id=identify(request);const user=id?.user?.name||id?.user?.username||(id?.via==='codigo'?'código da equipe':'')
   const args={quotes:data.quotes,praca,requests:data.requests.map(r=>({...r,producerName:producerOf(data,r.producerId)?.name||'Produtor'})),offers:(data.offers||[]).map(o=>({...o,producerName:o.producerName||producerOf(data,o.producerId)?.name||'Produtor'})),producers:data.producers,units:data.storageUnits||[],readings:data.storageReadings||[],receipts:data.storageReceipts||[],standards:{...defaultStandards,...(data.storageStandards||{})},filters,now:new Date(),user}
   const out=reportMatch[1]==='ofertas'?offersReport(args):reportMatch[1]==='recebimentos'?receiptsReport(args):reportMatch[1]==='pedidos'?requestsReport({...args,detail:url.searchParams.get('detail')!=='0'}):reportMatch[1]==='cotacoes'?quotesReport(args):generalReport(args)
   response.writeHead(200,{...headers,'Content-Type':'application/pdf','Content-Disposition':`${url.searchParams.get('inline')?'inline':'attachment'}; filename="${out.filename}"`,'Content-Length':out.buffer.length,'Cache-Control':'no-store','X-Report-Count':String(out.count)});response.end(out.buffer);return true
  }
  if(path==='/api/me/password'&&request.method==='POST'){const id=identify(request);if(!id?.user)return json(response,400,{error:'Troca de senha só para login com usuário e senha.'});const payload=await body(request);if(!verifyPassword(String(payload.currentPassword??''),id.user.passwordHash))return json(response,401,{error:'Senha atual incorreta.'});const next=String(payload.password??'');if(next.length<8)return json(response,400,{error:'A nova senha precisa ter pelo menos 8 caracteres.'});store.update(d=>{const u=d.users.find(x=>x.id===id.user.id);u.passwordHash=hashPassword(next);u.updatedAt=new Date().toISOString()});return json(response,200,{ok:true})}
  if(path==='/api/users'&&request.method==='GET'){if(!roles[role].write.includes('usuarios'))return json(response,403,{error:'Somente o nível gerencial vê os usuários.'});return json(response,200,{users:(store.read().users||[]).map(publicUser)})}
  const area=areaOf(path,request.method);if(area&&!roles[role].write.includes(area))return json(response,403,{error:`Seu nível de acesso (${roles[role].label}) não permite esta operação${area==='armazem'?' de armazenagem':area==='parametros'?' nos parâmetros':area==='cotacoes'?' em cotações':' comercial'}.`})
  if(path==='/api/users'&&request.method==='POST'){const input=normalizeUserInput(await body(request));const me=identify(request);const saved=store.update(d=>{d.users=d.users||[];if(d.users.some(u=>u.username===input.username))throw Object.assign(new Error('Já existe um usuário com esse nome.'),{statusCode:409});const record={id:randomUUID(),username:input.username,name:input.name,role:input.role,active:input.active,passwordHash:hashPassword(input.password),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),createdBy:me?.user?.username||'gerencial'};d.users.push(record);return record});return json(response,201,{user:publicUser(saved)})}
  const userMatch=path.match(/^\/api\/users\/([0-9a-f-]{36})(?:\/(password))?$/i)
  if(userMatch&&!userMatch[2]&&request.method==='PUT'){const payload=await body(request);const me=identify(request);const saved=store.update(d=>{const u=(d.users||[]).find(x=>x.id===userMatch[1]);if(!u)throw Object.assign(new Error('Usuário não encontrado.'),{statusCode:404});const input=normalizeUserInput({...u,...payload,username:payload.username||u.username,password:payload.password||''},{requirePassword:false});if(input.username!==u.username&&d.users.some(x=>x.username===input.username))throw Object.assign(new Error('Já existe um usuário com esse nome.'),{statusCode:409});if(me?.user?.id===u.id&&(input.role!=='gerencial'||!input.active))throw Object.assign(new Error('Você não pode rebaixar nem desativar o próprio usuário.'),{statusCode:400});if(u.role==='gerencial'&&(input.role!=='gerencial'||!input.active)&&d.users.filter(x=>x.role==='gerencial'&&x.active!==false&&x.id!==u.id).length===0&&!Object.values(codes).some(l=>l.length))throw Object.assign(new Error('Mantenha ao menos um usuário gerencial ativo.'),{statusCode:400});Object.assign(u,{username:input.username,name:input.name,role:input.role,active:input.active,updatedAt:new Date().toISOString()});if(input.password)u.passwordHash=hashPassword(input.password);return u});return json(response,200,{user:publicUser(saved)})}
  if(userMatch&&userMatch[2]==='password'&&request.method==='POST'){const payload=await body(request);const next=String(payload.password??'');if(next.length<8)return json(response,400,{error:'A nova senha precisa ter pelo menos 8 caracteres.'});store.update(d=>{const u=(d.users||[]).find(x=>x.id===userMatch[1]);if(!u)throw Object.assign(new Error('Usuário não encontrado.'),{statusCode:404});u.passwordHash=hashPassword(next);u.updatedAt=new Date().toISOString()});return json(response,200,{ok:true})}
  if(userMatch&&!userMatch[2]&&request.method==='DELETE'){const me=identify(request);store.update(d=>{const idx=(d.users||[]).findIndex(x=>x.id===userMatch[1]);if(idx<0)throw Object.assign(new Error('Usuário não encontrado.'),{statusCode:404});if(me?.user?.id===userMatch[1])throw Object.assign(new Error('Você não pode remover o próprio usuário.'),{statusCode:400});const u=d.users[idx];if(u.role==='gerencial'&&d.users.filter(x=>x.role==='gerencial'&&x.active!==false&&x.id!==u.id).length===0&&!Object.values(codes).some(l=>l.length))throw Object.assign(new Error('Mantenha ao menos um usuário gerencial ativo.'),{statusCode:400});d.users.splice(idx,1)});return json(response,200,{ok:true})}
  if(path==='/api/storage/units'&&request.method==='POST'){const input=normalizeUnit(await body(request));const saved=store.update(data=>{const record={...input,id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};data.storageUnits=(data.storageUnits||[]).concat(record);return record});return json(response,201,{unit:saved})}
  const unitMatch=path.match(/^\/api\/storage\/units\/([0-9a-f-]{36})$/i)
  if(unitMatch&&request.method==='PUT'){const input=normalizeUnit(await body(request));const saved=store.update(data=>{const current=(data.storageUnits||[]).find(u=>u.id===unitMatch[1]);if(!current)throw Object.assign(new Error('Unidade não encontrada.'),{statusCode:404});Object.assign(current,input,{updatedAt:new Date().toISOString()});return current});return json(response,200,{unit:saved})}
  if(unitMatch&&request.method==='DELETE'){store.update(data=>{const idx=(data.storageUnits||[]).findIndex(u=>u.id===unitMatch[1]);if(idx<0)throw Object.assign(new Error('Unidade não encontrada.'),{statusCode:404});data.storageUnits.splice(idx,1);data.storageReadings=(data.storageReadings||[]).filter(r=>r.unitId!==unitMatch[1]);data.storageReceipts=(data.storageReceipts||[]).filter(r=>r.unitId!==unitMatch[1])});return json(response,200,{ok:true})}
  if(path==='/api/storage/standards'&&request.method==='PUT'){const payload=await body(request);const saved=store.update(data=>{data.storageStandards=normalizeStandards(payload.standards||payload,{...defaultStandards,...(data.storageStandards||{})});return data.storageStandards});return json(response,200,{standards:saved})}
  if(path==='/api/storage/standards/reset'&&request.method==='POST'){store.update(data=>{delete data.storageStandards});return json(response,200,{standards:defaultStandards})}
  if(path==='/api/storage/readings'&&request.method==='POST'){const input=normalizeReading(await body(request));const saved=store.update(data=>{if(!(data.storageUnits||[]).some(u=>u.id===input.unitId))throw Object.assign(new Error('Unidade não encontrada.'),{statusCode:404});const record={...input,id:randomUUID(),createdAt:new Date().toISOString()};data.storageReadings=(data.storageReadings||[]).concat(record).slice(-20000);return record});return json(response,201,{reading:saved})}
  if(path==='/api/storage/receipts'&&request.method==='POST'){const input=normalizeReceipt(await body(request));const saved=store.update(data=>{if(!(data.storageUnits||[]).some(u=>u.id===input.unitId))throw Object.assign(new Error('Unidade não encontrada.'),{statusCode:404});if(input.producerId&&!input.producerName){const p=producerOf(data,input.producerId);if(p)input.producerName=p.name}const record={...input,id:randomUUID(),createdAt:new Date().toISOString()};data.storageReceipts=(data.storageReceipts||[]).concat(record).slice(-50000);return record});return json(response,201,{receipt:saved})}
  const storageItem=path.match(/^\/api\/storage\/(readings|receipts)\/([0-9a-f-]{36})$/i)
  if(storageItem&&request.method==='DELETE'){const key=storageItem[1]==='readings'?'storageReadings':'storageReceipts';store.update(data=>{const idx=(data[key]||[]).findIndex(r=>r.id===storageItem[2]);if(idx<0)throw Object.assign(new Error('Registro não encontrado.'),{statusCode:404});data[key].splice(idx,1)});return json(response,200,{ok:true})}
  if(path==='/api/storage/export'&&request.method==='GET'){const data=store.read();return json(response,200,{exportedAt:new Date().toISOString(),system:'VAL-SOG',units:data.storageUnits||[],readings:data.storageReadings||[],receipts:data.storageReceipts||[],standards:{...defaultStandards,...(data.storageStandards||{})}})}
  if(path==='/api/bootstrap'&&request.method==='GET'){
   const data=store.read();const now=new Date()
   const requests=data.requests.map(item=>({...item,producerName:producerOf(data,item.producerId)?.name||'Produtor'})).sort((l,r)=>String(r.createdAt).localeCompare(String(l.createdAt)))
   return json(response,200,{producers:data.producers,quotes:[...data.quotes].sort((l,r)=>String(r.observedAt).localeCompare(String(l.observedAt))),requests,targetHits:checkTargets(requests,data.quotes,now),brief:buildBrief({praca,quotes:data.quotes},{now}),portfolio:buildPortfolio({producers:data.producers,requests,quotes:data.quotes,praca,sources:sources.sources},{now}),offers:[...(data.offers||[])].sort((l,r)=>String(r.createdAt).localeCompare(String(l.createdAt))),offerSettings:{...defaultOfferSettings,...(data.offerSettings||{})},offerStatuses,comparison:data.comparison||null,automation:{...(data.automation||{}),autoSave,hours:Number(process.env.AUTO_FETCH_HOURS||4)},priceYear:buildPriceYear({quotes:data.quotes,praca},{now}),askingHistory:buildAskingHistory({producers:data.producers,offers:data.offers||[],requests,quotes:data.quotes},{now}),storage:{...buildStorageSummary({units:data.storageUnits||[],readings:data.storageReadings||[],receipts:data.storageReceipts||[],standards:{...defaultStandards,...(data.storageStandards||{})}},{now}),unitsRaw:data.storageUnits||[],readings:[...(data.storageReadings||[])].sort((l,r)=>r.date.localeCompare(l.date)||String(r.createdAt).localeCompare(String(l.createdAt))).slice(0,300),receipts:[...(data.storageReceipts||[])].sort((l,r)=>r.date.localeCompare(l.date)||String(r.createdAt).localeCompare(String(l.createdAt))).slice(0,500),defaults:defaultStandards},session:sessionInfo(request),storageGuide,portSources:portSources.map(item=>({id:item.id,name:item.name,region:item.region,commodities:item.commodities})),ownSource:ownSource?{id:ownSource.id,name:ownSource.name,region:ownSource.region,url:ownSource.url,commodities:ownSource.commodities}:null,catalog:{producerOptions,commodities:Object.entries(commodityLabels).map(([value,label])=>({value,label})),objectives:Object.entries(objectives).map(([value,item])=>({value,label:item.label,note:item.note})),sources:sources.sources,references:sources.references,sourcesVersion:sources.version},praca:{id:praca.id,label:praca.label,updatedAt:praca.updatedAt},governance:{automaticTrading:false,humanReviewRequired:true}})
  }
  if(path==='/api/producers'&&request.method==='POST'){const input=normalizeProducer(await body(request));const saved=store.update(data=>{const record={...input,id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};data.producers.push(record);return record});return json(response,201,{producer:saved})}
  const producerMatch=path.match(/^\/api\/producers\/([0-9a-f-]{36})$/i)
  if(producerMatch&&request.method==='PUT'){const input=normalizeProducer(await body(request));const saved=store.update(data=>{const current=producerOf(data,producerMatch[1]);if(!current)throw Object.assign(new Error('Produtor não encontrado.'),{statusCode:404});Object.assign(current,input,{updatedAt:new Date().toISOString()});return current});return json(response,200,{producer:saved})}
  if(path==='/api/quotes'&&request.method==='POST'){const input=normalizeQuote(await body(request));const saved=store.update(data=>{const record={...input,id:randomUUID(),createdAt:new Date().toISOString()};data.quotes.push(record);data.quotes=data.quotes.slice(-5000);return record});return json(response,201,{quote:saved})}
  const quoteMatch=path.match(/^\/api\/quotes\/([0-9a-f-]{36})$/i)
  if(quoteMatch&&request.method==='PUT'){
   const payload=await body(request)
   const saved=store.update(data=>{const quote=data.quotes.find(item=>item.id===quoteMatch[1]);if(!quote)throw Object.assign(new Error('Cotação não encontrada.'),{statusCode:404});const merged=normalizeQuote({...quote,...payload,sourceId:'',observedAt:payload.observedAt||quote.observedAt});if(!quote.original)quote.original={price:quote.price,priceUnit:quote.priceUnit,region:quote.region,observedAt:quote.observedAt,paymentTerms:quote.paymentTerms,notes:quote.notes};Object.assign(quote,{price:merged.price,priceUnit:merged.priceUnit,region:merged.region,paymentTerms:merged.paymentTerms,observedAt:merged.observedAt,notes:text(payload.notes??quote.notes,1000),sourceName:merged.sourceName,edited:true,editedAt:new Date().toISOString()});return quote})
   return json(response,200,{quote:saved})
  }
  if(quoteMatch&&request.method==='DELETE'){store.update(data=>{const quote=data.quotes.find(item=>item.id===quoteMatch[1]);if(!quote)throw Object.assign(new Error('Cotação não encontrada.'),{statusCode:404});quote.status='inactive'});return json(response,200,{removed:true})}
  if(path==='/api/own-quotes'&&request.method==='POST'){
   if(!ownSource)return json(response,400,{error:'Nenhuma fonte própria configurada.'})
   const payload=await body(request);const observedAt=payload.observedAt?new Date(payload.observedAt).toISOString():new Date().toISOString();const saved=[]
   for(const commodity of ownSource.commodities||[]){const price=payload[commodity];if(price===undefined||price===null||price==='')continue;const quote=normalizeQuote({sourceId:ownSource.id,commodity,price,priceUnit:'BRL/sc_60kg',paymentTerms:payload.paymentTerms||'',observedAt,notes:text(payload.notes,400)});saved.push(store.update(data=>{const record={...quote,id:randomUUID(),createdAt:new Date().toISOString()};data.quotes.push(record);data.quotes=data.quotes.slice(-5000);return record}))}
   if(!saved.length)return json(response,400,{error:'Informe ao menos um preço.'})
   return json(response,201,{quotes:saved})
  }
  if(path==='/api/offer-settings'&&request.method==='PUT'){const payload=await body(request);const saved=store.update(data=>{data.offerSettings=normalizeOfferSettings(payload,{...defaultOfferSettings,...(data.offerSettings||{})});return data.offerSettings});return json(response,200,{offerSettings:saved})}
  if((path==='/api/offers/preview'||path==='/api/offers')&&request.method==='POST'){
   const input=normalizeOfferInput(await body(request));const data=store.read();const producer=producerOf(data,input.producerId);if(!producer)return json(response,404,{error:'Produtor não encontrado.'})
   const settings={...defaultOfferSettings,...(data.offerSettings||{})};const offer=buildOffer({input,producer,quotes:data.quotes,praca,settings})
   if(path==='/api/offers/preview')return json(response,200,{offer})
   if(offer.offerPrice==null)return json(response,400,{error:'A oferta não tem preço: informe uma referência.'})
   const saved=store.update(d=>{const record={id:randomUUID(),producerId:producer.id,producerName:producer.name,input,offer,status:'rascunho',notes:input.notes,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),history:[{status:'rascunho',at:new Date().toISOString(),notes:'Oferta registrada'}]};d.offers=(d.offers||[]).concat(record).slice(-5000);return record})
   return json(response,201,{offer:saved})
  }
  const offerMatch=path.match(/^\/api\/offers\/([0-9a-f-]{36})$/i)
  if(offerMatch&&request.method==='PATCH'){
   const payload=await body(request)
   const saved=store.update(d=>{const record=(d.offers||[]).find(o=>o.id===offerMatch[1]);if(!record)throw Object.assign(new Error('Oferta não encontrada.'),{statusCode:404});if(payload.status){record.status=normalizeOfferStatus(payload.status);record.history.push({status:record.status,at:new Date().toISOString(),notes:text(payload.notes,1000)})}if(payload.notes!==undefined&&!payload.status)record.notes=text(payload.notes,3000);if(payload.closedPrice!==undefined){const v=Number(String(payload.closedPrice).replace(',','.'));if(v>0)record.closedPrice=v}record.updatedAt=new Date().toISOString();return record})
   return json(response,200,{offer:saved})
  }
  if(path==='/api/offers/export'&&request.method==='GET'){const data=store.read();return json(response,200,{exportedAt:new Date().toISOString(),system:'VAL-SOG',praca:praca.id,offers:data.offers||[],requests:data.requests||[],producers:data.producers||[]})}
  if(path==='/api/quotes/import'&&request.method==='POST'){
   const {quotes,rejected}=normalizeImportLines(await body(request))
   const saved=store.update(data=>{const records=quotes.map(q=>({...q,id:randomUUID(),createdAt:new Date().toISOString()}));data.quotes.push(...records);data.quotes=data.quotes.slice(-20000);return records.length})
   return json(response,201,{imported:saved,rejected:rejected.length,rejectedSample:rejected.slice(0,5)})
  }
  if(path==='/api/port-quotes'&&request.method==='POST'){
   const payload=await body(request);const source=portSources.find(item=>item.id===text(payload.sourceId,60));if(!source)return json(response,400,{error:'Selecione a trading do porto.'})
   const observedAt=payload.observedAt?new Date(payload.observedAt).toISOString():new Date().toISOString();const saved=[]
   for(const commodity of source.commodities||[]){const price=payload[commodity];if(price===undefined||price===null||price==='')continue;const quote=normalizeQuote({sourceId:source.id,commodity,price,priceUnit:payload.priceUnit||'BRL/sc_60kg',paymentTerms:payload.paymentTerms||'',observedAt,notes:text(payload.notes,400)});saved.push(store.update(data=>{const record={...quote,id:randomUUID(),createdAt:new Date().toISOString()};data.quotes.push(record);data.quotes=data.quotes.slice(-5000);return record}))}
   if(!saved.length)return json(response,400,{error:'Informe ao menos um preço de porto.'})
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
 app.listen(port,'0.0.0.0',()=>console.log(`VAL-SOG (Grãos Missões) ouvindo em :${port}`))
 const hours=Number(process.env.AUTO_FETCH_HOURS||4)
 if(hours>0){
  const run=()=>app.refreshComparison().then(result=>{console.log(`Comparativo atualizado: ${result.okCount}/${result.total} fontes lidas${result.autoSave?` • salvas ${result.autoSave.inserted} novas, ${result.autoSave.updated} atualizadas, ${result.autoSave.history} do histórico`:''}`);for(const r of result.results){const prices=Object.entries(r.prices||{}).map(([c,p])=>`${c}=${p.price}${p.priceUnit==='BRL/t'?'/t':''}`).join(' ');console.log(`  ${r.status.padEnd(7)} ${r.name}: ${prices||'-'}${(r.history||[]).length?` • histórico ${r.history.length} data(s) ${r.history[0].date}→${r.history[r.history.length-1].date}`:''}${r.pageDate?` (página ${r.pageDate})`:''}${r.error?` — ${r.error}`:''}${r.ms?` [${r.ms} ms]`:''}`);for(const [c,p] of Object.entries(r.prices||{}))console.log(`      trecho ${c}: «${String(p.snippet||'').slice(0,160)}»`);for(const [c,d] of Object.entries(r.debug||{}))console.log(`      debug ${c}: «${String(d).slice(0,220)}»`);for(const a of r.attempts||[])console.log(`      tentativa ${a}`)}}).catch(error=>console.error('Comparativo falhou',error.message))
  setTimeout(run,5000);setInterval(run,hours*3_600_000).unref()
 }
}
