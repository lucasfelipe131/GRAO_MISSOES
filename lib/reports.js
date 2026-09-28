import {createPdf,drawTable,textWidth} from './pdf.js'
import {commodityLabels,dateOnly} from './analysis.js'
import {buildStorageSummary,defaultStandards} from './storage.js'

const money=v=>v==null||!Number.isFinite(Number(v))?'—':'R$ '+Number(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})
const num=(v,d=0)=>v==null||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d})
const dt=v=>{if(!v)return '—';const d=new Date(v.length===10?v+'T12:00:00Z':v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Sao_Paulo'}).format(d)}
const dtm=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(d)}
const statusLabels={rascunho:'Rascunho',enviada:'Enviada',aceita:'Aceita',recusada:'Recusada',expirada:'Expirada',cancelada:'Cancelada'}

export function normalizeReportFilters(query={}){
 const from=dateOnly(query.from)||null;const to=dateOnly(query.to)||null
 if(from&&to&&to<from)throw Object.assign(new Error('O fim do período não pode ser antes do início.'),{statusCode:400})
 return {from,to,status:String(query.status||'').trim().slice(0,20)||null,producerId:String(query.producerId||'').trim().slice(0,80)||null,unitId:String(query.unitId||'').trim().slice(0,80)||null,commodity:String(query.commodity||'').trim().slice(0,40)||null}
}
const inRange=(iso,f)=>(!f.from||iso>=f.from)&&(!f.to||iso<=f.to)
const periodLabel=f=>f.from&&f.to?`${dt(f.from)} a ${dt(f.to)}`:f.from?`a partir de ${dt(f.from)}`:f.to?`até ${dt(f.to)}`:'todo o período'

function pageHeader(doc,{title,subtitle,now,user}){
 const m=doc.margin
 doc.rect(0,0,doc.W,58,{fill:'#0B1A12'})
 doc.rect(0,58,doc.W,3,{fill:'#8BC34A'})
 doc.text(m,26,'VAL-SOG',{size:16,bold:true,color:'#FFFFFF'})
 doc.text(m+textWidth('VAL-SOG',16,true)+8,26,'Sistema de Operações de Grãos • Missões',{size:8.5,color:'#C9D6C5'})
 doc.text(m,44,title,{size:12,bold:true,color:'#FFFFFF'})
 doc.text(doc.W-m,26,`Gerado em ${dtm(now.toISOString())}`,{size:8,color:'#C9D6C5',align:'right'})
 doc.text(doc.W-m,40,user?`por ${user}`:'',{size:8,color:'#C9D6C5',align:'right'})
 if(subtitle)doc.text(doc.W-m,52,subtitle,{size:8,color:'#C9D6C5',align:'right'})
 return 80
}
function pageFooter(doc,pageNo,total){
 const m=doc.margin;const y=doc.H-22
 doc.line(m,y-8,doc.W-m,y-8,{color:'#DDE4D8'})
 doc.text(m,y,'VAL-SOG • Análise determinística para apoiar a conversa; não é recomendação de investimento nem ordem de negociação.',{size:7,color:'#6B7A70'})
 doc.text(doc.W-m,y,`Página ${pageNo}${total?' de '+total:''}`,{size:7,color:'#6B7A70',align:'right'})
}
function tiles(doc,y,items){
 const m=doc.margin;const gap=8;const w=(doc.W-2*m-gap*(items.length-1))/items.length;const h=44
 items.forEach((t,i)=>{const x=m+i*(w+gap);doc.rect(x,y,w,h,{fill:'#F4F6F1',stroke:'#DDE4D8'});doc.text(x+8,y+13,t.label.toUpperCase(),{size:6.5,bold:true,color:'#6B7A70',maxWidth:w-16});doc.text(x+8,y+30,t.value,{size:12,bold:true,color:'#16241B',maxWidth:w-16});if(t.detail)doc.text(x+8,y+40,t.detail,{size:6.5,color:'#6B7A70',maxWidth:w-16})})
 return y+h+12
}
function sectionTitle(doc,y,title){doc.text(doc.margin,y,title,{size:11,bold:true,color:'#3A7D34'});doc.line(doc.margin,y+5,doc.W-doc.margin,y+5,{color:'#DDE4D8'});return y+16}

function drawOffers(doc,{offers=[],producers=[],filters={},now=new Date(),user=''}={}){
 const list=offers.filter(o=>inRange(String(o.createdAt).slice(0,10),filters)&&(!filters.status||o.status===filters.status)&&(!filters.producerId||o.producerId===filters.producerId)&&(!filters.commodity||o.offer?.commodity===filters.commodity)).sort((l,r)=>String(l.createdAt).localeCompare(String(r.createdAt)))
 const header=d=>pageHeader(d,{title:'Relatório de ofertas aos produtores',subtitle:`Período: ${periodLabel(filters)}${filters.status?' • situação '+(statusLabels[filters.status]||filters.status):''}`,now,user})
 doc.addPage();let y=header(doc)
 const vol=list.reduce((s,o)=>s+(o.offer?.volumeSc||0),0);const total=list.reduce((s,o)=>s+(o.offer?.offerTotal||0),0)
 const priced=list.filter(o=>o.offer?.offerPrice!=null);const avgOffer=priced.length?priced.reduce((s,o)=>s+o.offer.offerPrice*(o.offer.volumeSc||1),0)/priced.reduce((s,o)=>s+(o.offer.volumeSc||1),0):null
 const accepted=list.filter(o=>o.status==='aceita');const decided=list.filter(o=>['aceita','recusada'].includes(o.status))
 const closed=accepted.filter(o=>o.closedPrice!=null);const avgClosed=closed.length?closed.reduce((s,o)=>s+o.closedPrice*(o.offer?.volumeSc||1),0)/closed.reduce((s,o)=>s+(o.offer?.volumeSc||1),0):null
 const asked=list.filter(o=>o.offer?.askingPrice!=null);const avgGap=asked.length?asked.reduce((s,o)=>s+((o.offer.offerPrice??0)-o.offer.askingPrice),0)/asked.length:null
 y=tiles(doc,y,[{label:'Ofertas',value:String(list.length),detail:`${accepted.length} aceita(s) • ${decided.length?Math.round(accepted.length/decided.length*100)+'% de aceite':'sem decisão'}`},{label:'Volume ofertado',value:`${num(vol)} sc`,detail:`${num(vol*0.06,0)} t`},{label:'Valor das ofertas',value:money(total),detail:'soma dos lotes'},{label:'Preço médio ofertado',value:avgOffer!=null?money(avgOffer):'—',detail:'ponderado por volume'},{label:'Preço médio fechado',value:avgClosed!=null?money(avgClosed):'—',detail:closed.length?`${closed.length} fechamento(s)`:'nenhum fechado'},{label:'Oferta × pedida',value:avgGap!=null?(avgGap>=0?'+':'−')+money(Math.abs(avgGap)).replace('R$ ','R$ '):'—',detail:asked.length?`média em ${asked.length} oferta(s) com pedida`:'sem pedida informada'}])
 y=sectionTitle(doc,y,'Ofertas registradas')
 const m=doc.margin;const cols=[
  {key:'createdAt',label:'Data',width:52,value:o=>dt(String(o.createdAt).slice(0,10))},
  {key:'producerName',label:'Produtor',width:92},
  {key:'grao',label:'Grão',width:40,value:o=>o.offer?.commodityLabel||commodityLabels[o.offer?.commodity]||o.offer?.commodity},
  {key:'vol',label:'Volume (sc)',width:52,align:'right',value:o=>num(o.offer?.volumeSc)},
  {key:'venc',label:'Venc.',width:38,value:o=>o.offer?.deliveryLabel||o.offer?.deliveryMonth},
  {key:'ref',label:'Ref.',width:46,align:'right',value:o=>o.offer?.reference?money(o.offer.reference.price).replace('R$ ',''):'—'},
  {key:'frete',label:'Frete',width:38,align:'right',value:o=>o.offer?.freight?num(o.offer.freight.perSc,2):'—'},
  {key:'margem',label:'Margem',width:40,align:'right',value:o=>o.offer?.margin?num(o.offer.margin.perSc,2):'—'},
  {key:'oferta',label:'Oferta',width:46,align:'right',bold:true,value:o=>o.offer?.offerPrice!=null?num(o.offer.offerPrice,2):'—'},
  {key:'pedida',label:'Pedida',width:44,align:'right',value:o=>o.offer?.askingPrice!=null?num(o.offer.askingPrice,2):'—'},
  {key:'status',label:'Situação',width:46,value:o=>statusLabels[o.status]||o.status,color:o=>o.status==='aceita'?'#2F6B2C':o.status==='recusada'||o.status==='cancelada'?'#A54634':'#1B2A3A'},
  {key:'closed',label:'Fechado',width:44,align:'right',value:o=>o.closedPrice!=null?num(o.closedPrice,2):'—'}
 ]
 const scale=(doc.W-2*m)/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*scale)
 if(list.length)y=drawTable(doc,{columns:cols,rows:list,x:m,y,onNewPage:header})
 else{doc.text(m,y+10,'Nenhuma oferta no período e filtros informados.',{size:9,color:'#6B7A70'});y+=24}
 y+=14
 // por situação e por grão
 if(list.length){
  if(y>doc.H-200){doc.addPage();y=header(doc)}
  y=sectionTitle(doc,y,'Resumo por situação e por grão')
  const byStatus=Object.keys(statusLabels).map(s=>{const items=list.filter(o=>o.status===s);if(!items.length)return null;return {label:statusLabels[s],n:items.length,vol:items.reduce((a,o)=>a+(o.offer?.volumeSc||0),0),total:items.reduce((a,o)=>a+(o.offer?.offerTotal||0),0)}}).filter(Boolean)
  const byGrain=[...new Set(list.map(o=>o.offer?.commodity))].map(c=>{const items=list.filter(o=>o.offer?.commodity===c);const v=items.reduce((a,o)=>a+(o.offer?.volumeSc||0),0);const p=items.filter(o=>o.offer?.offerPrice!=null);return {label:commodityLabels[c]||c,n:items.length,vol:v,total:items.reduce((a,o)=>a+(o.offer?.offerTotal||0),0),avg:p.length?p.reduce((a,o)=>a+o.offer.offerPrice*(o.offer.volumeSc||1),0)/p.reduce((a,o)=>a+(o.offer.volumeSc||1),0):null}})
  const half=(doc.W-2*m-12)/2
  const c1=[{key:'label',label:'Situação',width:half*.4},{key:'n',label:'Ofertas',width:half*.18,align:'right'},{key:'vol',label:'Volume (sc)',width:half*.2,align:'right',value:r=>num(r.vol)},{key:'total',label:'Valor',width:half*.22,align:'right',value:r=>money(r.total).replace('R$ ','')}]
  const c2=[{key:'label',label:'Grão',width:half*.3},{key:'n',label:'Ofertas',width:half*.16,align:'right'},{key:'vol',label:'Volume (sc)',width:half*.2,align:'right',value:r=>num(r.vol)},{key:'avg',label:'Média (R$/sc)',width:half*.34,align:'right',value:r=>r.avg!=null?num(r.avg,2):'—'}]
  const y1=drawTable(doc,{columns:c1,rows:byStatus,x:m,y,onNewPage:header});const y2=drawTable(doc,{columns:c2,rows:byGrain,x:m+half+12,y,onNewPage:header});y=Math.max(y1,y2)+14
 }
 // observações
 const notes=list.filter(o=>o.notes||o.offer?.observations)
 if(notes.length){if(y>doc.H-140){doc.addPage();y=header(doc)}y=sectionTitle(doc,y,'Observações registradas');for(const o of notes.slice(0,60)){if(y>doc.H-70){doc.addPage();y=header(doc)}doc.text(m,y+9,`${dt(String(o.createdAt).slice(0,10))} • ${o.producerName} • ${o.offer?.commodityLabel||''}`,{size:8,bold:true,color:'#16241B'});y=doc.wrap(m,y+21,o.notes||o.offer?.observations,{size:8,color:'#1B2A3A',width:doc.W-2*m})+6}}
 return list.length
}
export function offersReport(args={}){const doc=createPdf({title:'Relatório de ofertas — VAL-SOG'});const count=drawOffers(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`ofertas-${args.filters?.from||'inicio'}-${args.filters?.to||'hoje'}.pdf`}}

function drawReceipts(doc,{units=[],readings=[],receipts=[],standards=defaultStandards,filters={},now=new Date(),user=''}={}){
 const list=receipts.filter(r=>inRange(r.date,filters)&&(!filters.unitId||r.unitId===filters.unitId)&&(!filters.commodity||r.commodity===filters.commodity)).sort((l,r)=>l.date.localeCompare(r.date)||String(l.createdAt||'').localeCompare(String(r.createdAt||'')))
 const unitName=id=>units.find(u=>u.id===id)?.name||'—'
 const header=d=>pageHeader(d,{title:'Relatório de recebimentos de grãos',subtitle:`Período: ${periodLabel(filters)}${filters.unitId?' • '+unitName(filters.unitId):''}${filters.commodity?' • '+(commodityLabels[filters.commodity]||filters.commodity):''}`,now,user})
 doc.addPage();let y=header(doc)
 const totalT=list.reduce((s,r)=>s+r.quantityT,0);const loads=list.reduce((s,r)=>s+(r.loads||0),0);const disc=list.reduce((s,r)=>s+(r.discountT||0),0)
 const wet=list.filter(r=>r.params?.moisture!=null);const avgMoist=wet.length?wet.reduce((s,r)=>s+r.params.moisture*r.quantityT,0)/wet.reduce((s,r)=>s+r.quantityT,0):null
 const days=new Set(list.map(r=>r.date)).size
 const summary=buildStorageSummary({units,readings,receipts,standards},{now})
 y=tiles(doc,y,[{label:'Recebido',value:`${num(totalT,1)} t`,detail:`${num(totalT/0.06)} sc`},{label:'Cargas',value:num(loads),detail:loads?`${num(totalT/loads,1)} t por carga`:'não informadas'},{label:'Dias com recebimento',value:String(days),detail:days?`${num(totalT/days,1)} t/dia`:'—'},{label:'Umidade média',value:avgMoist!=null?num(avgMoist,1)+'%':'—',detail:'ponderada pelo volume'},{label:'Descontos',value:`${num(disc,1)} t`,detail:totalT?num(disc/totalT*100,1)+'% do recebido':'—'},{label:'Unidades',value:String(new Set(list.map(r=>r.unitId)).size),detail:`${units.length} cadastrada(s)`}])
 // metas
 const goalRows=summary.units.flatMap(u=>u.stock.filter(x=>x.goalT||x.receivedT).filter(x=>(!filters.unitId||u.id===filters.unitId)&&(!filters.commodity||x.commodity===filters.commodity)).map(x=>({unit:u.name,grain:x.label,received:x.receivedT,goal:x.goalT,pct:x.goalPercent,pace:x.paceTDay,days:x.daysToGoal,status:x.goalStatus,stock:x.quantityT,occ:u.occupancy})))
 const m=doc.margin
 if(goalRows.length){
  y=sectionTitle(doc,y,'Metas da safra por unidade e grão (acumulado da safra, independe do período do relatório)')
  const gc=[{key:'unit',label:'Unidade',width:120},{key:'grain',label:'Grão',width:60},{key:'received',label:'Recebido (t)',width:70,align:'right',value:r=>num(r.received,1)},{key:'goal',label:'Meta (t)',width:60,align:'right',value:r=>r.goal?num(r.goal,1):'—'},{key:'pct',label:'% meta',width:50,align:'right',value:r=>r.pct!=null?r.pct+'%':'—'},{key:'pace',label:'Ritmo (t/dia)',width:66,align:'right',value:r=>r.pace!=null?num(r.pace,1):'—'},{key:'days',label:'Dias p/ meta',width:60,align:'right',value:r=>r.days!=null?String(r.days):'—'},{key:'status',label:'Situação',width:70,value:r=>({atingida:'Atingida','no-ritmo':'No ritmo','em-risco':'Em risco','em-andamento':'Em andamento'})[r.status]||'—',color:r=>r.status==='em-risco'?'#A54634':r.status==='atingida'?'#2F6B2C':'#1B2A3A'},{key:'stock',label:'Estoque (t)',width:60,align:'right',value:r=>num(r.stock,1)}]
  const scale=(doc.W-2*m)/gc.reduce((s,c)=>s+c.width,0);gc.forEach(c=>c.width=c.width*scale)
  y=drawTable(doc,{columns:gc,rows:goalRows,x:m,y,onNewPage:header})+14
 }
 if(y>doc.H-160){doc.addPage();y=header(doc)}
 y=sectionTitle(doc,y,'Recebimentos no período')
 const cols=[{key:'date',label:'Data',width:52,value:r=>dt(r.date)},{key:'unit',label:'Unidade',width:104,value:r=>unitName(r.unitId)},{key:'grain',label:'Grão',width:44,value:r=>commodityLabels[r.commodity]||r.commodity},{key:'t',label:'Toneladas',width:54,align:'right',bold:true,value:r=>num(r.quantityT,1)},{key:'loads',label:'Cargas',width:38,align:'right',value:r=>r.loads??'—'},{key:'moist',label:'Umid. %',width:44,align:'right',value:r=>r.params?.moisture!=null?num(r.params.moisture,1):'—',color:r=>{const max=standards[r.commodity]?.moisture?.max;return max!=null&&r.params?.moisture>max?'#A54634':'#1B2A3A'}},{key:'imp',label:'Imp. %',width:40,align:'right',value:r=>r.params?.impurities!=null?num(r.params.impurities,1):'—'},{key:'disc',label:'Desc. (t)',width:44,align:'right',value:r=>r.discountT?num(r.discountT,1):'—'},{key:'producer',label:'Produtor',width:80,value:r=>r.producerName||'—'},{key:'notes',label:'Observação',width:120,value:r=>r.notes||r.plate||''}]
 const scale=(doc.W-2*m)/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*scale)
 if(list.length)y=drawTable(doc,{columns:cols,rows:list,x:m,y,onNewPage:header})
 else{doc.text(m,y+10,'Nenhum recebimento no período e filtros informados.',{size:9,color:'#6B7A70'});y+=24}
 y+=14
 if(list.length){
  if(y>doc.H-180){doc.addPage();y=header(doc)}
  y=sectionTitle(doc,y,'Totais por unidade e grão no período')
  const keys=[...new Set(list.map(r=>r.unitId+'|'+r.commodity))].map(k=>{const [u,c]=k.split('|');const items=list.filter(r=>r.unitId===u&&r.commodity===c);const t=items.reduce((s,r)=>s+r.quantityT,0);const w=items.filter(r=>r.params?.moisture!=null);return {unit:unitName(u),grain:commodityLabels[c]||c,t,loads:items.reduce((s,r)=>s+(r.loads||0),0),days:new Set(items.map(r=>r.date)).size,moist:w.length?w.reduce((s,r)=>s+r.params.moisture*r.quantityT,0)/w.reduce((s,r)=>s+r.quantityT,0):null,disc:items.reduce((s,r)=>s+(r.discountT||0),0),max:items.reduce((s,r)=>Math.max(s,r.quantityT),0)}}).sort((a,b)=>b.t-a.t)
  const tc=[{key:'unit',label:'Unidade',width:130},{key:'grain',label:'Grão',width:60},{key:'t',label:'Toneladas',width:70,align:'right',bold:true,value:r=>num(r.t,1)},{key:'sc',label:'Sacas',width:64,align:'right',value:r=>num(r.t/0.06)},{key:'loads',label:'Cargas',width:50,align:'right',value:r=>num(r.loads)},{key:'days',label:'Dias',width:40,align:'right'},{key:'moist',label:'Umid. média %',width:70,align:'right',value:r=>r.moist!=null?num(r.moist,1):'—'},{key:'disc',label:'Descontos (t)',width:70,align:'right',value:r=>num(r.disc,1)}]
  const sc2=(doc.W-2*m)/tc.reduce((s,c)=>s+c.width,0);tc.forEach(c=>c.width=c.width*sc2)
  y=drawTable(doc,{columns:tc,rows:keys,x:m,y,onNewPage:header})+14
 }
 return list.length
}
export function receiptsReport(args={}){const doc=createPdf({title:'Relatório de recebimentos — VAL-SOG'});const count=drawReceipts(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`recebimentos-${args.filters?.from||'inicio'}-${args.filters?.to||'hoje'}.pdf`}}
export function generalReport(args={}){const doc=createPdf({title:'Relatório geral — ofertas e recebimentos — VAL-SOG'});const a=drawOffers(doc,args);const b=drawReceipts(doc,args);finish(doc);return {buffer:doc.render(),count:a+b,filename:`relatorio-geral-${args.filters?.from||'inicio'}-${args.filters?.to||'hoje'}.pdf`}}

function finish(doc){doc.eachPage((n,total)=>pageFooter(doc,n,total))}
