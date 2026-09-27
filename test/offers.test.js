import test from 'node:test'
import assert from 'node:assert/strict'
import {buildOffer,defaultOfferSettings,freightCost,normalizeOfferInput,normalizeOfferSettings,projectByMonth} from '../lib/offers.js'
import {loadPraca} from '../lib/analysis.js'

const praca=loadPraca();const now=new Date('2026-09-27T12:00:00.000Z')
const producer={id:'p1',name:'João',municipality:'São Luiz Gonzaga',distanceKm:25,costs:{soja:120}}
const quotes=[
 {id:'q1',commodity:'soja',price:163,priceUnit:'BRL/sc_60kg',region:'Porto de Rio Grande (mercado físico)',sourceName:'Notícias Agrícolas',observedAt:'2026-09-25T12:00:00.000Z',status:'active'},
 {id:'q2',commodity:'soja',price:141,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga (C.Vale)',sourceId:'cvale',sourceName:'C.Vale',observedAt:'2026-09-27T09:00:00.000Z',status:'active'},
 {id:'q3',commodity:'soja',price:142,priceUnit:'BRL/sc_60kg',region:'São Luiz Gonzaga (Coopatrigo)',sourceId:'coopatrigo',sourceName:'Coopatrigo',observedAt:'2026-09-27T09:00:00.000Z',status:'active'}
]

test('frete e projeção por vencimento',()=>{
 const f=freightCost({distanceKm:600,ratePerTKm:0.55,fixedPerT:15});assert.equal(f.perT,345);assert.equal(f.perSc,20.7)
 assert.deepEqual(freightCost({distanceKm:0,ratePerTKm:0.55,fixedPerT:15}),{perT:0,perSc:0})
 const proj=projectByMonth({referenceSc:163,seasonality:praca.seasonality.soja,now,months:9,storageCostScMonth:1.2})
 assert.equal(proj.length,10);assert.equal(proj[0].key,'2026-09');assert.equal(proj[0].projected,163);assert.equal(proj[4].key,'2027-01');assert.equal(proj[4].carry,4.8);assert.equal(proj[6].projected,Number((163*97/103).toFixed(2)))
})

test('oferta composta: referência automática de porto, ajuste sazonal, frete, margem e comparações',()=>{
 const input=normalizeOfferInput({producerId:'p1',commodity:'soja',volumeSc:'2000',deliveryMonth:'2026-11',destinationId:'rio-grande',referenceMode:'auto',paymentTerms:'72 h'})
 const offer=buildOffer({input,producer,quotes,praca,settings:defaultOfferSettings},{now})
 assert.equal(offer.reference.mode,'porto');assert.equal(offer.reference.price,163)
 assert.equal(offer.distanceKm,625);assert.equal(offer.freight.perT,Number((625*0.55+15).toFixed(2)))
 assert.equal(offer.projection.index,102);assert.equal(offer.referenceAtDelivery,Number((163*102/103).toFixed(2)))
 assert.equal(offer.offerPrice,Number((offer.referenceAtDelivery-offer.freight.perSc-2.5).toFixed(2)))
 assert.equal(offer.comparison.cvale,141);assert.equal(offer.comparison.competitor.sourceName,'Coopatrigo')
 assert.ok(offer.notes.some(n=>/Cobre o custo/.test(n)));assert.equal(offer.validUntil,'2026-09-29')
 const unitPort=buildOffer({input:normalizeOfferInput({producerId:'p1',commodity:'soja',volumeSc:100,deliveryMonth:'2026-10',destinationId:'cvale-slg',referenceMode:'porto'}),producer,quotes,praca,settings:defaultOfferSettings},{now})
 assert.equal(unitPort.distanceKm,625);assert.match(unitPort.route,/referência de porto/);assert.ok(unitPort.offerPrice<unitPort.comparison.cvale+2)
 const unit=buildOffer({input:normalizeOfferInput({producerId:'p1',commodity:'soja',volumeSc:100,deliveryMonth:'2026-10',destinationId:'cvale-slg',referenceMode:'cvale',marginPerSc:'1'}),producer,quotes,praca,settings:defaultOfferSettings},{now})
 assert.equal(unit.reference.mode,'cvale');assert.equal(unit.distanceKm,25);assert.ok(unit.warnings.some(w=>/abaixo do concorrente/.test(w)))
 const manual=buildOffer({input:normalizeOfferInput({producerId:'p1',commodity:'milho',volumeSc:100,deliveryMonth:'2027-02',referenceMode:'manual',manualReference:'65'}),producer,quotes:[],praca,settings:defaultOfferSettings},{now})
 assert.equal(manual.reference.mode,'manual');assert.equal(manual.projection.index,94)
 const none=buildOffer({input:normalizeOfferInput({producerId:'p1',commodity:'trigo',volumeSc:100,deliveryMonth:'2026-10'}),producer,quotes:[],praca,settings:defaultOfferSettings},{now})
 assert.equal(none.offerPrice,null);assert.ok(none.warnings.some(w=>/Sem referência/.test(w)))
 assert.throws(()=>normalizeOfferInput({producerId:'p1',commodity:'soja',volumeSc:10,deliveryMonth:'nov'}),/vencimento/i)
 assert.throws(()=>normalizeOfferInput({producerId:'p1',commodity:'soja',volumeSc:10,deliveryMonth:'2026-11',referenceMode:'manual'}),/referência manual/)
 assert.throws(()=>normalizeOfferInput({producerId:'p1',commodity:'soja',volumeSc:10,deliveryMonth:'2026-11',askingPrice:'0'}),/pedida do produtor/)
 const askLow=buildOffer({input:normalizeOfferInput({producerId:'p1',commodity:'milho',volumeSc:100,deliveryMonth:'2027-02',referenceMode:'manual',manualReference:'65',askingPrice:'50'}),producer,quotes:[],praca,settings:defaultOfferSettings},{now})
 assert.equal(askLow.askingPrice,50);assert.equal(askLow.asking.status,'atende');assert.ok(askLow.asking.gapSc>0);assert.ok(askLow.notes.some(n=>/atende a pedida/.test(n)))
 const askMid=buildOffer({input:normalizeOfferInput({producerId:'p1',commodity:'milho',volumeSc:100,deliveryMonth:'2027-02',referenceMode:'manual',manualReference:'65',askingPrice:String(askLow.offerPrice+1)}),producer,quotes:[],praca,settings:defaultOfferSettings},{now})
 assert.equal(askMid.asking.status,'ajustavel');assert.equal(askMid.asking.marginToMeet,Math.round((askMid.margin.perSc-1)*100)/100);assert.ok(askMid.warnings.some(w=>/margem cairia/.test(w)))
 const askHigh=buildOffer({input:normalizeOfferInput({producerId:'p1',commodity:'milho',volumeSc:100,deliveryMonth:'2027-02',referenceMode:'manual',manualReference:'65',askingPrice:'90'}),producer,quotes:[],praca,settings:defaultOfferSettings},{now})
 assert.equal(askHigh.asking.status,'inviavel');assert.ok(askHigh.warnings.some(w=>/margem zero/.test(w)))
 const noAsk=buildOffer({input:normalizeOfferInput({producerId:'p1',commodity:'milho',volumeSc:100,deliveryMonth:'2027-02',referenceMode:'manual',manualReference:'65'}),producer,quotes:[],praca,settings:defaultOfferSettings},{now})
 assert.equal(noAsk.asking,null);assert.equal(noAsk.askingPrice,null)
 const settings=normalizeOfferSettings({freightRatePerTKm:'0,60',destinations:[{name:'Moinho X',km:'120',kind:'buyer'}]});assert.equal(settings.freightRatePerTKm,0.6);assert.equal(settings.destinations[0].id,'moinho-x')
 assert.throws(()=>normalizeOfferSettings({freightRatePerTKm:'-1'}),/inválido/)
})
