import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {fileURLToPath} from 'node:url'

export const RULES_VERSION='analysis-v1'
export const commodityLabels={soja:'Soja',milho:'Milho',trigo:'Trigo',sorgo:'Sorgo',arroz:'Arroz',canola:'Canola',aveia:'Aveia'}
export const objectives={
 caixa:{label:'Fazer caixa',shares:[50,30,20],note:'Prioriza liquidez: parcela maior no gatilho imediato.'},
 margem:{label:'Maximizar preço médio',shares:[25,35,40],note:'Aceita esperar: parcela maior nos alvos superiores.'},
 risco:{label:'Reduzir risco',shares:[40,35,25],note:'Trava mais cedo e deixa menos volume em aberto.'},
 equilibrio:{label:'Equilíbrio',shares:[34,33,33],note:'Divide o volume em três parcelas semelhantes.'}
}
const directions=new Set(['sell','buy'])
const volumeUnits=new Set(['sc_60kg','t','kg'])
const priceUnits=new Set(['BRL/sc_60kg','BRL/t'])
const monthNames=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']

export const domainError=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode})
export const text=(value,max=240)=>String(value??'').normalize('NFKC').trim().slice(0,max)
export const number=value=>{if(value===null||value===undefined||value==='')return null;let raw=String(value).replace(/\s/g,'');if(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw))raw=raw.replace(/\./g,'');const parsed=Number(raw.replace(',','.'));return Number.isFinite(parsed)?parsed:null}
export const dateOnly=value=>{if(!value)return null;const raw=text(value,10);return /^\d{4}-\d{2}-\d{2}$/.test(raw)?raw:null}
export const isoDate=value=>{if(!value)return null;const parsed=new Date(value);return Number.isNaN(parsed.getTime())?null:parsed.toISOString()}
export const normalized=value=>text(value,240).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
const round=(value,digits=2)=>Number(Number(value).toFixed(digits))
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(value)
const percent=value=>`${Math.abs(value).toFixed(1).replace('.',',')}%`
const toSacks=(volume,unit)=>unit==='t'?volume/0.06:unit==='kg'?volume/60:volume
const toPricePerSack=(price,unit)=>price==null?null:unit==='BRL/t'?price*0.06:price
const monthLabel=month=>monthNames[month-1]||''
const monthRange=months=>months?.length?`${monthLabel(months[0])}–${monthLabel(months[months.length-1])}`:''

let cachedSources=null
export function loadSources(){
 if(cachedSources)return cachedSources
 cachedSources=JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','data','sources.json'),'utf8'))
 return cachedSources
}
let cachedPraca=null
export function loadPraca(){
 if(cachedPraca)return cachedPraca
 cachedPraca=JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'..','data','praca-sao-luiz-gonzaga.json'),'utf8'))
 return cachedPraca
}
export function pracaMatches(praca,location){
 const target=normalized(location);if(!praca||!target)return false
 return [praca.label,...(praca.aliases||[])].some(alias=>{const key=normalized(alias);return key&&(target.includes(key)||key.includes(target))})
}

export function freshnessFor(observedAt,now){
 const hours=Math.max(0,(now.getTime()-new Date(observedAt).getTime())/3_600_000)
 if(hours<=24)return {hours:round(hours,1),label:'Atual',state:'fresh'}
 if(hours<=72)return {hours:round(hours,1),label:'Atenção',state:'attention'}
 if(hours<=168)return {hours:round(hours,1),label:'No limite',state:'limit'}
 return {hours:round(hours,1),label:'Vencida',state:'expired'}
}
const locationMatch=(location,region)=>{const a=normalized(location);const b=normalized(region);return Boolean(a&&b&&(a.includes(b)||b.includes(a)))}
export function selectReference(commodity,location,quotes,now){
 const candidates=quotes.filter(q=>q.status!=='inactive'&&q.commodity===commodity).map(q=>({...q,_freshness:freshnessFor(q.observedAt,now),_regional:locationMatch(location,q.region)}))
 candidates.sort((l,r)=>Number(l._freshness.state==='expired')-Number(r._freshness.state==='expired')||Number(r._regional)-Number(l._regional)||new Date(r.observedAt)-new Date(l.observedAt))
 return candidates[0]||null
}
const portReference=(commodity,quotes,now)=>{
 const candidates=quotes.filter(q=>q.status!=='inactive'&&q.commodity===commodity&&/paranagua|rio grande|porto/.test(normalized(q.region))).map(q=>({...q,_freshness:freshnessFor(q.observedAt,now)})).filter(q=>q._freshness.state!=='expired')
 candidates.sort((l,r)=>new Date(r.observedAt)-new Date(l.observedAt));return candidates[0]||null
}
const stageFor=(calendar,month)=>{
 if(!calendar)return null
 if(calendar.harvest?.includes(month))return {key:'harvest',label:'Colheita',note:'Oferta concentrada; a base costuma piorar e o frete sobe.'}
 if(calendar.planting?.includes(month))return {key:'planting',label:'Plantio',note:'Janela de travar parte da safra nova quando o preço cobre custo mais margem.'}
 if(calendar.recovery?.includes(month))return {key:'recovery',label:'Entressafra',note:'Historicamente a base recupera; bom momento para o volume armazenado.'}
 return {key:'transition',label:'Transição',note:'Sem pressão sazonal clara; a decisão depende do preço e do caixa.'}
}
const daysBetween=(target,now)=>target?Math.ceil((new Date(`${target}T23:59:59`).getTime()-now.getTime())/86_400_000):null

export const producerOptions={
 decisionMaker:{produtor:'Decide sozinho',familia:'Decide com a família',socio:'Decide com sócio',gerente:'Gerente ou administrador decide'},
 riskTolerance:{baixa:'Baixa — prefere travar cedo',media:'Média',alta:'Alta — aceita esperar'},
 sellingStyle:{colheita:'Costuma vender na colheita',escalona:'Escalona ao longo do ano',segura:'Segura e vende na entressafra',misto:'Sem padrão definido'},
 proofPreference:{numeros:'Números e comparativos',vizinhos:'Referência de vizinhos',cooperativa:'Orientação da cooperativa',consultor:'Confia no consultor'},
 paymentPreference:{avista:'À vista',h72:'72 horas',d30:'30 dias ou mais',indiferente:'Indiferente, olha o preço líquido'},
 contactChannel:{whatsapp:'WhatsApp',ligacao:'Ligação',visita:'Visita na propriedade',cooperativa:'Encontro na cooperativa'}
}
const choice=(value,options,fallback='')=>{const key=text(value,40);return options[key]?key:fallback}
export function normalizeProducer(input={}){
 const name=text(input.name,160);if(!name)throw domainError('Informe o nome do produtor.')
 const storageT=number(input.storageT);if(storageT!==null&&storageT<0)throw domainError('A armazenagem não pode ser negativa.')
 const storageCostScMonth=number(input.storageCostScMonth);if(storageCostScMonth!==null&&storageCostScMonth<0)throw domainError('O custo de armazenagem não pode ser negativo.')
 const distanceKm=number(input.distanceKm);if(distanceKm!==null&&distanceKm<0)throw domainError('A distância não pode ser negativa.')
 const costs={};const crops={}
 for(const key of Object.keys(commodityLabels)){
  const cost=number(input[`cost_${key}`]);if(cost!==null&&cost>0)costs[key]=cost
  const areaHa=number(input[`area_${key}`]);const yieldScHa=number(input[`yield_${key}`]);const fixedPercent=number(input[`fixed_${key}`])
  if(areaHa!==null&&areaHa<0)throw domainError(`A área de ${commodityLabels[key].toLowerCase()} não pode ser negativa.`)
  if(yieldScHa!==null&&yieldScHa<0)throw domainError(`A produtividade de ${commodityLabels[key].toLowerCase()} não pode ser negativa.`)
  if(fixedPercent!==null&&(fixedPercent<0||fixedPercent>100))throw domainError(`O percentual fixado de ${commodityLabels[key].toLowerCase()} precisa estar entre 0 e 100.`)
  if(areaHa||yieldScHa||fixedPercent!==null)crops[key]={areaHa:areaHa||0,yieldScHa:yieldScHa||0,fixedPercent:fixedPercent||0}
 }
 const cashMonths=[...new Set((Array.isArray(input.cashMonths)?input.cashMonths:String(input.cashMonths||'').split(',')).map(v=>Number(v)).filter(v=>Number.isInteger(v)&&v>=1&&v<=12))].sort((a,b)=>a-b)
 const usualBuyers=[...new Set(String(input.usualBuyers||'').split(/[,;\n]/).map(v=>text(v,80)).filter(Boolean))].slice(0,12)
 return {name,municipality:text(input.municipality,120)||'São Luiz Gonzaga',deliveryLocation:text(input.deliveryLocation,240),storageT,storageCostScMonth,distanceKm,logistics:text(input.logistics,120),notes:text(input.notes,2000),costs,crops,phone:text(input.phone,40),
  decisionMaker:choice(input.decisionMaker,producerOptions.decisionMaker),riskTolerance:choice(input.riskTolerance,producerOptions.riskTolerance),sellingStyle:choice(input.sellingStyle,producerOptions.sellingStyle),proofPreference:choice(input.proofPreference,producerOptions.proofPreference),paymentPreference:choice(input.paymentPreference,producerOptions.paymentPreference),
  usualBuyers,cashMonths,contactChannel:choice(input.contactChannel,producerOptions.contactChannel),bestContact:text(input.bestContact,120),season:text(input.season,20)||'2026/27'}
}

export function cropPosition(producer,commodity){
 const crop=producer?.crops?.[commodity];if(!crop||!(crop.areaHa>0&&crop.yieldScHa>0))return null
 const productionSc=Math.round(crop.areaHa*crop.yieldScHa);const fixedSc=Math.round(productionSc*(crop.fixedPercent||0)/100)
 return {areaHa:crop.areaHa,yieldScHa:crop.yieldScHa,productionSc,fixedPercent:crop.fixedPercent||0,fixedSc,openSc:productionSc-fixedSc}
}
const paceBands={preplanting:{label:'Pré-plantio',band:[10,30]},planting:{label:'Plantio',band:[25,45]},growing:{label:'Desenvolvimento',band:[40,60]},harvest:{label:'Colheita',band:[60,80]},postharvest:{label:'Pós-colheita',band:[80,100]}}
export function fixingPace(calendar,month,fixedPercent){
 if(!calendar)return null
 const phase=calendar.harvest?.includes(month)?'harvest':calendar.planting?.includes(month)?'planting':(()=>{const p=calendar.planting||[];const h=calendar.harvest||[];if(!p.length||!h.length)return 'growing';const lastPlant=p[p.length-1];const firstHarvest=h[0];const after=m=>lastPlant<firstHarvest?(m>lastPlant&&m<firstHarvest):(m>lastPlant||m<firstHarvest);if(after(month))return 'growing';const lastHarvest=h[h.length-1];const firstPlant=p[0];const post=m=>lastHarvest<firstPlant?(m>lastHarvest&&m<firstPlant-1):(m>lastHarvest||m<firstPlant-1);return post(month)?'postharvest':'preplanting'})()
 const {label,band}=paceBands[phase]
 const status=fixedPercent==null?'unknown':fixedPercent<band[0]?'behind':fixedPercent>band[1]?'ahead':'ok'
 return {phase,label,band,status,statusLabel:status==='behind'?'Abaixo do ritmo de proteção':status==='ahead'?'Acima do ritmo habitual':status==='ok'?'Dentro do ritmo':'Sem posição informada'}
}
const monthNamesLong=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
const monthsUntil=(fromMonth,toMonth)=>((toMonth-fromMonth)%12+12)%12

export function normalizeQuote(input={}){
 const sourceId=text(input.sourceId,60)
 const catalog=sourceId?loadSources().sources.find(item=>item.id===sourceId)||null:null
 if(sourceId&&!catalog)throw domainError('A fonte selecionada não está no catálogo.')
 if(catalog){input={...input,sourceName:input.sourceName||(catalog.requiresName?'':catalog.name),sourceUrl:input.sourceUrl||catalog.url,region:input.region||catalog.region,priceUnit:input.priceUnit||catalog.priceUnit,paymentTerms:input.paymentTerms||catalog.paymentTerms,marketKind:input.marketKind||catalog.marketKind}}
 const commodity=text(input.commodity,40);if(!commodityLabels[commodity])throw domainError('Selecione um grão válido para a cotação.')
 const price=number(input.price);if(price===null||price<=0)throw domainError('Informe uma cotação maior que zero.')
 const priceUnit=text(input.priceUnit||'BRL/sc_60kg',40);if(!priceUnits.has(priceUnit))throw domainError('A unidade da cotação é inválida.')
 const region=text(input.region,240);if(!region)throw domainError('Informe a praça ou comprador da cotação.')
 const sourceName=text(input.sourceName,240);if(!sourceName)throw domainError('Identifique a fonte da cotação.')
 const sourceUrl=text(input.sourceUrl,1000);if(sourceUrl&&!/^https?:\/\//i.test(sourceUrl))throw domainError('O link da fonte precisa começar com http:// ou https://.')
 const observedAt=isoDate(input.observedAt)||new Date().toISOString()
 if(new Date(observedAt).getTime()>Date.now()+3_600_000)throw domainError('A cotação não pode estar no futuro.')
 const marketKind=text(input.marketKind||'spot',20);if(!['spot','forward','futures'].includes(marketKind))throw domainError('O tipo de mercado é inválido.')
 return {commodity,price,priceUnit,region,sourceName,sourceUrl,observedAt,marketKind,paymentTerms:text(input.paymentTerms,120),notes:text(input.notes,1000),sourceId:catalog?catalog.id:'',sourceType:catalog?catalog.type:'manual_quote',confidence:catalog?catalog.confidence:60,status:'active'}
}

export function normalizeRequest(input={}){
 const producerId=text(input.producerId,80);if(!producerId)throw domainError('Selecione o produtor que fez o pedido.')
 const commodity=text(input.commodity,40);if(!commodityLabels[commodity])throw domainError('Selecione um grão válido.')
 const direction=text(input.direction||'sell',20);if(!directions.has(direction))throw domainError('A direção do pedido é inválida.')
 const volume=number(input.volume);if(volume===null||volume<=0)throw domainError('Informe o volume que o produtor quer negociar.')
 const volumeUnit=text(input.volumeUnit||'sc_60kg',30);if(!volumeUnits.has(volumeUnit))throw domainError('A unidade do volume é inválida.')
 const priceUnit=text(input.priceUnit||'BRL/sc_60kg',40);if(!priceUnits.has(priceUnit))throw domainError('A unidade do preço é inválida.')
 const targetPrice=number(input.targetPrice);if(targetPrice!==null&&targetPrice<=0)throw domainError('O preço-alvo precisa ser maior que zero.')
 const costPrice=number(input.costPrice);if(costPrice!==null&&costPrice<=0)throw domainError('O custo de produção precisa ser maior que zero.')
 const objective=text(input.objective||'equilibrio',40);if(!objectives[objective])throw domainError('Escolha o objetivo do produtor.')
 const deliveryStart=dateOnly(input.deliveryStart);const deliveryEnd=dateOnly(input.deliveryEnd)
 if(input.deliveryStart&&!deliveryStart)throw domainError('A data inicial de entrega é inválida.')
 if(input.deliveryEnd&&!deliveryEnd)throw domainError('A data final de entrega é inválida.')
 if(deliveryStart&&deliveryEnd&&deliveryEnd<deliveryStart)throw domainError('A data final de entrega não pode vir antes da inicial.')
 const cashNeedBRL=number(input.cashNeedBRL);if(cashNeedBRL!==null&&cashNeedBRL<0)throw domainError('A necessidade de caixa não pode ser negativa.')
 const cashNeedDate=dateOnly(input.cashNeedDate);if(input.cashNeedDate&&!cashNeedDate)throw domainError('A data do caixa é inválida.')
 const hasStorage=input.hasStorage===undefined||input.hasStorage===null||input.hasStorage===''?null:/^(1|true|yes|sim)$/i.test(String(input.hasStorage))
 return {producerId,commodity,direction,volume,volumeUnit,targetPrice,priceUnit,costPrice,objective,deliveryStart,deliveryEnd,deliveryLocation:text(input.deliveryLocation,240),qualityNotes:text(input.qualityNotes,600),cashNeedBRL,cashNeedDate,hasStorage,request:text(input.request,2000)}
}

export function analyzeRequest({request,producer=null,quotes=[],praca=null},options={}){
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
 const month=now.getUTCMonth()+1
 const label=commodityLabels[request.commodity]||request.commodity
 const sell=request.direction==='sell'
 const volumeSc=toSacks(request.volume,request.volumeUnit)
 const targetSc=toPricePerSack(request.targetPrice,request.priceUnit)
 const costInput=request.costPrice??producer?.costs?.[request.commodity]??null
 const costSc=toPricePerSack(costInput,request.costPrice!=null?request.priceUnit:'BRL/sc_60kg')
 const assumptions=[],alerts=[],dataGaps=[],reasons=[],strategy=[]
 if(request.costPrice==null&&costInput!=null)assumptions.push(`Custo de ${money(costSc)} por saca vem do cadastro do produtor.`)
 const location=request.deliveryLocation||producer?.deliveryLocation||producer?.municipality||''
 const pracaApplies=pracaMatches(praca,location)||pracaMatches(praca,producer?.municipality)
 const pracaCommodity=pracaApplies?praca?.commodities?.[request.commodity]||null:null
 const stage=stageFor(pracaCommodity?.calendar,month)
 const reference=selectReference(request.commodity,location,quotes,now)
 const referenceSc=reference?toPricePerSack(reference.price,reference.priceUnit):null
 const port=portReference(request.commodity,quotes,now)
 const portSc=port?toPricePerSack(port.price,port.priceUnit):null
 const storage=request.hasStorage!==null?request.hasStorage:producer?.storageT!=null?Number(producer.storageT)>0:null
 const deliveryDays=daysBetween(request.deliveryStart||request.deliveryEnd,now)
 const cashDays=daysBetween(request.cashNeedDate,now)

 if(!reference)dataGaps.push('Sem cotação registrada para este grão; registre uma referência com fonte e horário para comparar preço.')
 else{
  reasons.push(`Referência ${reference._freshness.label.toLowerCase()} de ${reference.sourceName} em ${reference.region}: ${money(referenceSc)} por saca${reference.paymentTerms?` (${reference.paymentTerms})`:''}.`)
  if(reference._freshness.state==='expired')alerts.push('A cotação usada está vencida; os alvos ficam indicativos até uma referência nova.')
  if(!reference._regional&&location)alerts.push(`A praça da cotação (${reference.region}) difere do local de entrega (${location}); valide frete e base.`)
 }
 let priceGapPercent=null
 if(reference&&targetSc){priceGapPercent=round((sell?referenceSc-targetSc:targetSc-referenceSc)/targetSc*100);reasons.push(priceGapPercent>=0?`O mercado já ${sell?'atinge':'cabe no'} preço-alvo (${percent(priceGapPercent)} ${sell?'acima':'abaixo'}).`:`O mercado está ${percent(priceGapPercent)} ${sell?'abaixo':'acima'} do preço-alvo de ${money(targetSc)}.`)}
 if(!targetSc)dataGaps.push('Sem preço-alvo do produtor; os alvos partem do mercado e do custo.')
 let marginPercent=null
 if(costSc&&referenceSc){marginPercent=round((referenceSc-costSc)/costSc*100);reasons.push(marginPercent>=0?`A cotação cobre o custo com margem de ${percent(marginPercent)}.`:`A cotação está ${percent(marginPercent)} abaixo do custo.`)}
 if(!costSc)dataGaps.push('Sem custo de produção; a análise não calcula margem nem piso de proteção.')
 let basisSc=null
 if(referenceSc&&portSc&&reference.id!==port.id){basisSc=round(referenceSc-portSc);reasons.push(`Base local contra ${port.region}: ${money(basisSc)} por saca.`)}
 else if(pracaApplies&&praca?.logistics?.basisVsParanaguaBRLPerSc){const b=praca.logistics.basisVsParanaguaBRLPerSc;assumptions.push(`Base histórica da praça contra Paranaguá entre ${money(b.low)} e ${money(b.high)} por saca (${b.source}, ${b.observedAt}).`)}
 const fresh72=q=>q.status!=='inactive'&&q.commodity===request.commodity&&(now.getTime()-new Date(q.observedAt).getTime())<=72*3_600_000&&!/paranagua|rio grande|porto|campinas/.test(normalized(q.region))
 const own=quotes.filter(q=>fresh72(q)&&(q.sourceId==='cvale'||/c\.?vale/i.test(q.sourceName||''))).sort((l,r)=>new Date(r.observedAt)-new Date(l.observedAt))[0]||null
 const competitorsMap=new Map()
 for(const q of quotes.filter(q=>fresh72(q)&&!(q.sourceId==='cvale'||/c\.?vale/i.test(q.sourceName||'')))){const key=q.sourceId||q.sourceName;const current=competitorsMap.get(key);if(!current||new Date(q.observedAt)>new Date(current.observedAt))competitorsMap.set(key,q)}
 const competitors=[...competitorsMap.values()].map(q=>({sourceName:q.sourceName,region:q.region,price:round(toPricePerSack(q.price,q.priceUnit)),observedAt:q.observedAt,automatic:Boolean(q.automatic)})).sort((l,r)=>r.price-l.price)
 const ownSc=own?round(toPricePerSack(own.price,own.priceUnit)):null
 const bestCompetitor=competitors[0]||null
 const competition={own:own?{price:ownSc,observedAt:own.observedAt,paymentTerms:own.paymentTerms||''}:null,competitors,best:bestCompetitor,gapSc:own&&bestCompetitor?round(bestCompetitor.price-ownSc):null}
 if(own&&bestCompetitor){
  if(competition.gapSc>0){alerts.push(`${bestCompetitor.sourceName} paga ${money(competition.gapSc)} por saca acima da C.Vale (${money(bestCompetitor.price)} contra ${money(ownSc)}); o produtor pode ter essa referência na mão.`);strategy.push(`Concorrência acima: mostrar o preço líquido (prazo, frete, desconto de qualidade) e o que a C.Vale entrega além do preço; se a diferença passar de R$ 1,50 por saca, levar ao gestor antes de fechar.`)}
  else if(competition.gapSc<0)reasons.push(`C.Vale está ${money(Math.abs(competition.gapSc))} por saca acima do melhor concorrente lido (${bestCompetitor.sourceName}); a proposta já é competitiva.`)
  else reasons.push(`C.Vale e ${bestCompetitor.sourceName} estão no mesmo preço; prazo e logística decidem.`)
 }else if(!own&&sell)dataGaps.push('Sem cotação da C.Vale registrada nas últimas 72 h; informe o preço do dia no quadro “Preço C.Vale hoje” para comparar com os concorrentes.')
 if(stage)reasons.push(`Momento da praça para ${label.toLowerCase()}: ${stage.label.toLowerCase()} (${stage.note.toLowerCase()})`)
 if(!pracaApplies)assumptions.push('Local de entrega fora da praça mapeada; dicas de calendário e base regional não foram aplicadas.')
 if(storage===null)dataGaps.push('Armazenagem própria não informada; a análise assume venda na entrega.')
 if(deliveryDays!==null&&deliveryDays<0)alerts.push('A janela de entrega informada já venceu; ajuste antes de negociar.')
 if(request.qualityNotes)assumptions.push(`Qualidade declarada: ${request.qualityNotes}.`)
 if(pracaCommodity?.qualityStandard)assumptions.push(pracaCommodity.qualityStandard)

 const baseObjective=objectives[request.objective]
 let shares=[...baseObjective.shares]
 if(producer?.riskTolerance==='baixa'){shares=[Math.min(70,shares[0]+10),shares[1],Math.max(5,shares[2]-10)];assumptions.push('Tolerância a risco baixa: parcela do Alvo 1 aumentada em 10 pontos.')}
 if(producer?.riskTolerance==='alta'){shares=[Math.max(10,shares[0]-10),shares[1],Math.min(60,shares[2]+10)];assumptions.push('Tolerância a risco alta: parcela do Alvo 3 aumentada em 10 pontos.')}
 const objective={...baseObjective,shares}
 const position=cropPosition(producer,request.commodity)
 const pace=position?fixingPace(pracaCommodity?.calendar,month,position.fixedPercent):null
 if(position){
  const requestShare=round(volumeSc/position.productionSc*100,1)
  reasons.push(`Posição da safra: ${position.productionSc.toLocaleString('pt-BR')} sc estimadas (${position.areaHa} ha × ${position.yieldScHa} sc/ha), ${position.fixedPercent}% já fixado; este pedido é ${requestShare}% da produção.`)
  if(sell&&volumeSc>position.openSc)alerts.push(`O pedido (${Math.round(volumeSc).toLocaleString('pt-BR')} sc) supera o volume ainda não fixado (${position.openSc.toLocaleString('pt-BR')} sc); confirme a produção ou o percentual fixado.`)
  if(pace){
   const afterFixed=Math.min(100,round(position.fixedPercent+(sell?requestShare:0),1))
   reasons.push(`Ritmo de fixação na fase ${pace.label.toLowerCase()}: faixa habitual ${pace.band[0]}–${pace.band[1]}%; produtor está em ${position.fixedPercent}% (${pace.statusLabel.toLowerCase()}).`)
   if(pace.status==='behind')strategy.push(`Produtor abaixo do ritmo de proteção para a fase (${position.fixedPercent}% contra ${pace.band[0]}–${pace.band[1]}%): fechar o Alvo 1 leva a posição para ${afterFixed}% e reduz a exposição à colheita.`)
   if(pace.status==='ahead')strategy.push(`Produtor já acima do ritmo habitual (${position.fixedPercent}%): não há pressa; priorizar Alvos 2 e 3 e guardar o restante para a entressafra.`)
   if(pace.status==='ok')strategy.push(`Posição dentro do ritmo da fase; este pedido leva a ${afterFixed}% fixado, ainda dentro do razoável.`)
  }
 }else dataGaps.push('Área e produtividade do produtor não cadastradas; a análise não avalia posição da safra nem ritmo de fixação.')
 if(producer?.sellingStyle==='colheita')strategy.push('Histórico de vender na colheita: propor travar ao menos a parcela do Alvo 1 antes da colheita, quando a base costuma piorar.')
 if(producer?.sellingStyle==='segura'&&storage)strategy.push('Costuma segurar grão: combinar um preço de gatilho para a parcela armazenada e uma data-limite para não passar da janela de recuperação.')
 if(producer?.decisionMaker==='familia'||producer?.decisionMaker==='socio')strategy.push(`Decisão compartilhada (${producer.decisionMaker==='familia'?'família':'sócio'}): levar a escada de alvos por escrito, combinar quem assina e marcar a próxima conversa com todos.`)
 if(producer?.proofPreference==='numeros')strategy.push('Prefere números: levar três cotações com fonte e a comparação porto menos frete.')
 if(producer?.proofPreference==='vizinhos')strategy.push('Prefere referência de vizinhos: mostrar fechamentos recentes da praça (sem nomes) e a média da escada.')
 if(producer?.proofPreference==='cooperativa')strategy.push('Confia na cooperativa: alinhar a cotação da Coopatrigo como base e mostrar o que outros compradores pagam a mais ou a menos.')
 if(producer?.paymentPreference&&producer.paymentPreference!=='indiferente')strategy.push(`Prefere pagamento ${producerOptions.paymentPreference[producer.paymentPreference].toLowerCase()}: pedir todas as cotações nessa condição e converter as demais para comparar.`)
 if(producer?.usualBuyers?.length)strategy.push(`Pedir cotação do dia a ${producer.usualBuyers.join(', ')} antes de fechar qualquer parcela.`)
 if(producer?.storageCostScMonth&&storage&&referenceSc&&pracaCommodity?.calendar?.recovery?.length){
  const target=pracaCommodity.calendar.recovery[0];const wait=monthsUntil(month,target);if(wait>0){const carry=round(producer.storageCostScMonth*wait);strategy.push(`Custo de carregar até ${monthNamesLong[target-1]}: ${money(carry)} por saca (${wait} meses × ${money(producer.storageCostScMonth)}). Só vale esperar se o preço passar de ${money(referenceSc+carry)}.`)}
 }
 if(producer?.cashMonths?.length&&!request.cashNeedBRL){const next=producer.cashMonths.map(m=>({m,d:monthsUntil(month,m)})).sort((a,b)=>a.d-b.d)[0];if(next&&next.d<=2)alerts.push(`O cadastro indica compromisso de caixa em ${monthNamesLong[next.m-1]}; informe o valor no pedido para a análise dimensionar o Alvo 1.`)}
 const anchor=referenceSc||targetSc||costSc||null
 const floor=costSc?costSc*1.03:null
 const closingTargets=[]
 if(anchor){
  const level1=sell?Math.max(anchor,floor||0):anchor
  const level2=sell?Math.max(targetSc||anchor*1.03,level1*1.02):Math.min(targetSc||anchor*0.97,level1*0.98)
  const level3=sell?Math.max(level2*1.04,level1*1.07):Math.min(level2*0.96,level1*0.93)
  const levels=[
   {key:'trigger',label:'Alvo 1 — gatilho imediato',price:level1,condition:reference?`Fechar ao preço ${reference._freshness.state==='fresh'?'executável hoje':'da última referência'}${floor&&level1===floor?', que também cobre custo mais 3%':''}.`:'Fechar assim que uma cotação com fonte atingir este valor.',trigger:sell?'Cotação registrada igual ou superior':'Cotação registrada igual ou inferior'},
   {key:'target',label:'Alvo 2 — preço do produtor',price:level2,condition:targetSc?'Preço-alvo declarado pelo produtor; fechar parcela ao ser atingido.':'Sem preço-alvo declarado; nível derivado da referência mais 3%.',trigger:'Ordem deixada com o comprador'},
   {key:'stretch',label:'Alvo 3 — esticada condicional',price:level3,condition:stage?.key==='harvest'?'Só com melhora de base após a colheita; caso contrário rebaixar para o Alvo 2 em 30 dias.':'Depende de evento de mercado (câmbio, Chicago, prêmio); revisar a cada nova cotação.',trigger:'Evento de mercado confirmado por nova cotação registrada'}
  ]
  levels.forEach((level,index)=>{const share=objective.shares[index];const volume=round(volumeSc*share/100,0);closingTargets.push({...level,price:round(level.price),priceUnit:'BRL/sc_60kg',share,volumeSc:volume,revenueBRL:round(volume*level.price,0),deadline:index===0?(deliveryDays!==null&&deliveryDays>=0?request.deliveryStart||request.deliveryEnd:null):null})})
  if(cashDays!==null&&request.cashNeedBRL){const coverage=closingTargets[0].revenueBRL;if(coverage<request.cashNeedBRL){const needed=Math.ceil(request.cashNeedBRL/closingTargets[0].price);alerts.push(`A parcela do Alvo 1 (${money(coverage)}) não cobre a necessidade de caixa de ${money(request.cashNeedBRL)} em ${cashDays} dias; seriam necessárias cerca de ${needed} sacas no gatilho imediato.`)}else reasons.push(`A parcela do Alvo 1 cobre a necessidade de caixa de ${money(request.cashNeedBRL)}.`)}
 }else dataGaps.push('Sem referência, preço-alvo ou custo não há como calcular alvos de fechamento.')

 const scenarios=anchor?[
  {key:'pessimista',label:'Pessimista',price:round(anchor*(sell?0.95:1.05)),note:'Base piora 5% (pressão de colheita ou frete).'},
  {key:'base',label:'Base',price:round(anchor),note:reference?'Última referência registrada.':'Ponto de partida informado.'},
  {key:'otimista',label:'Otimista',price:round(sell?Math.max(targetSc||0,anchor*1.05):Math.min(targetSc||Infinity,anchor*0.95)),note:'Preço-alvo atingido ou melhora de 5%.'}
 ].map(item=>({...item,revenueBRL:round(volumeSc*item.price,0)})):[]
 const ladderRevenue=closingTargets.reduce((sum,item)=>sum+item.revenueBRL,0)
 const ladderAverage=closingTargets.length?round(ladderRevenue/Math.max(1,closingTargets.reduce((sum,item)=>sum+item.volumeSc,0))):null

 const tips=[]
 if(pracaCommodity?.closingTips)tips.push(...pracaCommodity.closingTips.map(t=>({scope:'praca',text:t})))
 if(storage===false&&stage?.key==='harvest')tips.push({scope:'pedido',text:'Sem armazenagem na colheita: negociar armazenagem paga na cooperativa ou fixar preço antes da entrega para não vender no pior momento.'})
 if(storage===true&&stage?.key==='harvest')tips.push({scope:'pedido',text:`Com armazenagem própria, guardar as parcelas dos Alvos 2 e 3 para ${monthRange(pracaCommodity?.calendar?.recovery)||'a entressafra'}.`})
 if(request.cashNeedBRL)tips.push({scope:'pedido',text:'Fechar primeiro o volume que cobre o caixa e deixar o restante com ordens de venda nos alvos superiores.'})
 if(reference&&reference._freshness.state!=='fresh')tips.push({scope:'pedido',text:'Pedir cotação atualizada a dois compradores antes de qualquer fechamento; a referência atual não é de hoje.'})
 if(priceGapPercent!==null&&priceGapPercent>=0)tips.push({scope:'pedido',text:'O preço-alvo já foi atingido: registrar a confirmação do produtor e executar a parcela do Alvo 1 sem esperar nova alta.'})
 if(priceGapPercent!==null&&priceGapPercent<-5)tips.push({scope:'pedido',text:'O alvo está mais de 5% acima do mercado: combinar com o produtor um alvo intermediário ou uma data-limite para revisar.'})
 if(marginPercent!==null&&marginPercent<0)tips.push({scope:'pedido',text:'Preço abaixo do custo: vender só o necessário para o caixa e registrar a decisão com o produtor.'})
 if(request.direction==='buy')tips.push({scope:'pedido',text:'Compra: comparar preço posto na propriedade (frete incluso) e prazo de pagamento; um preço menor com frete maior pode sair mais caro.'})
 if(!tips.length)tips.push({scope:'geral',text:'Escalonar vendas, comparar duas cotações com fonte e registrar a decisão com o produtor.'})

 const headline=!anchor?`Faltam dados para orientar o pedido de ${label.toLowerCase()}.`
  :priceGapPercent!==null&&priceGapPercent>=0?`O mercado já atende o pedido de ${label.toLowerCase()}: executar o Alvo 1.`
  :priceGapPercent!==null?`${label}: mercado ${percent(priceGapPercent)} ${sell?'abaixo':'acima'} do alvo; escalonar em três parcelas.`
  :`${label}: alvos montados a partir da referência registrada; confirmar preço-alvo com o produtor.`

 return {
  rulesVersion:RULES_VERSION,generatedAt:now.toISOString(),humanReviewRequired:true,automaticTrading:false,headline,
  request:{...request,volumeSc:round(volumeSc,0),targetPriceSc:targetSc==null?null:round(targetSc),costPriceSc:costSc==null?null:round(costSc),objectiveLabel:objective.label,objectiveNote:objective.note,commodityLabel:label},
  producer:{id:producer?.id||request.producerId,name:producer?.name||'Produtor',municipality:producer?.municipality||'',storage,decisionMaker:producer?.decisionMaker||'',riskTolerance:producer?.riskTolerance||'',sellingStyle:producer?.sellingStyle||''},
  position,pace,strategy,
  praca:{applies:pracaApplies,label:pracaApplies?praca?.label:null,stage},
  marketReading:{
   reference:reference?{id:reference.id,price:round(referenceSc),originalPrice:Number(reference.price),originalUnit:reference.priceUnit,region:reference.region,sourceName:reference.sourceName,sourceUrl:reference.sourceUrl||'',paymentTerms:reference.paymentTerms||'',observedAt:reference.observedAt,freshness:reference._freshness.label,freshnessState:reference._freshness.state,regionalMatch:reference._regional}:null,
   port:port?{id:port.id,price:round(portSc),region:port.region,sourceName:port.sourceName,observedAt:port.observedAt}:null,
   basisSc,priceGapPercent,marginPercent,competition
  },
  closingTargets,ladder:{averagePriceSc:ladderAverage,revenueBRL:round(ladderRevenue,0),sharesNote:objective.note},
  scenarios,tips,reasons,alerts,assumptions,dataGaps,
  disclaimer:'Análise determinística e explicável para apoiar a conversa; não é recomendação de investimento nem ordem de negociação. A decisão permanece com o consultor e o produtor.'
 }
}

export function buildBrief({praca=null,quotes=[]}={},options={}){
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
 const month=now.getUTCMonth()+1
 const brief=praca?.marketBrief||{references:[],reading:{},risks:[],sources:[]}
 const ageDays=brief.observedAt?Math.floor((now.getTime()-new Date(`${brief.observedAt}T12:00:00Z`).getTime())/86_400_000):null
 const stale=ageDays!==null&&ageDays>(brief.validityDays||7)
 const commodities=Object.entries(praca?.commodities||{}).map(([commodity,data])=>{
  const registered=quotes.filter(q=>q.status!=='inactive'&&q.commodity===commodity).map(q=>({...q,_freshness:freshnessFor(q.observedAt,now)})).sort((l,r)=>new Date(r.observedAt)-new Date(l.observedAt))[0]||null
  return {commodity,label:commodityLabels[commodity]||commodity,stage:stageFor(data.calendar,month),calendar:data.calendar,qualityStandard:data.qualityStandard,structuralNotes:data.structuralNotes||[],closingTips:data.closingTips||[],reading:brief.reading?.[commodity]||[],seededReferences:(brief.references||[]).filter(r=>r.commodity===commodity),
   registeredReference:registered?{id:registered.id,price:Number(registered.price),priceUnit:registered.priceUnit,region:registered.region,sourceName:registered.sourceName,observedAt:registered.observedAt,freshness:registered._freshness.label,freshnessState:registered._freshness.state}:null}
 })
 return {rulesVersion:RULES_VERSION,generatedAt:now.toISOString(),praca:praca?{id:praca.id,label:praca.label,version:praca.version,updatedAt:praca.updatedAt,geography:praca.geography,buyers:praca.buyers||[],logistics:praca.logistics||{}}:null,
  brief:{observedAt:brief.observedAt||null,ageDays,stale,macro:(brief.references||[]).filter(r=>r.commodity==='cambio'),risks:brief.risks||[],sources:brief.sources||[]},commodities,
  governance:{note:'As referências do briefing são datadas e servem para leitura; a comparação de preço usa somente cotações registradas com fonte e horário.'},
  warning:stale?`O briefing da praça foi observado há ${ageDays} dias; atualize as referências antes de usar na negociação.`:null}
}

export function checkTargets(requests,quotes,now=new Date()){
 const hits=[]
 for(const item of requests){
  if(item.status!=='open'||!item.analysis?.closingTargets?.length)continue
  const reference=selectReference(item.commodity,item.deliveryLocation,quotes,now)
  if(!reference||reference._freshness.state==='expired')continue
  const price=toPricePerSack(reference.price,reference.priceUnit)
  for(const target of item.analysis.closingTargets){
   const hit=item.direction==='sell'?price>=target.price:price<=target.price
   if(hit)hits.push({requestId:item.id,producerName:item.producerName,commodity:item.commodity,target:target.label,targetPrice:target.price,volumeSc:target.volumeSc,marketPrice:round(price),sourceName:reference.sourceName,observedAt:reference.observedAt})
  }
 }
 return hits
}

export function buildPortfolio({producers=[],requests=[],quotes=[],praca=null,sources=[]}={},options={}){
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
 const month=now.getUTCMonth()+1
 const active=quotes.filter(q=>q.status!=='inactive')
 const open=requests.filter(r=>r.status==='open')
 const commodities=Object.keys(praca?.commodities||{}).map(commodity=>{
  const calendar=praca.commodities[commodity].calendar
  let productionSc=0,fixedSc=0;const positions=[]
  for(const producer of producers){const pos=cropPosition(producer,commodity);if(!pos)continue;productionSc+=pos.productionSc;fixedSc+=pos.fixedSc;const pace=fixingPace(calendar,month,pos.fixedPercent);positions.push({producerId:producer.id,producerName:producer.name,...pos,pace})}
  const series=active.filter(q=>q.commodity===commodity&&!/paranagua|rio grande|porto/.test(normalized(q.region))).map(q=>({observedAt:q.observedAt,price:round(toPricePerSack(q.price,q.priceUnit)),sourceName:q.sourceName,region:q.region})).sort((a,b)=>new Date(a.observedAt)-new Date(b.observedAt)).slice(-60)
  const latest=series[series.length-1]||null;const first=series[0]||null
  const openVolumeSc=open.filter(r=>r.commodity===commodity).reduce((sum,r)=>sum+(r.analysis?.request?.volumeSc||toSacks(r.volume,r.volumeUnit)),0)
  return {commodity,label:commodityLabels[commodity]||commodity,stage:stageFor(calendar,month),productionSc,fixedSc,openSc:productionSc-fixedSc,fixedPercent:productionSc?round(fixedSc/productionSc*100,1):null,producersWithPosition:positions.length,behindPace:positions.filter(p=>p.pace?.status==='behind').length,positions,series,latest,changePercent:latest&&first&&first.price?round((latest.price-first.price)/first.price*100,1):null,openRequests:open.filter(r=>r.commodity===commodity).length,openVolumeSc:Math.round(openVolumeSc)}
 })
 const dayAgo=now.getTime()-864e5
 const primary=sources.filter(f=>f.primary)
 const sourcesToday=primary.map(f=>({id:f.id,name:f.name,done:active.some(q=>(q.sourceId===f.id||q.sourceName===f.name)&&new Date(q.observedAt).getTime()>=dayAgo)}))
 const agenda=[]
 const horizon=now.getTime()+45*864e5
 for(const r of open){
  const name=r.producerName||producers.find(p=>p.id===r.producerId)?.name||'Produtor'
  if(r.cashNeedDate){const t=new Date(`${r.cashNeedDate}T12:00:00Z`).getTime();if(t<=horizon)agenda.push({date:r.cashNeedDate,kind:'caixa',label:`${name}: caixa de ${money(r.cashNeedBRL||0)} (${commodityLabels[r.commodity]||r.commodity})`,requestId:r.id,overdue:t<now.getTime()})}
  if(r.deliveryStart){const t=new Date(`${r.deliveryStart}T12:00:00Z`).getTime();if(t<=horizon)agenda.push({date:r.deliveryStart,kind:'entrega',label:`${name}: início da entrega de ${commodityLabels[r.commodity]||r.commodity}`,requestId:r.id,overdue:t<now.getTime()})}
  if(r.analysis?.closingTargets?.[2]&&r.createdAt){const t=new Date(r.createdAt).getTime()+30*864e5;if(t<=horizon&&t>=now.getTime()-864e5*7)agenda.push({date:new Date(t).toISOString().slice(0,10),kind:'revisao',label:`${name}: revisar Alvo 3 de ${commodityLabels[r.commodity]||r.commodity} (30 dias)`,requestId:r.id,overdue:t<now.getTime()})}
 }
 for(const p of producers)for(const m of p.cashMonths||[]){const d=monthsUntil(month,m);if(d<=1){const y=now.getUTCFullYear()+(m<month?1:0);agenda.push({date:`${y}-${String(m).padStart(2,'0')}-01`,kind:'caixa',label:`${p.name}: mês de compromisso de caixa (${monthNamesLong[m-1]})`,producerId:p.id,overdue:false})}}
 agenda.sort((a,b)=>a.date.localeCompare(b.date))
 const attention=[]
 for(const c of commodities)for(const p of c.positions)if(p.pace?.status==='behind')attention.push({producerId:p.producerId,producerName:p.producerName,commodity:c.commodity,label:c.label,fixedPercent:p.fixedPercent,band:p.pace.band,openSc:p.openSc})
 return {
  generatedAt:now.toISOString(),
  kpis:{producers:producers.length,openRequests:open.length,openVolumeSc:Math.round(open.reduce((s,r)=>s+(r.analysis?.request?.volumeSc||toSacks(r.volume,r.volumeUnit)),0)),closedVolumeSc:Math.round(requests.reduce((s,r)=>s+(r.closings||[]).reduce((x,c)=>x+c.volumeSc,0),0)),quotesToday:active.filter(q=>new Date(q.observedAt).getTime()>=dayAgo).length,sourcesMissing:sourcesToday.filter(f=>!f.done).length,behindPace:attention.length,agendaCount:agenda.length},
  commodities,sourcesToday,agenda:agenda.slice(0,30),attention
 }
}
