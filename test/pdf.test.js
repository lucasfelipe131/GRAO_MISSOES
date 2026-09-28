import test from 'node:test'
import assert from 'node:assert/strict'
import {createPdf,drawTable,textWidth,toWinAnsi} from '../lib/pdf.js'
import {generalReport,normalizeReportFilters,offersReport,receiptsReport} from '../lib/reports.js'

const parse=buf=>{const s=buf.toString('latin1');const sx=Number(s.slice(s.lastIndexOf('startxref')+9).trim().split(/\s/)[0]);const lines=s.slice(sx).split('\n');assert.equal(lines[0],'xref');const count=Number(lines[1].split(' ')[1]);for(let i=1;i<count;i++){const off=Number(lines[2+i].slice(0,10));assert.equal(s.slice(off,off+`${i} 0 obj`.length),`${i} 0 obj`,'offset do objeto '+i)}return {text:s,objects:count-1}}

test('gerador de PDF: estrutura válida, acentos em WinAnsi e tabela com quebra de página',()=>{
 assert.equal(toWinAnsi('São Luiz — grão • 2ª'),'São Luiz \u0097 grão \u0095 2ª')
 assert.equal(toWinAnsi('→ ≈ ✓ ∑'),'-> ~ ok ?')
 assert.ok(textWidth('VAL',12,true)>textWidth('VAL',12,false))
 const doc=createPdf({title:'Teste'}).addPage()
 doc.text(40,60,'Título com acentuação: ção ã é ê',{size:14,bold:true})
 doc.text(500,80,'direita',{align:'right'});doc.rect(40,100,200,20,{fill:'#F3F6FA',stroke:'#0758B6'});doc.line(40,130,300,130)
 const rows=[...Array(120)].map((_,i)=>({a:'linha '+(i+1),b:(i*1.5).toFixed(2)}))
 drawTable(doc,{columns:[{key:'a',label:'Nome',width:200},{key:'b',label:'Valor',width:80,align:'right'}],rows,x:40,y:150})
 assert.ok(doc.pageCount()>=3)
 doc.eachPage((n,total)=>doc.text(40,820,`Página ${n} de ${total}`,{size:8}))
 const buf=doc.render();assert.equal(buf.slice(0,8).toString('latin1'),'%PDF-1.4')
 const p=parse(buf);assert.ok(p.objects>=doc.pageCount()*2+4);assert.match(p.text,/\/Type \/Catalog/);assert.equal((p.text.match(/\/Type \/Page\b/g)||[]).length,doc.pageCount());assert.match(p.text,/WinAnsiEncoding/);assert.match(p.text,/\(Página 1 de \d+\)/)
})

test('relatórios: ofertas, recebimentos e geral respeitam filtros e geram PDF válido',()=>{
 const now=new Date('2026-09-28T12:00:00Z')
 const offers=[{id:'o1',producerId:'p1',producerName:'João',status:'aceita',closedPrice:146,notes:'travar 2 mil sacas',createdAt:'2026-09-21T10:00:00Z',offer:{commodity:'soja',commodityLabel:'Soja',volumeSc:2000,deliveryLabel:'nov/26',reference:{price:163},freight:{perSc:21.5},margin:{perSc:2.5},offerPrice:139,offerTotal:278000,askingPrice:150}},{id:'o2',producerId:'p2',producerName:'Maria',status:'recusada',createdAt:'2026-08-05T10:00:00Z',offer:{commodity:'milho',commodityLabel:'Milho',volumeSc:500,deliveryLabel:'dez/26',reference:{price:65},freight:{perSc:3},margin:{perSc:2},offerPrice:60,offerTotal:30000}}]
 const units=[{id:'u1',name:'Unidade SLG',capacityT:10000,goals:{soja:8000},seasonStart:'2026-09-01',seasonEnd:'2027-05-31'}]
 const receipts=[{id:'r1',unitId:'u1',commodity:'soja',date:'2026-09-10',quantityT:200,loads:6,params:{moisture:14.8},producerName:'João'},{id:'r2',unitId:'u1',commodity:'soja',date:'2026-09-12',quantityT:300,loads:9,params:{moisture:13}},{id:'r3',unitId:'u1',commodity:'trigo',date:'2026-08-30',quantityT:50}]
 const filters=normalizeReportFilters({from:'2026-09-01',to:'2026-09-30',status:'',unitId:''})
 assert.throws(()=>normalizeReportFilters({from:'2026-09-30',to:'2026-09-01'}),/período/)
 const a=offersReport({offers,filters,now,user:'Chefe'});assert.equal(a.count,1);parse(a.buffer);assert.match(a.buffer.toString('latin1'),/Relatório de ofertas/);assert.equal(a.filename,'ofertas-2026-09-01-2026-09-30.pdf')
 const b=receiptsReport({units,readings:[],receipts,filters,now});assert.equal(b.count,2);parse(b.buffer);assert.match(b.buffer.toString('latin1'),/Metas da safra/)
 const g=generalReport({offers,units,readings:[],receipts,filters:normalizeReportFilters({}),now});assert.equal(g.count,5);const pg=parse(g.buffer);assert.ok((pg.text.match(/\/Type \/Page\b/g)||[]).length>=2)
 const empty=offersReport({offers:[],filters:normalizeReportFilters({producerId:'zzz'}),now});assert.equal(empty.count,0);assert.match(empty.buffer.toString('latin1'),/Nenhuma oferta/)
})
