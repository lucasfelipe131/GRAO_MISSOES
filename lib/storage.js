import {normalizeCoords,commodityLabels,domainError,number,text,dateOnly} from './analysis.js'

const round=(v,d=2)=>Number(Number(v).toFixed(d))
const today=now=>new Date(now).toISOString().slice(0,10)

// Padrões comerciais de referência (IN MAPA 11/2007 soja, IN 60/2011 milho, IN 38/2010 trigo; canola e arroz conforme prática das esmagadoras e engenhos).
// Cada unidade pode ajustar os limites em "Padrões" — o que vale para o desconto é o padrão da unidade.
export const defaultStandards={
 soja:{moisture:{max:14,ideal:13,label:'Umidade (%)'},temperature:{max:25,ideal:20,label:'Temperatura da massa (°C)'},impurities:{max:1,label:'Impurezas (%)'},damaged:{max:8,label:'Avariados (%)'},burnt:{max:4,label:'Ardidos e queimados (%)'},greenish:{max:8,label:'Esverdeados (%)'},broken:{max:30,label:'Quebrados (%)'}},
 milho:{moisture:{max:14,ideal:13,label:'Umidade (%)'},temperature:{max:25,ideal:20,label:'Temperatura da massa (°C)'},impurities:{max:1,label:'Impurezas (%)'},damaged:{max:6,label:'Avariados (%)'},burnt:{max:1,label:'Ardidos (%)'},broken:{max:3,label:'Quebrados (%)'}},
 trigo:{moisture:{max:13,ideal:12.5,label:'Umidade (%)'},temperature:{max:20,ideal:18,label:'Temperatura da massa (°C)'},impurities:{max:1,label:'Impurezas (%)'},damaged:{max:1,label:'Danificados por calor (%)'},ph:{min:78,label:'Peso do hectolitro (kg/hl)'},fallingNumber:{min:250,label:'Falling number (s)'}},
 canola:{moisture:{max:8,ideal:7,label:'Umidade (%)'},temperature:{max:15,ideal:12,label:'Temperatura da massa (°C)'},impurities:{max:2,label:'Impurezas (%)'},damaged:{max:5,label:'Avariados (%)'},greenish:{max:2,label:'Esverdeados (%)'},oil:{min:38,label:'Teor de óleo (%)'}},
 arroz:{moisture:{max:13,ideal:12.5,label:'Umidade (%)'},temperature:{max:22,ideal:18,label:'Temperatura da massa (°C)'},impurities:{max:2,label:'Impurezas (%)'},damaged:{max:4,label:'Avariados (%)'}},
 sorgo:{moisture:{max:14,ideal:13,label:'Umidade (%)'},temperature:{max:25,ideal:20,label:'Temperatura da massa (°C)'},impurities:{max:2,label:'Impurezas (%)'},damaged:{max:6,label:'Avariados (%)'}},
 aveia:{moisture:{max:13,ideal:12,label:'Umidade (%)'},temperature:{max:20,ideal:18,label:'Temperatura da massa (°C)'},impurities:{max:2,label:'Impurezas (%)'},ph:{min:50,label:'Peso do hectolitro (kg/hl)'}}
}
export const parameterKeys=['moisture','temperature','impurities','damaged','burnt','greenish','broken','ph','fallingNumber','oil']
const parameterLabels={moisture:'Umidade (%)',temperature:'Temperatura da massa (°C)',impurities:'Impurezas (%)',damaged:'Avariados (%)',burnt:'Ardidos e queimados (%)',greenish:'Esverdeados (%)',broken:'Quebrados (%)',ph:'Peso do hectolitro (kg/hl)',fallingNumber:'Falling number (s)',oil:'Teor de óleo (%)'}

export function normalizeStandards(input={},current=defaultStandards){
 const out=structuredClone(current)
 for(const [commodity,params] of Object.entries(input||{})){
  if(!commodityLabels[commodity]||typeof params!=='object')continue
  out[commodity]=out[commodity]||{}
  for(const [key,value] of Object.entries(params||{})){
   if(!parameterKeys.includes(key))continue
   const spec={label:parameterLabels[key]}
   const max=number(value?.max);const min=number(value?.min);const ideal=number(value?.ideal)
   if(max!==null)spec.max=max;if(min!==null)spec.min=min;if(ideal!==null)spec.ideal=ideal
   if(spec.max==null&&spec.min==null){delete out[commodity][key];continue}
   out[commodity][key]=spec
  }
 }
 return out
}
export function normalizeUnit(input={}){
 const name=text(input.name,120);if(!name)throw domainError('Informe o nome da unidade de recebimento.')
 const capacityT=number(input.capacityT);if(capacityT===null||capacityT<=0)throw domainError('Informe a capacidade estática da unidade em toneladas.')
 const dryingTDay=number(input.dryingTDay);if(dryingTDay!==null&&dryingTDay<0)throw domainError('A capacidade de secagem não pode ser negativa.')
 const receivingTDay=number(input.receivingTDay);if(receivingTDay!==null&&receivingTDay<0)throw domainError('A capacidade de recebimento não pode ser negativa.')
 const goals={};for(const key of Object.keys(commodityLabels)){const g=number(input[`goal_${key}`]??input.goals?.[key]);if(g!==null){if(g<0)throw domainError(`A meta de ${commodityLabels[key].toLowerCase()} não pode ser negativa.`);if(g>0)goals[key]=g}}
 const seasonStart=dateOnly(input.seasonStart);if(input.seasonStart&&!seasonStart)throw domainError('Data de início da safra inválida.')
 const seasonEnd=dateOnly(input.seasonEnd);if(input.seasonEnd&&!seasonEnd)throw domainError('Data de fim da safra inválida.')
 if(seasonStart&&seasonEnd&&seasonEnd<seasonStart)throw domainError('O fim da safra não pode ser antes do início.')
 const coords=normalizeCoords(input)
 return {name,municipality:text(input.municipality,120),lat:coords.lat,lon:coords.lon,kind:['silo','armazem','graneleiro','misto'].includes(input.kind)?input.kind:'misto',capacityT:round(capacityT,1),dryingTDay:dryingTDay==null?null:round(dryingTDay,1),receivingTDay:receivingTDay==null?null:round(receivingTDay,1),goals,season:text(input.season,40),seasonStart,seasonEnd,manager:text(input.manager,120),notes:text(input.notes,1000)}
}
const readParams=input=>{const p={};for(const key of parameterKeys){const v=number(input[key]);if(v!==null){if(v<0)throw domainError(`${parameterLabels[key]} não pode ser negativo.`);p[key]=round(v,2)}}return p}
export function normalizeReading(input={}){
 const unitId=text(input.unitId,80);if(!unitId)throw domainError('Selecione a unidade.')
 const commodity=text(input.commodity,40);if(!commodityLabels[commodity])throw domainError('Selecione um grão válido.')
 const quantityT=number(input.quantityT);if(quantityT===null||quantityT<0)throw domainError('Informe a quantidade armazenada em toneladas (0 para vazio).')
 const date=dateOnly(input.date)||today(input.now||Date.now());if(input.date&&!dateOnly(input.date))throw domainError('Data da leitura inválida.')
 return {unitId,commodity,date,quantityT:round(quantityT,1),silo:text(input.silo,60),params:readParams(input),notes:text(input.notes,1000)}
}
export function normalizeReceipt(input={}){
 const unitId=text(input.unitId,80);if(!unitId)throw domainError('Selecione a unidade.')
 const commodity=text(input.commodity,40);if(!commodityLabels[commodity])throw domainError('Selecione um grão válido.')
 const quantityT=number(input.quantityT);if(quantityT===null||quantityT<=0)throw domainError('Informe a quantidade recebida em toneladas.')
 const date=dateOnly(input.date)||today(input.now||Date.now());if(input.date&&!dateOnly(input.date))throw domainError('Data do recebimento inválida.')
 const loads=number(input.loads);if(loads!==null&&loads<0)throw domainError('Número de cargas inválido.')
 return {unitId,commodity,date,quantityT:round(quantityT,1),loads:loads==null?null:Math.round(loads),producerId:text(input.producerId,80),producerName:text(input.producerName,120),plate:text(input.plate,20),params:readParams(input),discountT:Math.max(0,number(input.discountT)||0),notes:text(input.notes,1000)}
}

export function evaluateParams(commodity,params={},standards=defaultStandards){
 const spec=standards[commodity]||{};const out=[]
 for(const [key,rule] of Object.entries(spec)){
  const value=params[key];if(value==null)continue
  let status='ok';let limit=null;let gap=0
  if(rule.max!=null){limit=rule.max;gap=round(value-rule.max);if(value>rule.max)status=value>rule.max*1.15?'fora':'atencao'}
  if(rule.min!=null){limit=rule.min;gap=round(rule.min-value);if(value<rule.min)status=value<rule.min*0.9?'fora':'atencao'}
  if(status==='ok'&&rule.ideal!=null&&rule.max!=null&&value>rule.ideal)status='ideal-acima'
  out.push({key,label:rule.label||parameterLabels[key],value,max:rule.max??null,min:rule.min??null,ideal:rule.ideal??null,status,gap,percentOfLimit:limit?round(value/limit*100,0):null})
 }
 return out
}
const worst=list=>list.some(x=>x.status==='fora')?'fora':list.some(x=>x.status==='atencao')?'atencao':list.length?'ok':'sem-leitura'

export function buildStorageSummary({units=[],readings=[],receipts=[],standards=defaultStandards}={},options={}){
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now());const todayIso=today(now)
 const last30=[...Array(30)].map((_,i)=>new Date(now.getTime()-(29-i)*864e5).toISOString().slice(0,10))
 const alerts=[]
 const unitSummaries=units.map(u=>{
  const inSeason=r=>(!u.seasonStart||r.date>=u.seasonStart)&&(!u.seasonEnd||r.date<=u.seasonEnd)
  const myReadings=readings.filter(r=>r.unitId===u.id).sort((a,b)=>a.date.localeCompare(b.date)||String(a.createdAt||'').localeCompare(String(b.createdAt||'')))
  const myReceipts=receipts.filter(r=>r.unitId===u.id)
  const commodities=[...new Set([...myReadings.map(r=>r.commodity),...myReceipts.map(r=>r.commodity),...Object.keys(u.goals||{})])]
  const stock=commodities.map(c=>{
   const list=myReadings.filter(r=>r.commodity===c);const latest=list[list.length-1]||null
   const evals=latest?evaluateParams(c,latest.params,standards):[]
   const seasonReceipts=myReceipts.filter(r=>r.commodity===c&&inSeason(r))
   const receivedT=round(seasonReceipts.reduce((s,r)=>s+r.quantityT,0),1);const goalT=u.goals?.[c]||null
   const days=[...new Set(seasonReceipts.map(r=>r.date))].length
   const first=seasonReceipts.map(r=>r.date).sort()[0]||null
   const elapsedDays=first?Math.max(1,Math.round((new Date(todayIso).getTime()-new Date(first).getTime())/864e5)+1):0
   const paceTDay=elapsedDays?round(receivedT/elapsedDays,1):null
   const remainingT=goalT!=null?round(Math.max(0,goalT-receivedT),1):null
   const daysToGoal=remainingT!=null&&paceTDay?Math.ceil(remainingT/paceTDay):null
   const goalPercent=goalT?round(receivedT/goalT*100,0):null
   const seasonDaysLeft=u.seasonEnd?Math.round((new Date(u.seasonEnd).getTime()-new Date(todayIso).getTime())/864e5):null
   let goalStatus=null
   if(goalT){goalStatus=goalPercent>=100?'atingida':seasonDaysLeft!=null&&daysToGoal!=null?(daysToGoal<=seasonDaysLeft?'no-ritmo':'em-risco'):'em-andamento'}
   const weightedMoisture=seasonReceipts.filter(r=>r.params?.moisture!=null).reduce((acc,r)=>{acc.sum+=r.params.moisture*r.quantityT;acc.t+=r.quantityT;return acc},{sum:0,t:0})
   const quality=evals.length?worst(evals):'sem-leitura'
   const trend=list.slice(-8).map(r=>({date:r.date,quantityT:r.quantityT,moisture:r.params?.moisture??null,temperature:r.params?.temperature??null}))
   for(const e of evals){if(e.status==='fora')alerts.push({level:'fora',unitId:u.id,unitName:u.name,commodity:c,commodityLabel:commodityLabels[c]||c,message:`${commodityLabels[c]||c} em ${u.name}: ${e.label.toLowerCase()} em ${String(e.value).replace('.',',')} (limite ${String(e.max??e.min).replace('.',',')}) na leitura de ${latest.date}.`});else if(e.status==='atencao')alerts.push({level:'atencao',unitId:u.id,unitName:u.name,commodity:c,commodityLabel:commodityLabels[c]||c,message:`${commodityLabels[c]||c} em ${u.name}: ${e.label.toLowerCase()} em ${String(e.value).replace('.',',')} passou do limite (${String(e.max??e.min).replace('.',',')}); agir na massa.`})}
   if(goalStatus==='em-risco')alerts.push({level:'atencao',unitId:u.id,unitName:u.name,commodity:c,commodityLabel:commodityLabels[c]||c,message:`Meta de ${commodityLabels[c]||c} em ${u.name}: ${goalPercent}% recebido; no ritmo atual (${paceTDay} t/dia) faltam ${daysToGoal} dias e a safra termina em ${seasonDaysLeft}.`})
   return {commodity:c,label:commodityLabels[c]||c,quantityT:latest?latest.quantityT:0,readingDate:latest?latest.date:null,readingAgeDays:latest?Math.round((new Date(todayIso).getTime()-new Date(latest.date).getTime())/864e5):null,params:latest?latest.params:{},evaluation:evals,quality,receivedT,goalT,goalPercent,remainingT,paceTDay,daysToGoal,goalStatus,receiptDays:days,loads:seasonReceipts.reduce((s,r)=>s+(r.loads||0),0),avgMoistureReceived:weightedMoisture.t?round(weightedMoisture.sum/weightedMoisture.t,1):null,trend}
  })
  const stockT=round(stock.reduce((s,x)=>s+x.quantityT,0),1)
  const occupancy=u.capacityT?round(stockT/u.capacityT*100,0):null
  if(occupancy!=null&&occupancy>=95)alerts.push({level:'fora',unitId:u.id,unitName:u.name,commodity:null,commodityLabel:'',message:`${u.name} com ${occupancy}% da capacidade ocupada: sem espaço para novos recebimentos.`})
  else if(occupancy!=null&&occupancy>=85)alerts.push({level:'atencao',unitId:u.id,unitName:u.name,commodity:null,commodityLabel:'',message:`${u.name} com ${occupancy}% de ocupação; planeje expedição ou transferência.`})
  const stale=stock.filter(x=>x.readingAgeDays!=null&&x.readingAgeDays>7)
  for(const x of stale)alerts.push({level:'info',unitId:u.id,unitName:u.name,commodity:x.commodity,commodityLabel:x.label,message:`${x.label} em ${u.name}: última leitura de qualidade há ${x.readingAgeDays} dias; termometria pede leitura a cada 48–72 h.`})
  const daily=last30.map(d=>{const items=myReceipts.filter(r=>r.date===d);return {date:d,quantityT:round(items.reduce((s,r)=>s+r.quantityT,0),1),byCommodity:Object.fromEntries(commodities.map(c=>[c,round(items.filter(r=>r.commodity===c).reduce((s,r)=>s+r.quantityT,0),1)]))}})
  const receivedSeasonT=round(stock.reduce((s,x)=>s+x.receivedT,0),1);const goalTotalT=round(Object.values(u.goals||{}).reduce((s,v)=>s+v,0),1)
  const freeT=u.capacityT?round(Math.max(0,u.capacityT-stockT),1):null
  return {id:u.id,name:u.name,municipality:u.municipality,kind:u.kind,capacityT:u.capacityT,dryingTDay:u.dryingTDay,receivingTDay:u.receivingTDay,season:u.season,seasonStart:u.seasonStart,seasonEnd:u.seasonEnd,manager:u.manager,stockT,freeT,occupancy,quality:worst(stock.flatMap(x=>x.evaluation)),stock,receivedSeasonT,goalTotalT,goalPercent:goalTotalT?round(receivedSeasonT/goalTotalT*100,0):null,daily,receiptsCount:myReceipts.length,lastReceipt:myReceipts.map(r=>r.date).sort().slice(-1)[0]||null}
 })
 const byCommodity=Object.keys(commodityLabels).map(c=>{
  const rows=unitSummaries.flatMap(u=>u.stock.filter(x=>x.commodity===c).map(x=>({...x,unitId:u.id,unitName:u.name})))
  if(!rows.length)return null
  const stockT=round(rows.reduce((s,x)=>s+x.quantityT,0),1);const receivedT=round(rows.reduce((s,x)=>s+x.receivedT,0),1);const goalT=round(rows.reduce((s,x)=>s+(x.goalT||0),0),1)
  const withReading=rows.filter(x=>x.readingDate)
  const weighted=key=>{const items=withReading.filter(x=>x.params?.[key]!=null&&x.quantityT>0);const t=items.reduce((s,x)=>s+x.quantityT,0);return t?round(items.reduce((s,x)=>s+x.params[key]*x.quantityT,0)/t,1):null}
  const avgParams={};for(const key of parameterKeys){const v=weighted(key);if(v!=null)avgParams[key]=v}
  return {commodity:c,label:commodityLabels[c]||c,stockT,receivedT,goalT,goalPercent:goalT?round(receivedT/goalT*100,0):null,units:rows,quality:worst(rows.flatMap(x=>x.evaluation)),avgParams,evaluation:evaluateParams(c,avgParams,standards),standards:standards[c]||{}}
 }).filter(Boolean)
 const totals={capacityT:round(units.reduce((s,u)=>s+u.capacityT,0),1),stockT:round(unitSummaries.reduce((s,u)=>s+u.stockT,0),1),receivedSeasonT:round(unitSummaries.reduce((s,u)=>s+u.receivedSeasonT,0),1),goalTotalT:round(unitSummaries.reduce((s,u)=>s+u.goalTotalT,0),1),units:units.length}
 totals.occupancy=totals.capacityT?round(totals.stockT/totals.capacityT*100,0):null;totals.goalPercent=totals.goalTotalT?round(totals.receivedSeasonT/totals.goalTotalT*100,0):null
 const last30Total=last30.map(d=>({date:d,quantityT:round(receipts.filter(r=>r.date===d).reduce((s,r)=>s+r.quantityT,0),1)}))
 const order={fora:0,atencao:1,info:2}
 return {computedAt:now.toISOString(),totals,units:unitSummaries,byCommodity,alerts:alerts.sort((a,b)=>order[a.level]-order[b.level]).slice(0,40),last30:last30Total,standards,parameterLabels}
}
