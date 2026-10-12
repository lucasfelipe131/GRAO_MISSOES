import {createHash,timingSafeEqual} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {commodityLabels} from './analysis.js'

const paths=new Set(['/api/integrations/val/health','/api/integrations/val/context','/api/integrations/val/link','/api/integrations/val/unlink'])
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode})
const digest=value=>createHash('sha256').update(value).digest()
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9:_-]{1,180}$/.test(value)?value:''
const clean=value=>String(value||'').replace(/\b\d(?:[.\s/-]*\d){10}(?:[.\s/-]*\d){0,3}\b/g,'[documento oculto]').trim()
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null
const season=value=>typeof value==='string'&&/^\d{4}(?:\/\d{2,4})?$/.test(value)?value:null
const send=(response,status,payload)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(payload))}
async function body(request){
 let size=0;const chunks=[]
 for await(const chunk of request){size+=chunk.length;if(size>4096)throw fail(413,'Requisição acima do limite.');chunks.push(chunk)}
 try{const raw=Buffer.concat(chunks).toString('utf8'),value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return {value,raw}}catch{throw fail(400,'JSON inválido.')}
}
function strictRead(store){
 // The legacy store falls back to empty data on malformed JSON. A bridge must
 // never mistake that fallback for a valid unlinked ledger and overwrite it.
 let persisted
 try{persisted=JSON.parse(readFileSync(store.file,'utf8'))}catch{throw fail(503,'Não foi possível conferir os vínculos da integração.')}
 const validLink=l=>l&&id(l.tenantId)&&id(l.ownerUserId)&&id(l.clientId)&&id(l.producerId)&&l.confirmed===true&&typeof l.reason==='string'&&l.reason.length>=10&&l.reason.length<=500&&date(l.verifiedAt)
 if(!persisted||!Array.isArray(persisted.producers)||!Array.isArray(persisted.requests)||!Array.isArray(persisted.quotes)||
  (persisted.valProducerLinks!==undefined&&(!Array.isArray(persisted.valProducerLinks)||!persisted.valProducerLinks.every(validLink))))throw fail(503,'Não foi possível conferir os vínculos da integração.')
 const links=persisted.valProducerLinks||[]
 const keys=links.map(l=>JSON.stringify([l.tenantId,l.ownerUserId,l.clientId]))
 const producers=links.map(l=>JSON.stringify([l.tenantId,l.ownerUserId,l.producerId]))
 if(new Set(keys).size!==keys.length||new Set(producers).size!==producers.length)throw fail(503,'Vínculos da integração exigem conferência.')
 return persisted
}
function updateFresh(store,mutate){
 // A second app instance can update the same file while this store retains an
 // older cache. Reload after the request body and inside the synchronous write
 // callback so mutations preserve the latest data and reject new corruption.
 return store.update(current=>{
  const latest=strictRead(store)
  for(const key of Object.keys(current))delete current[key]
  Object.assign(current,latest)
  return mutate(current)
 })
}
const matches=(link,tenantId,ownerUserId,clientId)=>link.tenantId===tenantId&&link.ownerUserId===ownerUserId&&link.clientId===clientId
const audit=(data,event)=>{data.valBridgeAudit=[...(Array.isArray(data.valBridgeAudit)?data.valBridgeAudit:[]),event].slice(-1000)}
export function buildSogContext(data,link,{tenantId,ownerUserId,clientId,now=new Date()}={}){
 const fetchedAt=now.toISOString()
 const base={contract:'val.sog.v1',source:'val-sog',tenantId,ownerUserId,clientId,fetchedAt,humanReviewRequired:true}
 const producer=link&&data.producers.find(p=>p.id===link.producerId)
 if(!producer)return {...base,status:'NOT_LINKED',producer:null,profile:null,intentions:[],positions:[],marketSnapshots:[],coverage:{intentionsTotal:0,intentionsReturned:0,marketSnapshotsTotal:0,marketSnapshotsReturned:0,complete:true}}
 const scopedRequests=data.requests.filter(r=>r.producerId===producer.id)
 const requests=scopedRequests.filter(r=>commodityLabels[r.commodity])
 const commodities=[...new Set([...Object.keys(producer.crops||{}),...requests.map(r=>r.commodity)].filter(c=>commodityLabels[c]))]
 const positions=commodities.map(commodity=>{
  const crop=producer.crops?.[commodity]
  const areaHa=finite(crop?.areaHa)>0?crop.areaHa:null,yieldScHa=finite(crop?.yieldScHa)>0?crop.yieldScHa:null
  const fixedPercent=finite(crop?.fixedPercent)!=null&&crop.fixedPercent>=0&&crop.fixedPercent<=100?crop.fixedPercent:null
  const production=areaHa!=null&&yieldScHa!=null?Math.round(areaHa*yieldScHa):null
  const productionSc=finite(production),fixedSc=productionSc!=null&&fixedPercent!=null?Math.round(productionSc*fixedPercent/100):null
  return {commodity,areaHa,yieldScHa,productionSc,fixedPercent,fixedSc,openSc:productionSc!=null&&fixedSc!=null?productionSc-fixedSc:null}
 })
 const validRequests=requests.filter(r=>id(r.id)&&finite(r.volume)>0&&date(r.updatedAt||r.createdAt)&&['sell','buy'].includes(r.direction)&&['sc_60kg','t','kg'].includes(r.volumeUnit)&&['BRL/sc_60kg','BRL/t'].includes(r.priceUnit))
 const intentions=validRequests
  .sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt))).slice(0,100).map(r=>({
   id:r.id,commodity:r.commodity,direction:r.direction,status:r.status==='closed'?'closed':r.status==='cancelled'?'cancelled':'monitoring',sourceStatus:['open','closed','cancelled'].includes(r.status)?r.status:'unknown',volume:r.volume,volumeUnit:r.volumeUnit,targetPrice:finite(r.targetPrice),priceUnit:r.priceUnit,season:season(producer.season),deliveryStart:/^\d{4}-\d{2}-\d{2}$/.test(r.deliveryStart||'')?r.deliveryStart:null,deliveryEnd:/^\d{4}-\d{2}-\d{2}$/.test(r.deliveryEnd||'')?r.deliveryEnd:null,observedAt:date(r.updatedAt||r.createdAt),source:'val-sog',closedVolumeSc:(r.closings||[]).reduce((sum,c)=>sum+Math.max(0,finite(c.volumeSc)||0),0)
  }))
 const scopedQuotes=data.quotes.filter(q=>commodities.includes(q.commodity)&&q.status!=='inactive')
 const validQuotes=scopedQuotes.filter(q=>id(q.id)&&finite(q.price)>0&&date(q.observedAt)&&['BRL/sc_60kg','BRL/t'].includes(q.priceUnit))
 const marketSnapshots=validQuotes
  .sort((a,b)=>String(b.observedAt).localeCompare(String(a.observedAt))).slice(0,40).map(q=>({id:q.id,commodity:q.commodity,price:q.price,priceUnit:q.priceUnit,region:clean(q.region).slice(0,120),sourceName:clean(q.sourceName).slice(0,160),observedAt:date(q.observedAt),status:'active',source:'val-sog'}))
 const coverage={intentionsTotal:scopedRequests.length,intentionsReturned:intentions.length,intentionsRejected:scopedRequests.length-validRequests.length,marketSnapshotsTotal:scopedQuotes.length,marketSnapshotsReturned:marketSnapshots.length,marketSnapshotsRejected:scopedQuotes.length-validQuotes.length,complete:scopedRequests.length===intentions.length&&scopedQuotes.length===marketSnapshots.length}
 return {...base,status:'LINKED',producer:{id:producer.id},profile:{commodities,storageCapacityT:finite(producer.storageT),season:season(producer.season)},positions,intentions,marketSnapshots,coverage}
}
export function createValBridge({store,token=process.env.VAL_BRIDGE_TOKEN,tenantId=process.env.VAL_BRIDGE_TENANT_ID,identity}={}){
 if(identity?.enabled)tenantId=identity.tenantId
 return {async handle(request,response,url){
  if(!paths.has(url.pathname))return false
  const supplied=String(request.headers.authorization||'').match(/^Bearer (.+)$/)?.[1]||''
  if(!identity?.enabled&&(typeof token!=='string'||token.length<32||!id(tenantId)||!timingSafeEqual(digest(supplied),digest(token))))throw fail(401,'Integração não autenticada.')
  if(request.headers['x-val-tenant-id']!==tenantId)throw fail(403,'Escopo da integração inválido.')
  const read=['/api/integrations/val/health','/api/integrations/val/context'].includes(url.pathname)
  if(request.method!==(read?'GET':'POST'))throw fail(405,'Operação não disponível nesta integração.')
  if(url.pathname==='/api/integrations/val/health'){
   if(identity?.enabled){if(!identity.serviceIdentity)throw fail(401,'Integração não autenticada.');await identity.serviceIdentity.verify(supplied,{tenantId,scope:'sog.integration.health',method:request.method,path:url.pathname+url.search})}
   strictRead(store)
   send(response,200,{contract:'val.sog.connection.v1',bridgeContract:'val.sog.v1',source:'val-sog',repository:'GRAO_MISSOES',tenantId,status:'AVAILABLE',checkedAt:new Date().toISOString(),capabilities:['READ_GRAINS','VERIFY_LINK','REVOKE_LINK'],humanReviewRequired:true});return true
  }
  const parsed=read?{value:Object.fromEntries(url.searchParams),raw:''}:await body(request)
  const input=parsed.value
  const ownerUserId=id(input.ownerUserId),clientId=id(input.clientId)
  if(!ownerUserId||!clientId)throw fail(400,'Identifique a carteira e o produtor da VAL.')
  if(input.tenantId!==undefined&&input.tenantId!==tenantId)throw fail(403,'Escopo da integração inválido.')
  if(identity?.enabled){
   if(!identity.serviceIdentity)throw fail(401,'Integração não autenticada.')
   await identity.serviceIdentity.verify(supplied,{tenantId,scope:read?'sog.context.read':'sog.link.write',method:request.method,path:url.pathname+url.search,body:parsed.raw,actorId:ownerUserId,requireDelegation:true,recentMfa:!read})
   if(!read&&!await identity.canWriteLinks(ownerUserId))throw fail(403,'Este acesso não pode conferir vínculos no SOG.')
  }
  const data=strictRead(store)
  if(url.pathname==='/api/integrations/val/context'){
   const link=(data.valProducerLinks||[]).find(l=>matches(l,tenantId,ownerUserId,clientId))
   send(response,200,buildSogContext(data,link,{tenantId,ownerUserId,clientId}));return true
  }
  const reason=typeof input.reason==='string'?clean(input.reason):''
  if(input.confirmed!==true||reason.length<10||reason.length>500)throw fail(422,'Confirme a operação e registre o motivo (10 a 500 caracteres).')
  if(url.pathname==='/api/integrations/val/link'){
   const producerId=id(input.producerId)
   if(!producerId)throw fail(422,'Informe o ID do produtor SOG.')
   const result=updateFresh(store,current=>{
    if(!current.producers.some(p=>p.id===producerId))throw fail(422,'O identificador não corresponde a um produtor SOG.')
    const links=current.valProducerLinks||[]
    const existing=links.find(l=>matches(l,tenantId,ownerUserId,clientId))
    if(existing){if(existing.producerId!==producerId)throw fail(409,'Este cliente da VAL já possui outro vínculo. Revogue o vínculo antes de trocar.');return {linked:true,producerId,duplicate:true}}
    if(links.some(l=>l.tenantId===tenantId&&l.ownerUserId===ownerUserId&&l.producerId===producerId))throw fail(409,'Este produtor SOG já está vinculado a outro cliente desta carteira.')
    if(links.length>=10000)throw fail(503,'Limite de vínculos atingido. Confira a integração.')
    const verifiedAt=new Date().toISOString()
    current.valProducerLinks=[...links,{tenantId,ownerUserId,clientId,producerId,confirmed:true,reason,verificationMethod:'explicit-producer-id',verifiedAt}]
    audit(current,{action:'val_link_verified',tenantId,ownerUserId,clientId,producerId,reason,at:verifiedAt})
    return {linked:true,producerId,duplicate:false}
   })
   send(response,200,{contract:'val.sog.v1',source:'val-sog',tenantId,ownerUserId,clientId,...result});return true
  }
  updateFresh(store,current=>{
   const links=current.valProducerLinks||[],existing=links.find(l=>matches(l,tenantId,ownerUserId,clientId))
   if(existing){current.valProducerLinks=links.filter(l=>l!==existing);audit(current,{action:'val_link_revoked',tenantId,ownerUserId,clientId,producerId:existing.producerId,reason,at:new Date().toISOString()})}
  })
  send(response,200,{contract:'val.sog.v1',source:'val-sog',tenantId,ownerUserId,clientId,linked:false,producerId:null});return true
 }}
}
