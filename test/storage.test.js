import test from 'node:test'
import assert from 'node:assert/strict'
import {buildStorageSummary,defaultStandards,evaluateParams,normalizeReading,normalizeReceipt,normalizeStandards,normalizeUnit} from '../lib/storage.js'

const now=new Date('2026-09-27T12:00:00.000Z')

test('unidade, leitura e recebimento são validados',()=>{
 const u=normalizeUnit({name:'Unidade São Luiz',municipality:'São Luiz Gonzaga',capacityT:'12.000',dryingTDay:'600',goal_soja:'9000',goal_milho:'1500',goal_trigo:'0',season:'2026/27',seasonStart:'2026-09-01',seasonEnd:'2027-05-31',kind:'silo'})
 assert.equal(u.capacityT,12000);assert.deepEqual(u.goals,{soja:9000,milho:1500});assert.equal(u.kind,'silo')
 assert.throws(()=>normalizeUnit({name:'x'}),/capacidade/)
 assert.throws(()=>normalizeUnit({name:'x',capacityT:10,seasonStart:'2026-10-01',seasonEnd:'2026-09-01'}),/fim da safra/)
 const r=normalizeReading({unitId:'u1',commodity:'soja',quantityT:'5.500,5',moisture:'13,2',temperature:'22',impurities:'0,8',date:'2026-09-26'})
 assert.equal(r.quantityT,5500.5);assert.deepEqual(r.params,{moisture:13.2,temperature:22,impurities:0.8});assert.equal(r.date,'2026-09-26')
 assert.throws(()=>normalizeReading({unitId:'u1',commodity:'soja'}),/quantidade/)
 const rc=normalizeReceipt({unitId:'u1',commodity:'milho',quantityT:'32',loads:'1',moisture:'15',date:'2026-09-27'})
 assert.equal(rc.quantityT,32);assert.equal(rc.loads,1);assert.equal(rc.params.moisture,15)
 assert.throws(()=>normalizeReceipt({unitId:'u1',commodity:'milho',quantityT:'0'}),/quantidade/)
})

test('padrões: avaliação por limite máximo, mínimo e ideal, e ajuste por unidade',()=>{
 const soja=evaluateParams('soja',{moisture:13,temperature:27,impurities:1.5,damaged:9.5})
 assert.equal(soja.find(x=>x.key==='moisture').status,'ok');assert.equal(soja.find(x=>x.key==='temperature').status,'atencao');assert.equal(soja.find(x=>x.key==='impurities').status,'fora');assert.equal(soja.find(x=>x.key==='damaged').status,'fora')
 const trigo=evaluateParams('trigo',{ph:76,moisture:12.8});assert.equal(trigo.find(x=>x.key==='ph').status,'atencao');assert.equal(trigo.find(x=>x.key==='moisture').status,'ideal-acima')
 const custom=normalizeStandards({soja:{moisture:{max:'13,5',ideal:'12,5'},broken:{}},milho:{ph:{min:70}}})
 assert.equal(custom.soja.moisture.max,13.5);assert.equal(custom.soja.moisture.ideal,12.5);assert.equal(custom.soja.broken,undefined);assert.equal(custom.milho.ph.min,70)
 assert.equal(evaluateParams('soja',{moisture:13.8},custom)[0].status,'atencao')
 assert.equal(defaultStandards.canola.moisture.max,8)
})

test('resumo: ocupação, qualidade, metas com ritmo e alertas',()=>{
 const units=[{id:'u1',name:'São Luiz',capacityT:10000,goals:{soja:8000,milho:1000},seasonStart:'2026-09-01',seasonEnd:'2026-12-31'},{id:'u2',name:'Bossoroca',capacityT:3000,goals:{}}]
 const readings=[
  {id:'r1',unitId:'u1',commodity:'soja',date:'2026-09-20',quantityT:6000,params:{moisture:13,temperature:21}},
  {id:'r2',unitId:'u1',commodity:'soja',date:'2026-09-26',quantityT:7000,params:{moisture:14.6,temperature:26}},
  {id:'r3',unitId:'u1',commodity:'milho',date:'2026-09-15',quantityT:2600,params:{moisture:13}},
  {id:'r4',unitId:'u2',commodity:'trigo',date:'2026-09-27',quantityT:900,params:{moisture:12.5,ph:80}}
 ]
 const receipts=[]
 for(let d=1;d<=27;d++)receipts.push({id:'x'+d,unitId:'u1',commodity:'soja',date:`2026-09-${String(d).padStart(2,'0')}`,quantityT:100,loads:3,params:{moisture:14}})
 receipts.push({id:'m1',unitId:'u1',commodity:'milho',date:'2026-09-10',quantityT:600,params:{moisture:13}})
 receipts.push({id:'old',unitId:'u1',commodity:'soja',date:'2026-08-20',quantityT:500})
 const s=buildStorageSummary({units,readings,receipts,standards:defaultStandards},{now})
 assert.equal(s.totals.capacityT,13000);assert.equal(s.totals.stockT,10500);assert.equal(s.totals.occupancy,81)
 const u1=s.units.find(u=>u.id==='u1');assert.equal(u1.stockT,9600);assert.equal(u1.occupancy,96);assert.equal(u1.quality,'atencao')
 const soja=u1.stock.find(x=>x.commodity==='soja');assert.equal(soja.quantityT,7000);assert.equal(soja.readingDate,'2026-09-26');assert.equal(soja.receivedT,2700);assert.equal(soja.goalPercent,34);assert.equal(soja.paceTDay,100);assert.equal(soja.daysToGoal,53);assert.equal(soja.goalStatus,'no-ritmo');assert.equal(soja.avgMoistureReceived,14)
 assert.equal(soja.evaluation.find(e=>e.key==='moisture').status,'atencao');assert.equal(soja.evaluation.find(e=>e.key==='temperature').status,'atencao')
 const milho=u1.stock.find(x=>x.commodity==='milho');assert.equal(milho.goalPercent,60);assert.equal(milho.readingAgeDays,12)
 assert.ok(s.alerts.some(a=>a.level==='fora'&&/96% da capacidade/.test(a.message)))
 assert.ok(s.alerts.some(a=>/umidade/.test(a.message)&&a.commodity==='soja'))
 assert.ok(s.alerts.some(a=>a.level==='info'&&/12 dias/.test(a.message)))
 const bySoja=s.byCommodity.find(c=>c.commodity==='soja');assert.equal(bySoja.stockT,7000);assert.equal(bySoja.goalT,8000);assert.equal(bySoja.avgParams.moisture,14.6);assert.ok(bySoja.standards.moisture)
 assert.equal(s.last30.length,30);assert.equal(s.last30[s.last30.length-1].quantityT,100);assert.equal(u1.daily[u1.daily.length-1].byCommodity.soja,100)
 const u2=s.units.find(u=>u.id==='u2');assert.equal(u2.quality,'ok');assert.equal(u2.goalPercent,null)
 assert.equal(buildStorageSummary({},{now}).units.length,0)
})
