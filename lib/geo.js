// Geolocalização: catálogo de praças e municípios, distâncias, leitura de preços por praça e visão regional.
import {readFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {commodityLabels,normalizeCoords,text} from './analysis.js'
export {normalizeCoords}
import {htmlToText,latestDate,parseTables,ranges} from './fetch.js'

const root=join(dirname(fileURLToPath(import.meta.url)),'..')
let cachedPlaces=null
export function loadPlaces(){
 if(!cachedPlaces){const raw=JSON.parse(readFileSync(join(root,'data','lugares.json'),'utf8'));cachedPlaces={...raw,places:raw.places.map(p=>({...p,id:placeId(p.name,p.uf),folded:fold(p.name)}))}}
 return cachedPlaces
}
export const fold=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
export const placeId=(name,uf)=>`${fold(name).replace(/\s+/g,'-')}-${String(uf||'').toLowerCase()}`
export const roadFactor=()=>loadPlaces().roadFactor||1.3

export function haversineKm(a,b){
 if(!a||!b||![a.lat,a.lon,b.lat,b.lon].every(Number.isFinite))return null
 const R=6371,rad=d=>d*Math.PI/180
 const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon)
 const s=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2
 return Math.round(2*R*Math.asin(Math.sqrt(s))*10)/10
}
export const roadKm=(straight,factor=roadFactor())=>straight==null?null:Math.round(straight*factor)

export function findPlace(name,uf=null){
 const f=fold(name);if(!f)return null
 const {places}=loadPlaces();const u=uf?String(uf).toUpperCase():null
 return places.find(p=>(p.folded===f||(p.aliases||[]).some(a=>fold(a)===f))&&(!u||p.uf===u))||(u?null:places.find(p=>p.folded===f||(p.aliases||[]).some(a=>fold(a)===f)))||null
}
export function searchPlaces(query,{limit=12,kind=null}={}){
 const q=fold(query);if(!q)return []
 const m=q.match(/^(.*?)\s+([a-z]{2})$/);const uf=m?m[2].toUpperCase():null;const name=m&&uf&&UFS.has(uf)?m[1].trim():q
 const {places}=loadPlaces()
 const scored=places.filter(p=>!kind||p.kind===kind).map(p=>{const target=p.folded;const al=(p.aliases||[]).map(fold);let score=0
  if(target===name||al.includes(name))score=100;else if(target.startsWith(name)||al.some(a=>a.startsWith(name)))score=80;else if(target.includes(name)||al.some(a=>a.includes(name)))score=60;else if(name.length>=3&&name.split(' ').every(w=>target.includes(w)))score=40
  if(uf&&UFS.has(uf)){if(p.uf===uf)score+=10;else if(name)score=Math.min(score,0)}
  if(!name&&uf&&p.uf===uf)score=50
  return {p,score}}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.p.name.localeCompare(b.p.name,'pt-BR'))
 return scored.slice(0,limit).map(x=>publicPlace(x.p))
}
const UFS=new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])
export const publicPlace=p=>({id:p.id,name:p.name,uf:p.uf,lat:p.lat,lon:p.lon,kind:p.kind,port:Boolean(p.port),home:Boolean(p.home),label:`${p.name}/${p.uf}`})
export function nearestPlaces(origin,{limit=8,kind=null,maxKm=null}={}){
 if(!origin||!Number.isFinite(origin.lat)||!Number.isFinite(origin.lon))return []
 return loadPlaces().places.filter(p=>!kind||p.kind===kind).map(p=>({...publicPlace(p),distanceKm:haversineKm(origin,p)})).filter(p=>maxKm==null||p.distanceKm<=maxKm).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,limit)
}
export const homePlace=()=>{const p=loadPlaces().places.find(x=>x.home)||loadPlaces().places[0];return publicPlace(p)}

// ——— leitura das tabelas públicas de mercado físico por praça ———
const placeCellRe=/^(.{2,60}?)\s*(?:\/|\(|-|–)\s*([A-Za-z]{2})\)?\s*$/
const stop=new Set(['media','total','atacado','brasil','bolsa','fonte','praca','cidade','regiao','local'])
const parenRe=/\s*\(([^()]{1,60})\)\s*$/
export function parsePlaceCell(cell){
 let base=String(cell||'').replace(/\s+/g,' ').trim();if(!base)return null
 const extras=[];let m
 while((m=base.match(parenRe))){const inner=m[1].trim();if(/^[A-Za-z]{2}$/.test(inner)&&UFS.has(inner.toUpperCase()))break;extras.unshift(inner);base=base.slice(0,m.index).trim()}
 const buyer=extras.filter(x=>!/^(disponivel|disponível|balcao|balcão|spot|lote|entrega|à vista|a vista)/i.test(x)).join(' • ')||''
 const hit=base.match(placeCellRe)
 if(hit){const uf=hit[2].toUpperCase();if(!UFS.has(uf))return null;const name=hit[1].trim();if(!name||stop.has(fold(name))||/\d/.test(name))return null;return {name,uf,buyer}}
 const alias=findPlace(base);if(alias&&!/\d/.test(base))return {name:alias.name,uf:alias.uf,buyer}
 return null
}
const decimalRe=/(?<![\d,.])(\d{1,3}(?:\.\d{3})+|\d{1,5}),(\d{2})(?![\d])/
export function priceFromCells(cells,commodity){
 for(const cell of cells){
  const c=String(cell||'').trim();if(!c||/[\/:%]/.test(c))continue
  const m=c.match(decimalRe);if(!m)continue
  const value=Number(m[1].replace(/\./g,''))+Number(m[2])/100
  const sc=ranges[commodity]?.['BRL/sc_60kg'];const t=ranges[commodity]?.['BRL/t']
  if(sc&&value>=sc[0]&&value<=sc[1])return {price:value,priceUnit:'BRL/sc_60kg',cell:c}
  if(t&&value>=t[0]&&value<=t[1])return {price:value,priceUnit:'BRL/t',cell:c}
 }
 return null
}
export function extractPlaceRows(html,{commodity,now=new Date()}={}){
 const rows=[];const seen=new Set()
 const text=htmlToText(html);const pageDate=latestDate(text,now)
 for(const table of parseTables(html)){
  for(const cells of table){
   const place=parsePlaceCell(cells[0]);if(!place)continue
   const found=priceFromCells(cells.slice(1),commodity);if(!found)continue
   const key=`${fold(place.name)}|${place.uf}|${fold(place.buyer)}`;if(seen.has(key))continue;seen.add(key)
   const cat=findPlace(place.name,place.uf)
   rows.push({commodity,name:place.name,uf:place.uf,buyer:place.buyer||'',placeId:cat?.id||null,lat:cat?.lat??null,lon:cat?.lon??null,price:found.price,priceUnit:found.priceUnit,snippet:cells.slice(0,4).join(' | ').slice(0,120)})
  }
 }
 return {rows,pageDate}
}
export async function fetchRegional(source,{timeoutMs=15000,fetchImpl=globalThis.fetch,now=new Date()}={}){
 const started=Date.now();const urls=[...new Set([source.url,...(source.urls||[])].filter(Boolean))];const attempts=[];let last=null
 for(const url of urls){
  try{
   const response=await fetchImpl(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GraosMissoes/1.0','Accept':'text/html,application/xhtml+xml','Accept-Language':'pt-BR,pt;q=0.9'},signal:AbortSignal.timeout(timeoutMs),redirect:'follow'})
   if(!response.ok){attempts.push(`${url}: HTTP ${response.status}`);last={id:source.id,name:source.name,commodity:source.commodity,status:'failed',error:`HTTP ${response.status} em ${url}`,rows:[],attempts,fetchedAt:now.toISOString(),ms:Date.now()-started};continue}
   const html=(await response.text()).slice(0,1_500_000)
   const {rows,pageDate}=extractPlaceRows(html,{commodity:source.commodity,now})
   attempts.push(`${url}: ${rows.length} praça(s)`)
   last={id:source.id,name:source.name,commodity:source.commodity,status:rows.length?'ok':'empty',error:rows.length?'':`Página lida (${url}), mas nenhuma linha “praça/UF” com preço reconhecido.`,rows:rows.map(r=>({...r,sourceId:source.id,sourceName:source.name,url,date:pageDate||now.toISOString().slice(0,10)})),pageDate,readUrl:url,attempts,fetchedAt:now.toISOString(),ms:Date.now()-started}
   if(rows.length)return last
  }catch(error){attempts.push(`${url}: ${error.name==='TimeoutError'?'tempo esgotado':error.message}`);last={id:source.id,name:source.name,commodity:source.commodity,status:'failed',error:error.name==='TimeoutError'?'Tempo esgotado.':error.message,rows:[],attempts,fetchedAt:now.toISOString(),ms:Date.now()-started}}
 }
 return last||{id:source.id,name:source.name,commodity:source.commodity,status:'skipped',error:'Fonte regional sem URL.',rows:[],attempts,fetchedAt:now.toISOString()}
}
export async function runRegional(list=[],options={}){
 const now=options.now||new Date()
 const results=await Promise.all(list.map(src=>fetchRegional(src,{...options,now})))
 const rows=results.flatMap(r=>r.rows||[])
 return {fetchedAt:now.toISOString(),results:results.map(r=>({id:r.id,name:r.name,commodity:r.commodity,status:r.status,error:r.error||'',count:(r.rows||[]).length,pageDate:r.pageDate||null,readUrl:r.readUrl||null,attempts:r.attempts||[],ms:r.ms})),rows,okCount:results.filter(r=>r.status==='ok').length,total:results.length}
}

// ——— visão regional: preços mais próximos de um ponto ou de uma praça escolhida ———
const toSc=(price,unit)=>unit==='BRL/t'?Math.round(price*0.06*100)/100:price
const placeFromText=value=>{const t=String(value||'').replace(/\(.*?\)/g,' ').replace(/\s+/g,' ').trim();if(!t)return null;const parts=t.split(/[\/,•–—-]/).map(x=>x.trim()).filter(Boolean);for(const part of [t,...parts]){const p=findPlace(part);if(p)return p}return null}
export function quoteRows({quotes=[],sources=[],ownSourceId=null,now=new Date(),days=7}={}){
 const cut=now.getTime()-days*864e5;const latest=new Map()
 for(const q of quotes){
  if(q.status==='inactive'||q.imported||!q.commodity||q.price==null)continue
  if(ownSourceId&&q.sourceId===ownSourceId)continue
  const t=new Date(q.observedAt).getTime();if(!Number.isFinite(t)||t<cut)continue
  const key=`${q.sourceId||q.sourceName}|${q.commodity}`;const prev=latest.get(key);if(prev&&new Date(prev.observedAt).getTime()>=t)continue;latest.set(key,q)
 }
 const rows=[]
 for(const q of latest.values()){
  const src=sources.find(x=>x.id===q.sourceId)||null
  const place=placeFromText(q.region)||placeFromText(src?.region)||null;if(!place)continue
  const buyer=String(q.sourceName||src?.name||'').split(' — ')[0].trim()
  rows.push({commodity:q.commodity,name:place.name,uf:place.uf,buyer,placeId:place.id,lat:place.lat,lon:place.lon,price:q.price,priceUnit:q.priceUnit||'BRL/sc_60kg',date:String(q.observedAt).slice(0,10),sourceName:q.sourceName||src?.name||'',url:q.sourceUrl||src?.url||'',kind:'cotacao',port:Boolean(src?.port)||place.port||false,paymentTerms:q.paymentTerms||''})
 }
 return rows
}
export function buildRegionalView({regional=null,quotes=[],sources=[],ownSourceId=null,lat=null,lon=null,placeId:chosen=null,query='',limit=8,now=new Date()}={}){
 const home=homePlace()
 let origin=null;let mode='casa'
 if(Number.isFinite(lat)&&Number.isFinite(lon)){origin={lat,lon,label:'sua localização'};mode='gps'}
 else if(chosen){const p=loadPlaces().places.find(x=>x.id===chosen);if(p){origin={lat:p.lat,lon:p.lon,label:`${p.name}/${p.uf}`,placeId:p.id};mode='praca'}}
 else if(query){const hit=searchPlaces(query,{limit:1})[0];if(hit){origin={lat:hit.lat,lon:hit.lon,label:hit.label,placeId:hit.id};mode='busca'}}
 if(!origin)origin={lat:home.lat,lon:home.lon,label:home.label,placeId:home.id}
 const near=nearestPlaces(origin,{limit:1})[0]||null
 const region=near?{name:near.name,uf:near.uf,label:near.label,distanceKm:near.distanceKm,id:near.id}:null
 const rows=[...quoteRows({quotes,sources,ownSourceId,now}),...(regional?.rows||[]).map(r=>({...r,kind:'praca'}))].map(r=>({...r,distanceKm:r.lat!=null?haversineKm(origin,r):null}))
 const ownLatest=commodity=>{const q=quotes.filter(x=>x.status!=='inactive'&&x.commodity===commodity&&ownSourceId&&x.sourceId===ownSourceId).sort((l,r)=>String(r.observedAt).localeCompare(String(l.observedAt)))[0];return q?{price:toSc(q.price,q.priceUnit),observedAt:q.observedAt}:null}
 const commodities=[...new Set(rows.map(r=>r.commodity))].sort((a,b)=>Object.keys(commodityLabels).indexOf(a)-Object.keys(commodityLabels).indexOf(b)).map(commodity=>{
  const list=rows.filter(r=>r.commodity===commodity)
  const located=list.filter(r=>r.distanceKm!=null).sort((a,b)=>a.distanceKm-b.distanceKm||toSc(b.price,b.priceUnit)-toSc(a.price,a.priceUnit))
  const own=ownLatest(commodity)
  const nearest=located.slice(0,limit).map(r=>({name:r.name,uf:r.uf,buyer:r.buyer||'',kind:r.kind||'praca',port:Boolean(r.port),paymentTerms:r.paymentTerms||'',label:`${r.name}/${r.uf}${r.buyer?' — '+r.buyer:''}`,placeId:r.placeId,distanceKm:r.distanceKm,roadKm:roadKm(r.distanceKm),price:r.price,priceUnit:r.priceUnit,priceSc:toSc(r.price,r.priceUnit),date:r.date,sourceName:r.sourceName,url:r.url,vsOwnSc:own?Math.round((toSc(r.price,r.priceUnit)-own.price)*100)/100:null}))
  const uf=region?.uf||null;const ufRows=uf?list.filter(r=>r.uf===uf):[]
  const ufAvg=ufRows.length?Math.round(ufRows.reduce((s,r)=>s+toSc(r.price,r.priceUnit),0)/ufRows.length*100)/100:null
  const unlocated=[...new Set(list.filter(r=>r.distanceKm==null).map(r=>`${r.name}/${r.uf}`))]
  const best=nearest.length?nearest.reduce((b,r)=>r.priceSc>b.priceSc?r:b,nearest[0]):null
  const local=nearest.filter(r=>r.kind==='cotacao').length
  return {commodity,label:commodityLabels[commodity]||commodity,nearest,best,own,uf,ufAverage:ufAvg,ufCount:ufRows.length,totalPlaces:list.length,localQuotes:local,unlocated}
 })
 return {computedAt:now.toISOString(),mode,origin,region,home,readAt:regional?.fetchedAt||null,results:regional?.results||[],commodities,roadFactor:roadFactor(),catalogSize:loadPlaces().places.length}
}

// ——— mapa de produtores e unidades: coordenadas, distância até a unidade, resumo para a mesa ———
const coordsOf=(entity,{municipality=true}={})=>{
 if(Number.isFinite(entity?.lat)&&Number.isFinite(entity?.lon))return {lat:entity.lat,lon:entity.lon,source:'cadastro'}
 if(municipality&&entity?.municipality){const p=findPlace(entity.municipality,entity.uf||null);if(p)return {lat:p.lat,lon:p.lon,source:'municipio',placeLabel:`${p.name}/${p.uf}`}}
 return null
}
export function buildMap({producers=[],units=[],portfolio=null,praca=null,now=new Date()}={}){
 const home=homePlace();const factor=roadFactor()
 const unitList=units.map(u=>{const c=coordsOf(u);return {id:u.id,name:u.name,municipality:u.municipality||'',kind:u.kind||'misto',capacityT:u.capacityT||null,dryingTDay:u.dryingTDay??null,receivingTDay:u.receivingTDay??null,lat:c?.lat??null,lon:c?.lon??null,coordSource:c?.source||null}}).filter(u=>u.lat!=null)
 if(!unitList.length)unitList.push({id:'praca',name:praca?.label||'C.Vale — São Luiz Gonzaga',municipality:home.name,kind:'praca',capacityT:null,lat:home.lat,lon:home.lon,coordSource:'praca',virtual:true})
 const positionsOf=id=>(portfolio?.commodities||[]).flatMap(c=>c.positions.filter(x=>x.producerId===id).map(x=>({commodity:c.commodity,label:c.label,areaHa:x.areaHa,yieldScHa:x.yieldScHa,productionSc:x.productionSc,fixedPercent:x.fixedPercent,openSc:x.openSc})))
 const list=producers.map(p=>{
  const c=coordsOf(p)
  let nearest=null,straightKm=null
  if(c){for(const u of unitList){const d=haversineKm(c,u);if(d!=null&&(straightKm==null||d<straightKm)){straightKm=d;nearest=u}}}
  const estimatedKm=roadKm(straightKm,factor)
  const distanceKm=p.distanceKm!=null?p.distanceKm:estimatedKm
  const crops=positionsOf(p.id);if(!crops.length)for(const [k,v] of Object.entries(p.crops||{})){if(v.areaHa>0)crops.push({commodity:k,label:commodityLabels[k]||k,areaHa:v.areaHa,yieldScHa:v.yieldScHa,productionSc:Math.round(v.areaHa*(v.yieldScHa||0)),fixedPercent:v.fixedPercent||0,openSc:Math.round(v.areaHa*(v.yieldScHa||0)*(1-(v.fixedPercent||0)/100))})}
  return {id:p.id,name:p.name,municipality:p.municipality||'',phone:p.phone||'',deliveryLocation:p.deliveryLocation||'',logistics:p.logistics||'',lat:c?.lat??null,lon:c?.lon??null,coordSource:c?.source||null,coordNote:c?.source==='municipio'?`sede de ${c.placeLabel} (aproximado)`:c?.source==='cadastro'?'coordenadas do cadastro':'sem localização',nearestUnit:nearest?{id:nearest.id,name:nearest.name}:null,straightKm,estimatedKm,distanceKm,distanceSource:p.distanceKm!=null?'informado':estimatedKm!=null?'estimado':null,storageT:p.storageT||null,storageCostScMonth:p.storageCostScMonth||null,crops,productionSc:crops.reduce((s,x)=>s+(x.productionSc||0),0),openSc:crops.reduce((s,x)=>s+(x.openSc||0),0),season:p.season||''}
 })
 const located=list.filter(p=>p.lat!=null)
 const pts=[...located,...unitList];const bounds=pts.length?{minLat:Math.min(...pts.map(p=>p.lat)),maxLat:Math.max(...pts.map(p=>p.lat)),minLon:Math.min(...pts.map(p=>p.lon)),maxLon:Math.max(...pts.map(p=>p.lon))}:null
 const withKm=located.filter(p=>p.distanceKm!=null)
 return {computedAt:now.toISOString(),roadFactor:factor,units:unitList,producers:list.sort((a,b)=>(a.distanceKm??1e9)-(b.distanceKm??1e9)||a.name.localeCompare(b.name,'pt-BR')),bounds,summary:{producers:list.length,located:located.length,fromMunicipality:located.filter(p=>p.coordSource==='municipio').length,missing:list.filter(p=>p.lat==null).map(p=>p.name),avgKm:withKm.length?Math.round(withKm.reduce((s,p)=>s+p.distanceKm,0)/withKm.length):null,maxKm:withKm.length?Math.max(...withKm.map(p=>p.distanceKm)):null,productionSc:list.reduce((s,p)=>s+p.productionSc,0),openSc:list.reduce((s,p)=>s+p.openSc,0),storageT:list.reduce((s,p)=>s+(p.storageT||0),0)}}
}
const nf=(v,d=0)=>v==null?'—':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})
export function deskSummary(entry,{unitName=null}={}){
 if(!entry)return ''
 const lines=[`Produtor: ${entry.name}${entry.municipality?' — '+entry.municipality:''}`]
 if(entry.lat!=null)lines.push(`Localização: ${entry.lat.toFixed(5)}, ${entry.lon.toFixed(5)} (${entry.coordNote})`)
 else lines.push('Localização: não informada')
 const u=entry.nearestUnit?.name||unitName
 if(entry.distanceKm!=null)lines.push(`Distância até ${u||'a unidade'}: ${nf(entry.distanceKm)} km ${entry.distanceSource==='informado'?'(informada no cadastro)':`(estimativa rodoviária; ${nf(entry.straightKm,1)} km em linha reta)`}`)
 if(entry.deliveryLocation)lines.push(`Entrega usual: ${entry.deliveryLocation}${entry.logistics?' • '+entry.logistics:''}`)
 else if(entry.logistics)lines.push(`Logística: ${entry.logistics}`)
 if(entry.storageT)lines.push(`Armazenagem própria: ${nf(entry.storageT)} t${entry.storageCostScMonth?` (custo ${nf(entry.storageCostScMonth,2)} R$/sc/mês)`:''}`)
 if(entry.crops?.length)lines.push(`Safra${entry.season?' '+entry.season:''}: `+entry.crops.map(c=>`${c.label} ${nf(c.areaHa)} ha × ${nf(c.yieldScHa)} sc/ha = ${nf(c.productionSc)} sc (${c.fixedPercent||0}% fixado, ${nf(c.openSc)} sc em aberto)`).join('; '))
 if(entry.phone)lines.push(`Contato: ${entry.phone}`)
 return lines.join('\n')
}
export function geocodeLocal(query,{limit=6}={}){let hits=searchPlaces(query,{limit});if(!hits.length&&/,/.test(query)){const parts=String(query).split(',').map(x=>x.trim()).filter(Boolean);for(const part of parts.slice().reverse()){hits=searchPlaces(part,{limit});if(hits.length)break}}return hits.map(p=>({...p,source:'catalogo',display:`${p.name}/${p.uf} (sede do município)`}))}
export async function geocode(query,{fetchImpl=globalThis.fetch,timeoutMs=8000,limit=6}={}){
 const q=text(query,120);if(!q)return {query:q,results:[]}
 const local=geocodeLocal(q,{limit})
 let remote=[];let error=''
 if(fetchImpl){try{
  const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=br&limit=${limit}&addressdetails=1&q=${encodeURIComponent(q)}`
  const r=await fetchImpl(url,{headers:{'User-Agent':'VAL-SOG/1.0 (graos-missoes; contato via C.Vale São Luiz Gonzaga)','Accept':'application/json','Accept-Language':'pt-BR'},signal:AbortSignal.timeout(timeoutMs)})
  if(r.ok){const data=await r.json();remote=(Array.isArray(data)?data:[]).map(x=>{const a=x.address||{};const uf=a['ISO3166-2-lvl4']?String(a['ISO3166-2-lvl4']).slice(-2):'';return {name:a.municipality||a.city||a.town||a.village||String(x.display_name||'').split(',')[0],uf,lat:Number(x.lat),lon:Number(x.lon),source:'osm',display:String(x.display_name||'').slice(0,140),kind:x.type||''}}).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon))}
  else error=`HTTP ${r.status}`
 }catch(e){error=e.name==='TimeoutError'?'tempo esgotado':e.message}}
 return {query:q,results:[...local,...remote].slice(0,limit*2),error}
}
