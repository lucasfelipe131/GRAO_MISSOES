import {commodityLabels,domainError,number,text,dateOnly,normalized,selectReference} from './analysis.js'

export const defaultOfferSettings={
 freightRatePerTKm:0.55,freightFixedPerT:15,defaultMarginPerSc:2.5,storageCostScMonth:1.2,validityDays:2,
 destinations:[
  {id:'cvale-slg',name:'Unidade C.Vale — São Luiz Gonzaga',km:0,kind:'unit'},
  {id:'rio-grande',name:'Porto de Rio Grande',km:600,kind:'port'},
  {id:'paranagua',name:'Porto de Paranaguá',km:900,kind:'port'}
 ]
}
const round=(v,d=2)=>Number(Number(v).toFixed(d))
const toSc=(price,unit)=>price==null?null:unit==='BRL/t'?price*0.06:price
const monthNames=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
const offerStatuses=['rascunho','enviada','aceita','recusada','expirada','cancelada']

export function normalizeOfferSettings(input={},current=defaultOfferSettings){
 const out={...current}
 for(const key of ['freightRatePerTKm','freightFixedPerT','defaultMarginPerSc','storageCostScMonth','validityDays']){if(input[key]!==undefined&&input[key]!==''){const v=number(input[key]);if(v===null||v<0)throw domainError(`Valor inválido em ${key}.`);out[key]=v}}
 if(Array.isArray(input.destinations)){out.destinations=input.destinations.map(d=>({id:text(d.id,40)||normalized(d.name).replace(/\s+/g,'-'),name:text(d.name,120),km:Math.max(0,number(d.km)||0),kind:['unit','port','buyer'].includes(d.kind)?d.kind:'buyer'})).filter(d=>d.name).slice(0,20);if(!out.destinations.length)throw domainError('Informe ao menos um destino.')}
 return out
}
export function freightCost({distanceKm=0,ratePerTKm=0,fixedPerT=0}={}){
 const perT=round(Math.max(0,distanceKm)*ratePerTKm+(distanceKm>0?fixedPerT:0));return {perT,perSc:round(perT*0.06)}
}
export function projectByMonth({referenceSc,seasonality=null,now=new Date(),months=9,storageCostScMonth=0,adjustments={}}={}){
 if(!referenceSc)return []
 const cur=now.getUTCMonth()+1;const year=now.getUTCFullYear();const out=[]
 for(let k=0;k<=months;k++){
  const m=((cur-1+k)%12)+1;const y=year+Math.floor((cur-1+k)/12);const key=`${y}-${String(m).padStart(2,'0')}`
  const index=seasonality?seasonality[m-1]:100;const base=seasonality?seasonality[cur-1]:100
  const projected=round(referenceSc*index/base);const carry=round(storageCostScMonth*k);const adj=number(adjustments[key])||0
  out.push({key,label:`${monthNames[m-1]}/${String(y).slice(2)}`,monthsAhead:k,index,projected:round(projected+adj),adjustment:adj,carry,netAfterCarry:round(projected+adj-carry)})
 }
 return out
}
export function normalizeOfferInput(input={}){
 const producerId=text(input.producerId,80);if(!producerId)throw domainError('Selecione o produtor da oferta.')
 const commodity=text(input.commodity,40);if(!commodityLabels[commodity])throw domainError('Selecione um grão válido.')
 const volumeSc=number(input.volumeSc);if(volumeSc===null||volumeSc<=0)throw domainError('Informe o volume em sacas.')
 const deliveryMonth=text(input.deliveryMonth,7);if(!/^\d{4}-\d{2}$/.test(deliveryMonth))throw domainError('Informe o vencimento (mês/ano).')
 const destinationId=text(input.destinationId,40)||'cvale-slg'
 const distanceKm=number(input.distanceKm);if(distanceKm!==null&&distanceKm<0)throw domainError('A distância não pode ser negativa.')
 const referenceMode=['auto','porto','cvale','manual'].includes(input.referenceMode)?input.referenceMode:'auto'
 const manualReference=number(input.manualReference);if(referenceMode==='manual'&&!(manualReference>0))throw domainError('Informe a referência manual em R$/sc.')
 const marginPerSc=number(input.marginPerSc);if(marginPerSc!==null&&marginPerSc<0)throw domainError('A margem não pode ser negativa.')
 const adjustment=number(input.adjustment)||0
 const validUntil=dateOnly(input.validUntil);if(input.validUntil&&!validUntil)throw domainError('A validade é inválida.')
 return {producerId,commodity,volumeSc,deliveryMonth,destinationId,distanceKm,referenceMode,manualReference,marginPerSc,adjustment,paymentTerms:text(input.paymentTerms,80),validUntil,notes:text(input.notes,3000),request:text(input.request,1000)}
}
export function buildOffer({input,producer=null,quotes=[],praca=null,settings=defaultOfferSettings},options={}){
 const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
 const label=commodityLabels[input.commodity]||input.commodity
 const destination=settings.destinations.find(d=>d.id===input.destinationId)||settings.destinations[0]
 const fresh=q=>q.status!=='inactive'&&q.commodity===input.commodity&&(now.getTime()-new Date(q.observedAt).getTime())<=7*864e5
 const isPort=q=>/paranagua|rio grande|porto/.test(normalized(q.region))
 const latest=list=>list.sort((a,b)=>new Date(b.observedAt)-new Date(a.observedAt))[0]||null
 const portQ=latest(quotes.filter(q=>fresh(q)&&isPort(q)&&!q.imported))||latest(quotes.filter(q=>fresh(q)&&isPort(q)))
 const ownQ=latest(quotes.filter(q=>fresh(q)&&(q.sourceId==='cvale'||/c\.?vale/i.test(q.sourceName||''))))
 const compQ=selectReference(input.commodity,producer?.deliveryLocation||producer?.municipality||'',quotes.filter(q=>fresh(q)&&!isPort(q)&&!(q.sourceId==='cvale'||/c\.?vale/i.test(q.sourceName||''))),now)
 const notes=[];const warnings=[]
 let reference=null
 if(input.referenceMode==='manual')reference={mode:'manual',price:round(input.manualReference),label:'Referência manual'}
 else if(input.referenceMode==='cvale'&&ownQ)reference={mode:'cvale',price:round(toSc(ownQ.price,ownQ.priceUnit)),label:`C.Vale ${String(ownQ.observedAt).slice(0,10)}`,quoteId:ownQ.id}
 else if(input.referenceMode==='porto'&&portQ)reference={mode:'porto',price:round(toSc(portQ.price,portQ.priceUnit)),label:`${portQ.sourceName} (${portQ.region})`,quoteId:portQ.id}
 else if(portQ)reference={mode:'porto',price:round(toSc(portQ.price,portQ.priceUnit)),label:`${portQ.sourceName} (${portQ.region})`,quoteId:portQ.id}
 else if(ownQ)reference={mode:'cvale',price:round(toSc(ownQ.price,ownQ.priceUnit)),label:`C.Vale ${String(ownQ.observedAt).slice(0,10)}`,quoteId:ownQ.id}
 if(!reference)warnings.push('Sem referência de porto ou C.Vale nos últimos 7 dias; informe uma referência manual ou registre cotações.')
 if(input.referenceMode==='porto'&&!portQ)warnings.push('Sem cotação de porto recente; a referência usada foi outra.')
 const seasonality=praca?.seasonality?.[input.commodity]||null
 const referencePort=settings.destinations.find(d=>d.kind==='port')||{km:600,name:'porto'}
 const farmKm=producer?.distanceKm||0
 let distanceKm;let route
 if(input.distanceKm!=null){distanceKm=input.distanceKm;route='informada'}
 else if(reference?.mode==='porto'){distanceKm=farmKm+(destination.kind==='port'?destination.km:referencePort.km);route=`propriedade → ${destination.kind==='port'?destination.name:referencePort.name} (referência de porto)`}
 else{distanceKm=destination.kind==='unit'?farmKm:farmKm+destination.km;route=destination.kind==='unit'?'propriedade → unidade':`propriedade → ${destination.name}`}
 const freight=freightCost({distanceKm,ratePerTKm:settings.freightRatePerTKm,fixedPerT:settings.freightFixedPerT})
 const marginPerSc=input.marginPerSc!=null?input.marginPerSc:settings.defaultMarginPerSc
 const projections=reference?projectByMonth({referenceSc:reference.price,seasonality,now,months:9,storageCostScMonth:settings.storageCostScMonth}):[]
 const target=projections.find(p=>p.key===input.deliveryMonth)||null
 if(reference&&!target)warnings.push('Vencimento fora do horizonte de 9 meses; a projeção usa a referência atual sem ajuste sazonal.')
 const projected=target?target.projected:(reference?reference.price:null)
 const referenceAtDelivery=projected==null?null:round(projected+input.adjustment)
 const offerPrice=referenceAtDelivery==null?null:round(referenceAtDelivery-freight.perSc-marginPerSc)
 const comparison={cvale:ownQ?round(toSc(ownQ.price,ownQ.priceUnit)):null,competitor:compQ?{price:round(toSc(compQ.price,compQ.priceUnit)),sourceName:compQ.sourceName}:null}
 if(offerPrice!=null&&comparison.competitor&&offerPrice<comparison.competitor.price)warnings.push(`A oferta (${offerPrice.toFixed(2).replace('.',',')}) fica abaixo do concorrente ${comparison.competitor.sourceName} (${comparison.competitor.price.toFixed(2).replace('.',',')}); reveja margem ou frete.`)
 if(offerPrice!=null&&comparison.cvale!=null&&offerPrice>comparison.cvale)notes.push(`A oferta supera o preço C.Vale de hoje em ${(offerPrice-comparison.cvale).toFixed(2).replace('.',',')} por saca por causa da projeção do vencimento; confirme com a mesa.`)
 if(producer?.costs?.[input.commodity]&&offerPrice!=null){const cost=producer.costs[input.commodity];notes.push(offerPrice>=cost?`Cobre o custo do produtor (${cost.toFixed(2).replace('.',',')}) com ${(((offerPrice-cost)/cost)*100).toFixed(1).replace('.',',')}% de margem para ele.`:`Fica ${(cost-offerPrice).toFixed(2).replace('.',',')} abaixo do custo do produtor; dificilmente fecha.`)}
 const validUntil=input.validUntil||new Date(now.getTime()+(settings.validityDays||2)*864e5).toISOString().slice(0,10)
 return {
  computedAt:now.toISOString(),commodity:input.commodity,commodityLabel:label,producer:{id:producer?.id||input.producerId,name:producer?.name||'Produtor',municipality:producer?.municipality||''},
  volumeSc:round(input.volumeSc,0),deliveryMonth:input.deliveryMonth,deliveryLabel:target?.label||input.deliveryMonth,destination,distanceKm:round(distanceKm,0),
  reference,route,projection:target?{index:target.index,baseIndex:projections[0]?.index,projected:target.projected,carry:target.carry}:null,adjustment:input.adjustment,referenceAtDelivery,
  freight:{...freight,ratePerTKm:settings.freightRatePerTKm,fixedPerT:settings.freightFixedPerT,total:round(freight.perSc*input.volumeSc,0)},
  margin:{perSc:round(marginPerSc),percent:referenceAtDelivery?round(marginPerSc/referenceAtDelivery*100,1):null,total:round(marginPerSc*input.volumeSc,0)},
  offerPrice,offerTotal:offerPrice==null?null:round(offerPrice*input.volumeSc,0),paymentTerms:input.paymentTerms||'',validUntil,
  comparison,projections,notes,warnings,request:input.request,observations:input.notes
 }
}
export function normalizeOfferStatus(value){const s=text(value,20);if(!offerStatuses.includes(s))throw domainError('Situação da oferta inválida.');return s}
export {offerStatuses}
