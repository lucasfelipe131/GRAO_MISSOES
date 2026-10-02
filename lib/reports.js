import {createPdf,drawTable,textWidth} from './pdf.js'
import {buildMarketNow,buildSeasonality,commodityLabels,dateOnly,isCrusher,isOwn,isPortRegion} from './analysis.js'
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

const reqStatus={open:'Aberto',closed:'Concluído',cancelled:'Cancelado'}
const pct=v=>v==null?'—':(v>=0?'+':'')+Number(v).toFixed(1).replace('.',',')+'%'
function drawRequestDetail(doc,r,header,y){
 const a=r.analysis||{};const m=doc.margin;const W=doc.W-2*m
 const need=h=>{if(y+h>doc.H-doc.margin-30){doc.addPage();y=header(doc)}}
 need(90)
 doc.rect(m,y,W,54,{fill:'#0B1A12'});doc.text(m+12,y+16,`${r.producerName||a.producer?.name||'Produtor'}${a.producer?.municipality?' • '+a.producer.municipality:''}`,{size:8,color:'#C9D6C5'})
 doc.text(m+12,y+33,`${a.request?.commodityLabel||commodityLabels[r.commodity]||r.commodity} • ${num(a.request?.volumeSc||r.volume)} sc • ${r.direction==='buy'?'compra':'venda'} • objetivo: ${a.request?.objectiveLabel||r.objective||'—'}`,{size:11,bold:true,color:'#FFFFFF',maxWidth:W-160})
 doc.text(m+W-12,y+16,`Pedido de ${dt(String(r.createdAt).slice(0,10))} • ${reqStatus[r.status]||r.status}`,{size:8,color:'#C9D6C5',align:'right'})
 doc.text(m+W-12,y+33,a.praca?.stage?`praça em ${a.praca.stage.label.toLowerCase()}`:'',{size:8,color:'#B5D95A',align:'right'})
 doc.text(m+12,y+47,a.headline||'',{size:8.5,color:'#EAF0E6',maxWidth:W-24});y+=62
 const mr=a.marketReading||{};const ref=mr.reference
 y=tiles(doc,y,[{label:'Referência usada',value:ref?money(ref.price):'Sem cotação',detail:ref?`${ref.sourceName} • ${ref.freshness||''}`:'registre uma cotação'},{label:'Preço-alvo',value:a.request?.targetPriceSc!=null?money(a.request.targetPriceSc):'—',detail:mr.priceGapPercent==null?'sem comparação':(mr.priceGapPercent>=0?'atingido ':'faltam ')+Math.abs(mr.priceGapPercent).toFixed(1).replace('.',',')+'%'},{label:'Margem sobre custo',value:mr.marginPercent!=null?pct(mr.marginPercent):'—',detail:a.request?.costPriceSc?'custo '+money(a.request.costPriceSc)+'/sc':'sem custo'},{label:'Base × porto',value:mr.basisSc!=null?money(mr.basisSc):'—',detail:mr.port?`${mr.port.region} • ${money(mr.port.price)}`:'sem porto'},{label:'Escada (média)',value:a.ladder?.averagePriceSc?money(a.ladder.averagePriceSc):'—',detail:a.ladder?.revenueBRL?money(a.ladder.revenueBRL):''}])
 if((a.closingTargets||[]).length){
  need(80);doc.text(m,y+2,'Target de fechamento — três alvos escalonados'+(a.ladder?.sharesNote?' ('+a.ladder.sharesNote+')':''),{size:9.5,bold:true,color:'#3A7D34'});y+=10
  const tc=[{key:'label',label:'Alvo',width:150},{key:'share',label:'Parcela',width:46,align:'right',value:t=>t.share+'%'},{key:'volumeSc',label:'Sacas',width:56,align:'right',value:t=>num(t.volumeSc)},{key:'price',label:'Preço (R$/sc)',width:70,align:'right',bold:true,value:t=>num(t.price,2)},{key:'revenueBRL',label:'Receita',width:80,align:'right',value:t=>money(t.revenueBRL).replace('R$ ','')},{key:'trigger',label:'Gatilho',width:113}]
  const sc=W/tc.reduce((s,c)=>s+c.width,0);tc.forEach(c=>c.width=c.width*sc)
  y=drawTable(doc,{columns:tc,rows:a.closingTargets,x:m,y,onNewPage:header,rowHeight:15})+4
  for(const t of a.closingTargets){if(t.condition){need(14);y=doc.wrap(m+4,y+8,`${t.label.split(' — ')[0]}: ${t.condition}`,{size:7.5,color:'#6B7A70',width:W-8})}}y+=6
 }
 if((a.scenarios||[]).length){need(40);doc.text(m,y+2,'Cenários',{size:9.5,bold:true,color:'#3A7D34'});y+=10;const sc=[{key:'label',label:'Cenário',width:90},{key:'price',label:'Preço (R$/sc)',width:80,align:'right',value:s=>num(s.price,2)},{key:'revenueBRL',label:'Receita do pedido',width:100,align:'right',value:s=>money(s.revenueBRL).replace('R$ ','')},{key:'note',label:'Leitura',width:245}];const f=W/sc.reduce((s,c)=>s+c.width,0);sc.forEach(c=>c.width=c.width*f);y=drawTable(doc,{columns:sc,rows:a.scenarios,x:m,y,onNewPage:header,rowHeight:15})+8}
 const comp=mr.competition;if(comp&&(comp.own||(comp.competitors||[]).length)){need(40);doc.text(m,y+2,'C.Vale × concorrência (últimas 72 h)',{size:9.5,bold:true,color:'#3A7D34'});y+=10;const rows=[...(comp.own?[{sourceName:'C.Vale',price:comp.own.price,observedAt:comp.own.observedAt,own:true}]:[]),...(comp.competitors||[])];const cc=[{key:'sourceName',label:'Comprador',width:220,value:x=>x.sourceName+(x.crusher?' (esmagadora)':'')},{key:'price',label:'R$/sc',width:70,align:'right',bold:true,value:x=>num(x.price,2)},{key:'diff',label:'vs C.Vale',width:70,align:'right',value:x=>comp.own&&!x.own?(x.price-comp.own.price>=0?'+':'')+num(x.price-comp.own.price,2):'—'},{key:'observedAt',label:'Leitura',width:155,value:x=>dtm(x.observedAt)+(x.automatic?' • auto':'')}];const f=W/cc.reduce((s,c)=>s+c.width,0);cc.forEach(c=>c.width=c.width*f);y=drawTable(doc,{columns:cc,rows,x:m,y,onNewPage:header,rowHeight:15})+8}
 const lists=[['Por que estes alvos',a.reasons],['Estratégia para o produtor',a.strategy],['Dicas de fechamento',(a.tips||[]).map(t=>t.text)],['Alertas',a.alerts],['Lacunas de dados',a.dataGaps],['Premissas',a.assumptions]]
 for(const [title,items] of lists){if(!(items||[]).length)continue;need(30);doc.text(m,y+2,title,{size:9.5,bold:true,color:title==='Alertas'?'#A54634':'#3A7D34'});y+=12;for(const it of items.slice(0,12)){need(24);doc.text(m+2,y+8,'•',{size:8,color:'#6B7A70'});y=doc.wrap(m+12,y+8,String(it),{size:8,color:'#1B2A3A',width:W-14})+3}y+=4}
 if((r.closings||[]).length){need(40);doc.text(m,y+2,'Fechamentos registrados',{size:9.5,bold:true,color:'#3A7D34'});y+=10;const fc=[{key:'at',label:'Data',width:80,value:c=>dt(String(c.at||c.createdAt||'').slice(0,10))},{key:'buyer',label:'Comprador',width:180,value:c=>c.buyer||'—'},{key:'volumeSc',label:'Sacas',width:70,align:'right',value:c=>num(c.volumeSc)},{key:'price',label:'Preço (R$/sc)',width:80,align:'right',bold:true,value:c=>num(c.price,2)},{key:'target',label:'Alvo',width:105,value:c=>c.target||'—'}];const f=W/fc.reduce((s,c)=>s+c.width,0);fc.forEach(c=>c.width=c.width*f);y=drawTable(doc,{columns:fc,rows:r.closings,x:m,y,onNewPage:header,rowHeight:15})+8}
 if(r.request){need(24);doc.text(m,y+2,'Pedido do produtor',{size:9.5,bold:true,color:'#3A7D34'});y=doc.wrap(m,y+14,'“'+r.request+'”',{size:8.5,color:'#1B2A3A',width:W})+6}
 need(16);doc.text(m,y+6,`Análise ${a.rulesVersion||''} gerada em ${dtm(a.generatedAt)} • revisão humana obrigatória; não é ordem de negociação.`,{size:7,color:'#6B7A70'});y+=16
 return y
}
function drawRequests(doc,{requests=[],filters={},now=new Date(),user='',detail=true}={}){
 const list=requests.filter(r=>inRange(String(r.createdAt).slice(0,10),filters)&&(!filters.status||r.status===filters.status)&&(!filters.producerId||r.producerId===filters.producerId)&&(!filters.commodity||r.commodity===filters.commodity)).sort((l,r)=>String(l.createdAt).localeCompare(String(r.createdAt)))
 const header=d=>pageHeader(d,{title:'Relatório de pedidos e análises dos produtores',subtitle:`Período: ${periodLabel(filters)}${filters.status?' • '+(reqStatus[filters.status]||filters.status):''}`,now,user})
 doc.addPage();let y=header(doc);const m=doc.margin
 const vol=list.reduce((s,r)=>s+(r.analysis?.request?.volumeSc||r.volume||0),0)
 const closedSc=list.reduce((s,r)=>s+(r.closings||[]).reduce((a,c)=>a+(c.volumeSc||0),0),0)
 const closedVal=list.reduce((s,r)=>s+(r.closings||[]).reduce((a,c)=>a+(c.volumeSc||0)*(c.price||0),0),0)
 const hit=list.filter(r=>r.analysis?.marketReading?.priceGapPercent!=null&&r.analysis.marketReading.priceGapPercent>=0).length
 const withTarget=list.filter(r=>r.analysis?.request?.targetPriceSc!=null)
 const avgGap=withTarget.length?withTarget.reduce((s,r)=>s+(r.analysis.marketReading?.priceGapPercent||0),0)/withTarget.length:null
 y=tiles(doc,y,[{label:'Pedidos',value:String(list.length),detail:`${list.filter(r=>r.status==='open').length} aberto(s) • ${list.filter(r=>r.status==='closed').length} concluído(s)`},{label:'Volume pedido',value:`${num(vol)} sc`,detail:`${num(vol*0.06)} t`},{label:'Fechado',value:`${num(closedSc)} sc`,detail:vol?Math.round(closedSc/vol*100)+'% do volume':'—'},{label:'Preço médio fechado',value:closedSc?money(closedVal/closedSc):'—',detail:closedSc?money(closedVal)+' no total':'sem fechamentos'},{label:'Alvo já atingido',value:String(hit),detail:withTarget.length?`de ${withTarget.length} com preço-alvo`:'sem preço-alvo'},{label:'Mercado × alvo',value:avgGap!=null?pct(avgGap):'—',detail:'média dos pedidos com alvo'}])
 y=sectionTitle(doc,y,'Pedidos no período')
 const cols=[{key:'createdAt',label:'Data',width:50,value:r=>dt(String(r.createdAt).slice(0,10))},{key:'producerName',label:'Produtor',width:100},{key:'grao',label:'Grão',width:40,value:r=>r.analysis?.request?.commodityLabel||commodityLabels[r.commodity]||r.commodity},{key:'vol',label:'Sacas',width:46,align:'right',value:r=>num(r.analysis?.request?.volumeSc||r.volume)},{key:'obj',label:'Objetivo',width:60,value:r=>r.analysis?.request?.objectiveLabel||r.objective},{key:'ref',label:'Ref.',width:44,align:'right',value:r=>r.analysis?.marketReading?.reference?num(r.analysis.marketReading.reference.price,2):'—'},{key:'alvo',label:'Alvo',width:44,align:'right',value:r=>r.analysis?.request?.targetPriceSc!=null?num(r.analysis.request.targetPriceSc,2):'—'},{key:'gap',label:'Merc.×alvo',width:50,align:'right',value:r=>pct(r.analysis?.marketReading?.priceGapPercent),color:r=>{const g=r.analysis?.marketReading?.priceGapPercent;return g==null?'#1B2A3A':g>=0?'#2F6B2C':'#A54634'}},{key:'a1',label:'Alvo 1',width:44,align:'right',value:r=>r.analysis?.closingTargets?.[0]?num(r.analysis.closingTargets[0].price,2):'—'},{key:'a2',label:'Alvo 2',width:44,align:'right',value:r=>r.analysis?.closingTargets?.[1]?num(r.analysis.closingTargets[1].price,2):'—'},{key:'a3',label:'Alvo 3',width:44,align:'right',value:r=>r.analysis?.closingTargets?.[2]?num(r.analysis.closingTargets[2].price,2):'—'},{key:'closed',label:'Fechado',width:50,align:'right',value:r=>{const sc=(r.closings||[]).reduce((a,c)=>a+(c.volumeSc||0),0);return sc?num(sc)+' sc':'—'}},{key:'status',label:'Situação',width:50,value:r=>reqStatus[r.status]||r.status}]
 const scale=(doc.W-2*m)/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*scale)
 if(list.length)y=drawTable(doc,{columns:cols,rows:list,x:m,y,onNewPage:header})
 else{doc.text(m,y+10,'Nenhum pedido no período e filtros informados.',{size:9,color:'#6B7A70'});y+=24}
 if(detail&&list.length){for(const r of list){doc.addPage();y=header(doc);y=sectionTitle(doc,y,`Análise personalizada — ${r.producerName||'Produtor'}`);drawRequestDetail(doc,r,header,y)}}
 return list.length
}
export function requestsReport(args={}){const doc=createPdf({title:'Relatório de pedidos e análises — VAL-SOG'});const count=drawRequests(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`pedidos-${args.filters?.from||'inicio'}-${args.filters?.to||'hoje'}.pdf`}}
export function requestReport({request,now=new Date(),user=''}={}){
 const doc=createPdf({title:`Análise do pedido — ${request.producerName||'Produtor'} — VAL-SOG`})
 const header=d=>pageHeader(d,{title:'Análise personalizada do pedido',subtitle:`${request.producerName||''} • ${request.analysis?.request?.commodityLabel||request.commodity}`,now,user})
 doc.addPage();const y=header(doc);drawRequestDetail(doc,request,header,y);finish(doc)
 return {buffer:doc.render(),count:1,filename:`analise-${String(request.producerName||'produtor').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-')}-${String(request.createdAt).slice(0,10)}.pdf`}
}

const toSc=(price,unit)=>price==null?null:unit==='BRL/t'?price*0.06:Number(price)
const kindOf=q=>isOwn(q)?'own':isPortRegion(q)?'port':isCrusher(q)?'crusher':'competitor'
const kindLabel={own:'C.Vale',port:'Porto / referência',crusher:'Esmagadora',competitor:'Concorrente'}
function drawQuotes(doc,{quotes=[],praca=null,filters={},now=new Date(),user='',compact=false}={}){
 const commodities=(filters.commodity?[filters.commodity]:Object.keys(praca?.commodities||commodityLabels)).filter(c=>commodityLabels[c])
 const active=quotes.filter(q=>q.status!=='inactive'&&commodities.includes(q.commodity))
 const f={...filters};if(!f.from&&!f.to){f.from=new Date(now.getTime()-30*864e5).toISOString().slice(0,10);f.to=now.toISOString().slice(0,10)}
 const inPeriod=active.filter(q=>inRange(String(q.observedAt).slice(0,10),f))
 const header=d=>pageHeader(d,{title:'Relatório de cotações e comparativo de preços',subtitle:`Período: ${periodLabel(f)}${filters.commodity?' • '+(commodityLabels[filters.commodity]||filters.commodity):''} • comparativo com cotações dos últimos 7 dias`,now,user})
 doc.addPage();let y=header(doc);const m=doc.margin;const W=doc.W-2*m
 const need=h=>{if(y+h>doc.H-doc.margin-30){doc.addPage();y=header(doc)}}
 const fresh=q=>(now.getTime()-new Date(q.observedAt).getTime())<=7*864e5
 const latestBySource=list=>{const map=new Map();for(const q of list){const key=String(q.sourceName||q.sourceId||'').toLowerCase().trim();const cur=map.get(key);if(!cur||new Date(q.observedAt)>new Date(cur.observedAt))map.set(key,q)}return [...map.values()]}
 // tiles
 const sources=new Set(inPeriod.map(q=>q.sourceId||q.sourceName));const auto=inPeriod.filter(q=>q.automatic).length;const manual=inPeriod.filter(q=>!q.automatic&&!q.imported).length;const imported=inPeriod.filter(q=>q.imported).length;const edited=inPeriod.filter(q=>q.edited).length
 y=tiles(doc,y,[{label:'Cotações',value:String(inPeriod.length),detail:`${new Set(inPeriod.map(q=>String(q.observedAt).slice(0,10))).size} dia(s) no período`},{label:'Fontes',value:String(sources.size),detail:`${commodities.length} grão(s)`},{label:'Automáticas',value:String(auto),detail:edited?`${edited} editada(s)`:'sem edições'},{label:'Manuais',value:String(manual),detail:'equipe e C.Vale'},{label:'Histórico',value:String(imported),detail:'importado / séries'},{label:'Com comparativo',value:String(commodities.filter(c=>latestBySource(active.filter(q=>q.commodity===c&&fresh(q))).length>=2).length),detail:'grãos com 2+ fontes'}])
 // 1. comparativo por grão
 y=sectionTitle(doc,y,'Comparativo de compradores por grão (última cotação de cada fonte, últimos 7 dias)')
 for(const c of commodities){
  const rows=latestBySource(active.filter(q=>q.commodity===c&&fresh(q))).map(q=>({...q,sc:toSc(q.price,q.priceUnit),kind:kindOf(q)}))
  if(!rows.length)continue
  const own=rows.find(r=>r.kind==='own')||null;const port=rows.filter(r=>r.kind==='port').sort((a,b)=>b.sc-a.sc)[0]||null
  const order={own:0,crusher:1,competitor:2,port:3};rows.sort((a,b)=>order[a.kind]-order[b.kind]||b.sc-a.sc)
  const best=rows.filter(r=>r.kind==='competitor'||r.kind==='crusher').sort((a,b)=>b.sc-a.sc)[0]||null
  need(60);doc.text(m,y+2,`${commodityLabels[c]||c}${own?' • C.Vale '+money(own.sc):' • sem preço C.Vale recente'}${best?' • melhor concorrente '+best.sourceName+' '+money(best.sc)+(own?' ('+(best.sc-own.sc>=0?'+':'')+num(best.sc-own.sc,2)+')':''):''}${port&&own?' • base C.Vale × porto '+num(own.sc-port.sc,2):''}`,{size:9.5,bold:true,color:'#3A7D34',maxWidth:W});y+=10
  const cols=[{key:'sourceName',label:'Fonte',width:150,value:r=>r.sourceName+(r.crusher||r.kind==='crusher'?' (esmagadora)':'')},{key:'kind',label:'Tipo',width:74,value:r=>kindLabel[r.kind]},{key:'region',label:'Praça',width:100,value:r=>r.region||'—'},{key:'sc',label:'R$/sc',width:50,align:'right',bold:true,value:r=>num(r.sc,2)},{key:'diff',label:'vs C.Vale',width:58,align:'right',value:r=>own&&r.kind!=='own'?(r.sc-own.sc>=0?'+':'')+num(r.sc-own.sc,2):'—',color:r=>own&&r.kind!=='own'?(r.sc>own.sc?'#A54634':'#2F6B2C'):'#1B2A3A'},{key:'terms',label:'Pagamento',width:62,value:r=>r.paymentTerms||'—'},{key:'observedAt',label:'Leitura',width:100,value:r=>dtm(r.observedAt)+(r.automatic?' • auto':r.imported?' • hist.':'')}]
  const sc=W/cols.reduce((s,x)=>s+x.width,0);cols.forEach(x=>x.width=x.width*sc)
  y=drawTable(doc,{columns:cols,rows,x:m,y,onNewPage:header,rowHeight:15})+10
 }
 // 2. estatísticas do período por grão e série
 need(60);y=sectionTitle(doc,y,'Estatísticas do período por grão (R$/sc)')
 const statRows=[]
 for(const c of commodities){const list=inPeriod.filter(q=>q.commodity===c);if(!list.length)continue
  const groups=[['C.Vale',list.filter(isOwn)],['Concorrentes (praça)',list.filter(q=>!isOwn(q)&&!isPortRegion(q))],['Porto / referência',list.filter(q=>!isOwn(q)&&isPortRegion(q))]]
  for(const [label,items] of groups){if(!items.length)continue;const byDay=new Map();for(const q of items){const k=String(q.observedAt).slice(0,10);const v=toSc(q.price,q.priceUnit);const cur=byDay.get(k)||{s:0,n:0};cur.s+=v;cur.n++;byDay.set(k,cur)}const days=[...byDay.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([d,x])=>({d,p:x.s/x.n}));const ps=days.map(x=>x.p);statRows.push({grain:commodityLabels[c]||c,label,n:items.length,days:days.length,min:Math.min(...ps),max:Math.max(...ps),avg:ps.reduce((a,b)=>a+b,0)/ps.length,first:days[0].p,last:days[days.length-1].p,lastDate:days[days.length-1].d})}}
 if(statRows.length){const cols=[{key:'grain',label:'Grão',width:50},{key:'label',label:'Série',width:110},{key:'n',label:'Cotações',width:58,align:'right'},{key:'days',label:'Dias',width:36,align:'right'},{key:'min',label:'Mínima',width:52,align:'right',value:r=>num(r.min,2)},{key:'avg',label:'Média',width:52,align:'right',value:r=>num(r.avg,2)},{key:'max',label:'Máxima',width:52,align:'right',value:r=>num(r.max,2)},{key:'last',label:'Última',width:52,align:'right',bold:true,value:r=>num(r.last,2)},{key:'var',label:'Variação',width:56,align:'right',value:r=>pct((r.last-r.first)/r.first*100),color:r=>r.last>=r.first?'#2F6B2C':'#A54634'},{key:'lastDate',label:'Data',width:55,value:r=>dt(r.lastDate)}];const sc=W/cols.reduce((s,x)=>s+x.width,0);cols.forEach(x=>x.width=x.width*sc);y=drawTable(doc,{columns:cols,rows:statRows,x:m,y,onNewPage:header,rowHeight:15})+10}
 else{doc.text(m,y+10,'Sem cotações no período.',{size:9,color:'#6B7A70'});y+=24}
 // 3. sazonal observado
 const seasonRows=commodities.map(c=>({c,s:buildSeasonality({quotes:active,commodity:c},{now})})).filter(x=>x.s.usable)
 if(seasonRows.length){need(60);y=sectionTitle(doc,y,'Padrão sazonal observado (100 = média dos meses com cotação; 36 meses de praça)');const months=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];const cols=[{key:'grain',label:'Grão',width:60,value:r=>commodityLabels[r.c]||r.c},...months.map((mo,i)=>({key:'m'+i,label:mo,width:36,align:'right',value:r=>r.s.index[i]==null?'—':String(r.s.index[i]),color:r=>r.s.index[i]==null?'#6B7A70':r.s.index[i]>=103?'#2F6B2C':r.s.index[i]<=97?'#A54634':'#1B2A3A'})),{key:'obs',label:'Meses',width:44,align:'right',value:r=>r.s.observedMonths+'/12'}];const sc=W/cols.reduce((s,x)=>s+x.width,0);cols.forEach(x=>x.width=x.width*sc);y=drawTable(doc,{columns:cols,rows:seasonRows,x:m,y,onNewPage:header,rowHeight:15})+10}
 // 4. cotações do período
 if(!compact){
  const sorted=[...inPeriod].sort((l,r)=>String(r.observedAt).localeCompare(String(l.observedAt)));const shown=sorted.slice(0,400)
  need(60);y=sectionTitle(doc,y,`Cotações registradas no período${sorted.length>shown.length?' (400 mais recentes de '+sorted.length+')':' ('+sorted.length+')'}`)
  if(shown.length){const cols=[{key:'observedAt',label:'Data',width:76,value:q=>dtm(q.observedAt)},{key:'commodity',label:'Grão',width:44,value:q=>commodityLabels[q.commodity]||q.commodity},{key:'sourceName',label:'Fonte',width:150},{key:'region',label:'Praça',width:110,value:q=>q.region||'—'},{key:'sc',label:'R$/sc',width:50,align:'right',bold:true,value:q=>num(toSc(q.price,q.priceUnit),2)},{key:'orig',label:'Original',width:60,align:'right',value:q=>q.priceUnit==='BRL/t'?num(q.price,2)+'/t':''},{key:'terms',label:'Pagamento',width:60,value:q=>q.paymentTerms||'—'},{key:'origem',label:'Origem',width:65,value:q=>q.edited?'auto (editada)':q.automatic?'automática':q.imported?'histórico':'manual'}];const sc=W/cols.reduce((s,x)=>s+x.width,0);cols.forEach(x=>x.width=x.width*sc);y=drawTable(doc,{columns:cols,rows:shown,x:m,y,onNewPage:header,rowHeight:14,fontSize:8})+8}
  else{doc.text(m,y+10,'Nenhuma cotação no período.',{size:9,color:'#6B7A70'});y+=24}
 }
 return inPeriod.length
}
export function quotesReport(args={}){const doc=createPdf({title:'Relatório de cotações e comparativo — VAL-SOG'});const count=drawQuotes(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`cotacoes-${args.filters?.from||'30dias'}-${args.filters?.to||'hoje'}.pdf`}}

const paceLabel={behind:'Abaixo do ritmo',ahead:'Acima do ritmo',ok:'No ritmo'}
function drawProducerSheet(doc,{producer:p,portfolio,askingHistory=[],requests=[],offers=[],producerOptions={},map=null},header,y){
 const m=doc.margin;const W=doc.W-2*m;const need=h=>{if(y+h>doc.H-doc.margin-30){doc.addPage();y=header(doc)}}
 const lab=(k,v)=>v?(producerOptions[k]?.[v]||v):'—'
 need(70);doc.rect(m,y,W,46,{fill:'#0B1A12'});doc.text(m+12,y+18,p.name,{size:12,bold:true,color:'#FFFFFF',maxWidth:W-200});doc.text(m+12,y+33,`${p.municipality||'—'}${p.deliveryLocation?' • entrega em '+p.deliveryLocation:''}${p.distanceKm?' • '+num(p.distanceKm)+' km':''}${p.season?' • safra '+p.season:''}`,{size:8,color:'#C9D6C5',maxWidth:W-200})
 doc.text(m+W-12,y+18,`Cadastro ${dt(String(p.createdAt||'').slice(0,10))}`,{size:8,color:'#C9D6C5',align:'right'});doc.text(m+W-12,y+33,p.phone?`${lab('contactChannel',p.contactChannel)} • ${p.phone}`:lab('contactChannel',p.contactChannel),{size:8,color:'#B5D95A',align:'right'});y+=54
 const positions=(portfolio?.commodities||[]).flatMap(c=>c.positions.filter(x=>x.producerId===p.id).map(x=>({...x,label:c.label,stage:c.stage})))
 const prod=positions.reduce((s,x)=>s+x.productionSc,0);const fixed=positions.reduce((s,x)=>s+x.fixedSc,0)
 const myReq=requests.filter(r=>r.producerId===p.id);const myOff=offers.filter(o=>o.producerId===p.id);const hist=askingHistory.find(h=>h.producerId===p.id)
 y=tiles(doc,y,[{label:'Produção',value:prod?num(prod)+' sc':'—',detail:positions.length?positions.map(x=>x.label).join(', '):'sem área cadastrada'},{label:'Já fixado',value:prod?Math.round(fixed/prod*100)+'%':'—',detail:prod?num(fixed)+' sc':''},{label:'Em aberto',value:prod?num(prod-fixed)+' sc':'—',detail:positions.some(x=>x.pace?.status==='behind')?'abaixo do ritmo em '+positions.filter(x=>x.pace?.status==='behind').map(x=>x.label).join(', '):'ritmo ok'},{label:'Armazenagem',value:p.storageT?num(p.storageT)+' t':'—',detail:p.storageCostScMonth?money(p.storageCostScMonth)+'/sc/mês':''},{label:'Pedidos/ofertas',value:`${myReq.length} / ${myOff.length}`,detail:`${myReq.filter(r=>r.status==='open').length} aberto(s) • ${myOff.filter(o=>o.status==='aceita').length} aceita(s)`},{label:'Pedida média',value:hist?.byCommodity?.[0]?money(hist.byCommodity[0].avgAsking):'—',detail:hist?.byCommodity?.[0]?`${hist.byCommodity[0].label} • ${hist.byCommodity[0].n} registro(s)`:'sem pedidas'}])
 {const me=map?.producers?.find(x=>x.id===p.id)||null;if(me){need(58);doc.text(m,y+2,'Localização e logística para a mesa',{size:9.5,bold:true,color:'#3A7D34'});y+=12
  const rows=[['Coordenadas',me.lat!=null?`${me.lat.toFixed(5)}, ${me.lon.toFixed(5)} (${me.coordNote})`:'não informadas'],['Distância até a unidade',me.distanceKm!=null?`${num(me.distanceKm)} km até ${me.nearestUnit?.name||'a unidade'} ${me.distanceSource==='informado'?'(informada no cadastro)':`(estimativa rodoviária; ${num(me.straightKm,1)} km em linha reta × ${String(map.roadFactor).replace('.',',')})`}`:'—'],['Entrega usual',[me.deliveryLocation,me.logistics].filter(Boolean).join(' • ')||'—'],['Capacidade de armazenagem',me.storageT?`${num(me.storageT)} t${me.storageCostScMonth?' • custo '+money(me.storageCostScMonth)+'/sc/mês':''}`:'—'],['Produção / em aberto',me.productionSc?`${num(me.productionSc)} sc produzidas • ${num(me.openSc)} sc em aberto`:'—']]
  rows.forEach(r=>{need(13);doc.text(m,y+8,r[0],{size:7.5,bold:true,color:'#6B7A70'});doc.text(m+150,y+8,r[1],{size:8,color:'#1B2A3A',maxWidth:W-154});y+=13});y+=8}}
 need(60);doc.text(m,y+2,'Perfil de decisão',{size:9.5,bold:true,color:'#3A7D34'});y+=12
 const prof=[['Quem decide',lab('decisionMaker',p.decisionMaker)],['Tolerância a risco',lab('riskTolerance',p.riskTolerance)],['Hábito de venda',lab('sellingStyle',p.sellingStyle)],['O que convence',lab('proofPreference',p.proofPreference)],['Pagamento preferido',lab('paymentPreference',p.paymentPreference)],['Compradores habituais',(p.usualBuyers||[]).join(', ')||'—'],['Meses de caixa',(p.cashMonths||[]).map(mo=>['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][mo-1]).join(', ')||'—'],['Logística',p.logistics||'—']]
 const half=(W-12)/2;prof.forEach((row,i)=>{const x=m+(i%2)*(half+12);if(i%2===0)need(14);doc.text(x,y+8,row[0],{size:7.5,bold:true,color:'#6B7A70'});doc.text(x+110,y+8,row[1],{size:8,color:'#1B2A3A',maxWidth:half-114});if(i%2===1||i===prof.length-1)y+=13});y+=8
 if(positions.length){need(50);doc.text(m,y+2,'Posição da safra por grão',{size:9.5,bold:true,color:'#3A7D34'});y+=10;const cols=[{key:'label',label:'Grão',width:60},{key:'areaHa',label:'Área (ha)',width:56,align:'right',value:x=>num(x.areaHa,1)},{key:'yieldScHa',label:'sc/ha',width:46,align:'right',value:x=>num(x.yieldScHa,1)},{key:'productionSc',label:'Produção (sc)',width:76,align:'right',value:x=>num(x.productionSc)},{key:'fixedPercent',label:'Fixado',width:50,align:'right',value:x=>x.fixedPercent+'%'},{key:'fixedSc',label:'Fixado (sc)',width:66,align:'right',value:x=>num(x.fixedSc)},{key:'openSc',label:'Aberto (sc)',width:70,align:'right',bold:true,value:x=>num(x.openSc)},{key:'cost',label:'Custo R$/sc',width:72,align:'right',value:x=>p.costs?.[x.commodity]?num(p.costs[x.commodity],2):'—'},{key:'pace',label:'Ritmo da fase',width:105,value:x=>x.pace?`${paceLabel[x.pace.status]||x.pace.statusLabel} (${x.pace.band[0]}–${x.pace.band[1]}%)`:'—',color:x=>x.pace?.status==='behind'?'#A54634':x.pace?.status==='ahead'?'#2F5D45':'#2F6B2C'}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:positions,x:m,y,onNewPage:header,rowHeight:15})+8}
 if(hist?.byCommodity?.length){need(40);doc.text(m,y+2,'Histórico de pedidas',{size:9.5,bold:true,color:'#3A7D34'});y+=10;const cols=[{key:'label',label:'Grão',width:60},{key:'n',label:'Pedidas',width:50,align:'right'},{key:'avgAsking',label:'Média',width:60,align:'right',value:c=>num(c.avgAsking,2)},{key:'minAsking',label:'Mín.',width:56,align:'right',value:c=>num(c.minAsking,2)},{key:'maxAsking',label:'Máx.',width:56,align:'right',value:c=>num(c.maxAsking,2)},{key:'lastAsking',label:'Última',width:60,align:'right',bold:true,value:c=>num(c.lastAsking,2)},{key:'avgPremiumVsCvaleSc',label:'vs C.Vale do dia',width:80,align:'right',value:c=>c.avgPremiumVsCvaleSc!=null?(c.avgPremiumVsCvaleSc>=0?'+':'')+num(c.avgPremiumVsCvaleSc,2):'—'},{key:'acceptedRate',label:'Aceite',width:50,align:'right',value:c=>c.acceptedRate!=null?c.acceptedRate+'%':'—'},{key:'avgClosedVsAsking',label:'Fechou vs pedida',width:85,align:'right',value:c=>c.avgClosedVsAsking!=null?(c.avgClosedVsAsking>=0?'+':'')+num(c.avgClosedVsAsking,2):'—'}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:hist.byCommodity,x:m,y,onNewPage:header,rowHeight:15})+4;for(const h of (hist.hints||[]).slice(0,4)){need(14);y=doc.wrap(m+4,y+8,'• '+h,{size:7.5,color:'#6B7A70',width:W-8})}y+=8}
 if(myReq.length||myOff.length){need(40);doc.text(m,y+2,'Pedidos e ofertas recentes',{size:9.5,bold:true,color:'#3A7D34'});y+=10;const rows=[...myReq.map(r=>({date:String(r.createdAt).slice(0,10),kind:'Pedido',grain:r.analysis?.request?.commodityLabel||commodityLabels[r.commodity]||r.commodity,vol:r.analysis?.request?.volumeSc||r.volume,price:r.analysis?.request?.targetPriceSc,ref:r.analysis?.marketReading?.reference?.price,status:reqStatus[r.status]||r.status,closed:(r.closings||[]).reduce((s,c)=>s+(c.volumeSc||0),0)})),...myOff.map(o=>({date:String(o.createdAt).slice(0,10),kind:'Oferta',grain:o.offer?.commodityLabel,vol:o.offer?.volumeSc,price:o.offer?.askingPrice,ref:o.offer?.offerPrice,status:statusLabels[o.status]||o.status,closed:o.closedPrice}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20);const cols=[{key:'date',label:'Data',width:60,value:x=>dt(x.date)},{key:'kind',label:'Tipo',width:50},{key:'grain',label:'Grão',width:50},{key:'vol',label:'Sacas',width:56,align:'right',value:x=>num(x.vol)},{key:'price',label:'Alvo / pedida',width:76,align:'right',value:x=>x.price!=null?num(x.price,2):'—'},{key:'ref',label:'Ref. / oferta',width:76,align:'right',value:x=>x.ref!=null?num(x.ref,2):'—'},{key:'status',label:'Situação',width:70},{key:'closed',label:'Fechado',width:77,align:'right',value:x=>x.kind==='Pedido'?(x.closed?num(x.closed)+' sc':'—'):(x.closed!=null?num(x.closed,2):'—')}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows,x:m,y,onNewPage:header,rowHeight:15})+8}
 if(p.notes){need(30);doc.text(m,y+2,'Observações do cadastro',{size:9.5,bold:true,color:'#3A7D34'});y=doc.wrap(m,y+14,p.notes,{size:8,color:'#1B2A3A',width:W})+6}
 return y
}
function drawProducers(doc,{producers=[],portfolio=null,askingHistory=[],requests=[],offers=[],producerOptions={},filters={},now=new Date(),user='',detail=true}={}){
 const list=producers.filter(p=>(!filters.producerId||p.id===filters.producerId)&&(!filters.commodity||(p.crops?.[filters.commodity]?.areaHa>0))).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))
 const header=d=>pageHeader(d,{title:'Relatório de produtores e carteira',subtitle:`${list.length} produtor(es)${filters.commodity?' • '+(commodityLabels[filters.commodity]||filters.commodity):''} • posição em ${dt(now.toISOString().slice(0,10))}`,now,user})
 doc.addPage();let y=header(doc);const m=doc.margin;const W=doc.W-2*m
 const coms=(portfolio?.commodities||[]).filter(c=>!filters.commodity||c.commodity===filters.commodity).map(c=>({...c,positions:c.positions.filter(x=>list.some(p=>p.id===x.producerId))})).map(c=>{const productionSc=c.positions.reduce((s,x)=>s+x.productionSc,0);const fixedSc=c.positions.reduce((s,x)=>s+x.fixedSc,0);return {...c,productionSc,fixedSc,openSc:productionSc-fixedSc,fixedPercent:productionSc?Math.round(fixedSc/productionSc*1000)/10:null,behindPace:c.positions.filter(x=>x.pace?.status==='behind').length}})
 const prod=coms.reduce((s,c)=>s+c.productionSc,0);const fixed=coms.reduce((s,c)=>s+c.fixedSc,0);const behind=new Set(coms.flatMap(c=>c.positions.filter(x=>x.pace?.status==='behind').map(x=>x.producerId))).size
 const storage=list.reduce((s,p)=>s+(p.storageT||0),0);const withPos=new Set(coms.flatMap(c=>c.positions.map(x=>x.producerId))).size
 y=tiles(doc,y,[{label:'Produtores',value:String(list.length),detail:`${withPos} com área cadastrada`},{label:'Produção',value:prod?num(prod)+' sc':'—',detail:prod?num(prod*0.06)+' t':''},{label:'Fixado',value:prod?Math.round(fixed/prod*100)+'%':'—',detail:prod?num(fixed)+' sc':''},{label:'Em aberto',value:prod?num(prod-fixed)+' sc':'—',detail:'a proteger'},{label:'Abaixo do ritmo',value:String(behind),detail:'produtor(es) × grão'},{label:'Armazenagem',value:storage?num(storage)+' t':'—',detail:`${list.filter(p=>p.storageT).length} produtor(es)`}])
 if(coms.length){y=sectionTitle(doc,y,'Carteira por grão (produção estimada × fixado)');const cols=[{key:'label',label:'Grão',width:70},{key:'stage',label:'Fase da praça',width:80,value:c=>c.stage?.label||'—'},{key:'producersWithPosition',label:'Produtores',width:62,align:'right',value:c=>c.positions.length},{key:'productionSc',label:'Produção (sc)',width:80,align:'right',value:c=>num(c.productionSc)},{key:'fixedSc',label:'Fixado (sc)',width:70,align:'right',value:c=>num(c.fixedSc)},{key:'fixedPercent',label:'Fixado %',width:56,align:'right',bold:true,value:c=>c.fixedPercent!=null?c.fixedPercent+'%':'—'},{key:'openSc',label:'Aberto (sc)',width:80,align:'right',value:c=>num(c.openSc)},{key:'behindPace',label:'Abaixo do ritmo',width:80,align:'right',value:c=>String(c.behindPace),color:c=>c.behindPace?'#A54634':'#1B2A3A'},{key:'ref',label:'Ref. R$/sc',width:70,align:'right',value:c=>c.reference?.price!=null?num(c.reference.price,2):'—'}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:coms,x:m,y,onNewPage:header,rowHeight:15})+12}
 y=sectionTitle(doc,y,'Produtores cadastrados')
 const rows=list.map(p=>{const pos=coms.flatMap(c=>c.positions.filter(x=>x.producerId===p.id).map(x=>({...x,label:c.label})));const prodSc=pos.reduce((s,x)=>s+x.productionSc,0);const fx=pos.reduce((s,x)=>s+x.fixedSc,0);const h=askingHistory.find(x=>x.producerId===p.id);return {p,pos,prodSc,fx,behind:pos.filter(x=>x.pace?.status==='behind').map(x=>x.label).join(', '),req:requests.filter(r=>r.producerId===p.id).length,off:offers.filter(o=>o.producerId===p.id).length,ask:h?.byCommodity?.[0]?.avgAsking??null}})
 const cols=[{key:'name',label:'Produtor',width:110,value:r=>r.p.name},{key:'mun',label:'Município',width:80,value:r=>r.p.municipality||'—'},{key:'km',label:'km',width:32,align:'right',value:r=>r.p.distanceKm?num(r.p.distanceKm):'—'},{key:'crops',label:'Lavouras',width:96,value:r=>r.pos.map(x=>`${x.label} ${num(x.areaHa)} ha`).join(', ')||'—'},{key:'prod',label:'Produção (sc)',width:66,align:'right',value:r=>r.prodSc?num(r.prodSc):'—'},{key:'fx',label:'Fixado',width:46,align:'right',value:r=>r.prodSc?Math.round(r.fx/r.prodSc*100)+'%':'—'},{key:'behind',label:'Abaixo do ritmo',width:70,value:r=>r.behind||'—',color:r=>r.behind?'#A54634':'#1B2A3A'},{key:'risk',label:'Risco / hábito',width:96,value:r=>[r.p.riskTolerance?(producerOptions.riskTolerance?.[r.p.riskTolerance]||r.p.riskTolerance).split(' — ')[0]:null,r.p.sellingStyle?(producerOptions.sellingStyle?.[r.p.sellingStyle]||r.p.sellingStyle):null].filter(Boolean).join(' • ')||'—'},{key:'sto',label:'Armaz. (t)',width:46,align:'right',value:r=>r.p.storageT?num(r.p.storageT):'—'},{key:'act',label:'Ped./ofertas',width:54,align:'right',value:r=>`${r.req}/${r.off}`},{key:'ask',label:'Pedida média',width:60,align:'right',value:r=>r.ask!=null?num(r.ask,2):'—'}]
 const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc)
 if(rows.length)y=drawTable(doc,{columns:cols,rows,x:m,y,onNewPage:header,rowHeight:15})
 else{doc.text(m,y+10,'Nenhum produtor cadastrado com os filtros informados.',{size:9,color:'#6B7A70'});y+=24}
 if(detail){for(const p of list){doc.addPage();y=header(doc);y=sectionTitle(doc,y,`Ficha do produtor — ${p.name}`);drawProducerSheet(doc,{producer:p,portfolio,askingHistory,requests,offers,producerOptions},header,y)}}
 return list.length
}
export function producersReport(args={}){const doc=createPdf({title:'Relatório de produtores e carteira — VAL-SOG'});const count=drawProducers(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`produtores-carteira-${(args.now||new Date()).toISOString().slice(0,10)}.pdf`}}
export function producerReport({producer,...rest}={}){const doc=createPdf({title:`Ficha do produtor — ${producer.name} — VAL-SOG`});const header=d=>pageHeader(d,{title:'Ficha do produtor',subtitle:producer.municipality||'',now:rest.now||new Date(),user:rest.user||''});doc.addPage();const y=header(doc);drawProducerSheet(doc,{producer,...rest},header,y);finish(doc);return {buffer:doc.render(),count:1,filename:`ficha-${String(producer.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-')}.pdf`}}

function drawMap(doc,{map=null,mapImage=null,filters={},now=new Date(),user=''}={}){
 const list=(map?.producers||[]).filter(p=>(!filters.producerId||p.id===filters.producerId)&&(!filters.commodity||p.crops.some(c=>c.commodity===filters.commodity)))
 const units=map?.units||[];const sum=map?.summary||{}
 const header=d=>pageHeader(d,{title:'Mapa de produtores e logística',subtitle:`${list.length} produtor(es) • ${units.length} unidade(s) • fator rodoviário ${String(map?.roadFactor||1.3).replace('.',',')}`,now,user})
 doc.addPage();let y=header(doc);const m=doc.margin;const W=doc.W-2*m
 const withKm=list.filter(p=>p.distanceKm!=null);const located=list.filter(p=>p.lat!=null)
 y=tiles(doc,y,[{label:'Produtores',value:String(list.length),detail:`${located.length} localizados • ${list.length-located.length} sem coordenadas`},{label:'Unidades',value:String(units.length),detail:units.map(u=>u.name).join(', ').slice(0,60)||'—'},{label:'Distância média',value:withKm.length?num(withKm.reduce((s,p)=>s+p.distanceKm,0)/withKm.length)+' km':'—',detail:withKm.length?`máx. ${num(Math.max(...withKm.map(p=>p.distanceKm)))} km`:''},{label:'Produção',value:sum.productionSc?num(list.reduce((s,p)=>s+p.productionSc,0))+' sc':'—',detail:`${num(list.reduce((s,p)=>s+p.openSc,0))} sc em aberto`},{label:'Armazenagem própria',value:num(list.reduce((s,p)=>s+(p.storageT||0),0))+' t',detail:`${list.filter(p=>p.storageT).length} produtor(es)`}])
 // imagem do mapa com os pins (capturada da tela) ou esquema de posições
 const pts=[...located.map(p=>({...p,kind:'produtor'})),...units.map(u=>({...u,kind:'unidade'}))]
 if(mapImage?.jpeg){
  y=sectionTitle(doc,y,`Mapa com os pins${mapImage.layer==='satelite'?' (satélite)':''}`)
  const ratio=mapImage.height/mapImage.width;const iw=W;let ih=Math.round(iw*ratio);const maxH=doc.H-y-doc.margin-70;if(ih>maxH)ih=maxH
  const drawW=ih/ratio;const ix=m+(W-drawW)/2
  doc.rect(ix-1,y-1,drawW+2,ih+2,{stroke:'#DDE4D8'});doc.image(ix,y,drawW,ih,mapImage.jpeg);y+=ih+6
  doc.text(m,y+6,`${mapImage.caption||'Pins numerados na ordem da tabela; quadrado escuro = unidade de recebimento; linha = distância até a unidade mais próxima.'} Fonte do mapa: ${mapImage.layer==='satelite'?'Esri World Imagery':'OpenStreetMap'}.`,{size:7,color:'#6B7A70',maxWidth:W});y+=18
 }
 else if(pts.length){y=sectionTitle(doc,y,'Esquema de posições (linha reta até a unidade mais próxima)')
  const h=230;const x0=m,y0=y,w=W;doc.rect(x0,y0,w,h,{fill:'#F7F9F4',stroke:'#DDE4D8'})
  const lats=pts.map(p=>p.lat),lons=pts.map(p=>p.lon);let minLat=Math.min(...lats),maxLat=Math.max(...lats),minLon=Math.min(...lons),maxLon=Math.max(...lons)
  const cosLat=Math.cos((minLat+maxLat)/2*Math.PI/180);const spanLat=Math.max(maxLat-minLat,0.05);const spanLon=Math.max((maxLon-minLon)*cosLat,0.05)
  const pad=28;const scale=Math.min((w-2*pad)/spanLon,(h-2*pad)/spanLat)
  const cx=x0+w/2,cy=y0+h/2;const midLat=(minLat+maxLat)/2,midLon=(minLon+maxLon)/2
  const px=lon=>cx+(lon-midLon)*cosLat*scale;const py=lat=>cy-(lat-midLat)*scale
  const kmPer=scale/111;doc.text(x0+w-8,y0+h-8,`largura do quadro ≈ ${num(w/kmPer)} km`,{size:6.5,color:'#6B7A70',align:'right'})
  for(const p of located){const u=units.find(x=>x.id===p.nearestUnit?.id);if(u)doc.line(px(p.lon),py(p.lat),px(u.lon),py(u.lat),{color:'#B9C9B3',width:0.5})}
  for(const u of units){doc.rect(px(u.lon)-4,py(u.lat)-4,8,8,{fill:'#0B1A12'});doc.text(px(u.lon)+6,py(u.lat)+3,u.name,{size:6.5,bold:true,color:'#0B1A12',maxWidth:120})}
  located.forEach((p,i)=>{const X=px(p.lon),Y=py(p.lat);doc.rect(X-2.5,Y-2.5,5,5,{fill:p.coordSource==='municipio'?'#8A651D':'#3A7D34'});doc.text(X+4,Y+2.5,`${i+1}`,{size:6,color:'#1B2A3A'})})
  doc.text(x0+8,y0+h-8,'■ unidade   ■ produtor (cadastro)   ■ produtor (sede do município, aproximado)   números = ordem da tabela',{size:6.5,color:'#6B7A70'})
  y=y0+h+12}
 y=sectionTitle(doc,y,'Produtores: localização, distância e capacidades')
 const rows=located.concat(list.filter(p=>p.lat==null))
 const cols=[{key:'n',label:'#',width:18,align:'right',value:r=>{const i=located.indexOf(r);return i>=0?String(i+1):'—'}},{key:'name',label:'Produtor',width:100},{key:'mun',label:'Município',width:78,value:r=>r.municipality||'—'},{key:'coords',label:'Coordenadas',width:88,value:r=>r.lat!=null?`${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}${r.coordSource==='municipio'?' ~':''}`:'—'},{key:'unit',label:'Unidade',width:70,value:r=>r.nearestUnit?.name||'—'},{key:'km',label:'km',width:34,align:'right',bold:true,value:r=>r.distanceKm!=null?num(r.distanceKm):'—',color:r=>r.distanceSource==='informado'?'#1B2A3A':'#3A7D34'},{key:'reta',label:'reta',width:34,align:'right',value:r=>r.straightKm!=null?num(r.straightKm):'—'},{key:'sto',label:'Armaz. (t)',width:46,align:'right',value:r=>r.storageT?num(r.storageT):'—'},{key:'crops',label:'Lavouras (sc em aberto)',width:120,value:r=>r.crops.map(c=>`${c.label} ${num(c.openSc)}`).join(', ')||'—'},{key:'deliv',label:'Entrega / logística',width:90,value:r=>[r.deliveryLocation,r.logistics].filter(Boolean).join(' • ')||'—'}]
 const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc)
 if(rows.length)y=drawTable(doc,{columns:cols,rows,x:m,y,onNewPage:header,rowHeight:15})+8
 else{doc.text(m,y+10,'Nenhum produtor cadastrado com os filtros informados.',{size:9,color:'#6B7A70'});y+=24}
 doc.text(m,y+8,'km em verde = estimativa rodoviária (linha reta × fator); km em preto = distância informada no cadastro. Coordenadas com “~” vêm da sede do município.',{size:7,color:'#6B7A70'});y+=20
 if(units.length){y=sectionTitle(doc,y,'Unidades de recebimento');const ucols=[{key:'name',label:'Unidade',width:140},{key:'municipality',label:'Município',width:100,value:u=>u.municipality||'—'},{key:'kind',label:'Tipo',width:60},{key:'coords',label:'Coordenadas',width:110,value:u=>`${u.lat.toFixed(4)}, ${u.lon.toFixed(4)}`},{key:'capacityT',label:'Capacidade (t)',width:80,align:'right',value:u=>u.capacityT?num(u.capacityT):'—'},{key:'dryingTDay',label:'Secagem t/dia',width:80,align:'right',value:u=>u.dryingTDay?num(u.dryingTDay):'—'},{key:'n',label:'Produtores mais próximos',width:80,align:'right',value:u=>String(located.filter(p=>p.nearestUnit?.id===u.id).length)}];const usc=W/ucols.reduce((s,c)=>s+c.width,0);ucols.forEach(c=>c.width=c.width*usc);y=drawTable(doc,{columns:ucols,rows:units,x:m,y,onNewPage:header,rowHeight:15})+8}
 return list.length
}
export function mapReport(args={}){const doc=createPdf({title:'Mapa de produtores e logística — VAL-SOG'});const count=drawMap(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`mapa-produtores-${(args.now||new Date()).toISOString().slice(0,10)}.pdf`}}

const qualityLabel={ok:'Dentro do padrão',atencao:'Atenção',fora:'Fora do padrão','sem-leitura':'Sem leitura','ideal-acima':'Acima do ideal'}
const qualityColor=s=>s==='fora'?'#A54634':s==='atencao'?'#8A651D':s==='ok'?'#2F6B2C':'#6B7A70'
const pv=v=>v==null?'—':String(Number(v).toFixed(1)).replace('.',',')
function drawStorage(doc,{units=[],readings=[],receipts=[],standards=defaultStandards,filters={},now=new Date(),user='',compact=false}={}){
 const f={...filters};if(!f.from&&!f.to){f.from=new Date(now.getTime()-30*864e5).toISOString().slice(0,10);f.to=now.toISOString().slice(0,10)}
 const summary=buildStorageSummary({units,readings,receipts,standards},{now})
 const su=summary.units.filter(u=>!filters.unitId||u.id===filters.unitId)
 const unitName=id=>units.find(u=>u.id===id)?.name||'—'
 const header=d=>pageHeader(d,{title:'Relatório de armazenagem e qualidade dos grãos',subtitle:`Situação em ${dt(now.toISOString().slice(0,10))} • leituras de ${periodLabel(f)}${filters.unitId?' • '+unitName(filters.unitId):''}${filters.commodity?' • '+(commodityLabels[filters.commodity]||filters.commodity):''}`,now,user})
 doc.addPage();let y=header(doc);const m=doc.margin;const W=doc.W-2*m
 const need=h=>{if(y+h>doc.H-doc.margin-30){doc.addPage();y=header(doc)}}
 const stockRows=su.flatMap(u=>u.stock.filter(x=>!filters.commodity||x.commodity===filters.commodity).map(x=>({...x,unitName:u.name,unitId:u.id})))
 const t=summary.totals;const capT=su.reduce((s,u)=>s+u.capacityT,0);const stockT=su.reduce((s,u)=>s+u.stockT,0)
 const alerts=summary.alerts.filter(a=>(!filters.unitId||a.unitId===filters.unitId)&&(!filters.commodity||!a.commodity||a.commodity===filters.commodity))
 y=tiles(doc,y,[{label:'Unidades',value:String(su.length),detail:`${units.length} cadastrada(s)`},{label:'Capacidade',value:`${num(capT)} t`,detail:'estática'},{label:'Estocado',value:`${num(stockT)} t`,detail:capT?`ocupação ${Math.round(stockT/capT*100)}%`:'—'},{label:'Grãos em estoque',value:String(stockRows.filter(x=>x.quantityT>0).length),detail:`${[...new Set(stockRows.map(x=>x.commodity))].length} cultura(s)`},{label:'Fora do padrão',value:String(stockRows.filter(x=>x.quality==='fora').length),detail:`${stockRows.filter(x=>x.quality==='atencao').length} em atenção`},{label:'Alertas',value:String(alerts.length),detail:`${alerts.filter(a=>a.level==='fora').length} crítico(s)`}])
 if(alerts.length){y=sectionTitle(doc,y,'Alertas');for(const a of alerts.slice(0,compact?8:30)){need(16);const lab=a.level==='fora'?'Crítico':a.level==='atencao'?'Atenção':'Rotina';doc.text(m,y+8,lab,{size:7.5,bold:true,color:a.level==='fora'?'#A54634':a.level==='atencao'?'#8A651D':'#2F5D45'});y=doc.wrap(m+44,y+8,a.message,{size:8,color:'#1B2A3A',width:W-46})+2}y+=8}
 need(60);y=sectionTitle(doc,y,'Unidades de recebimento')
 if(su.length){const cols=[{key:'name',label:'Unidade',width:120},{key:'kind',label:'Tipo',width:52,value:u=>u.kind||'—'},{key:'capacityT',label:'Cap. (t)',width:64,align:'right',value:u=>num(u.capacityT)},{key:'stockT',label:'Estoque (t)',width:66,align:'right',bold:true,value:u=>num(u.stockT,1)},{key:'freeT',label:'Livre (t)',width:58,align:'right',value:u=>num(u.freeT,1)},{key:'occupancy',label:'Ocup.',width:44,align:'right',value:u=>u.occupancy!=null?u.occupancy+'%':'—',color:u=>u.occupancy>=95?'#A54634':u.occupancy>=85?'#8A651D':'#1B2A3A'},{key:'quality',label:'Qualidade',width:74,value:u=>qualityLabel[u.quality]||u.quality,color:u=>qualityColor(u.quality)},{key:'recv',label:'Receb. (t)',width:66,align:'right',value:u=>num(u.receivedSeasonT,1)},{key:'goal',label:'Meta',width:40,align:'right',value:u=>u.goalPercent!=null?u.goalPercent+'%':'—'},{key:'last',label:'Último',width:60,value:u=>u.lastReceipt?dt(u.lastReceipt):'—'}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:su,x:m,y,onNewPage:header,rowHeight:15,fontSize:8})+12}
 else{doc.text(m,y+10,'Nenhuma unidade cadastrada.',{size:9,color:'#6B7A70'});y+=24}
 need(60);y=sectionTitle(doc,y,'Estoque e qualidade por unidade e grão (última leitura)')
 if(stockRows.length){const cols=[{key:'unitName',label:'Unidade',width:96},{key:'label',label:'Grão',width:44},{key:'quantityT',label:'Estoque (t)',width:58,align:'right',bold:true,value:x=>num(x.quantityT,1)},{key:'readingDate',label:'Leitura',width:56,value:x=>x.readingDate?dt(x.readingDate):'—'},{key:'age',label:'Dias',width:32,align:'right',value:x=>x.readingAgeDays!=null?String(x.readingAgeDays):'—',color:x=>x.readingAgeDays>7?'#8A651D':'#1B2A3A'},{key:'moisture',label:'Umid. %',width:44,align:'right',value:x=>pv(x.params?.moisture),color:x=>qualityColor(x.evaluation.find(e=>e.key==='moisture')?.status)},{key:'temperature',label:'Temp. °C',width:46,align:'right',value:x=>pv(x.params?.temperature),color:x=>qualityColor(x.evaluation.find(e=>e.key==='temperature')?.status)},{key:'impurities',label:'Imp. %',width:40,align:'right',value:x=>pv(x.params?.impurities),color:x=>qualityColor(x.evaluation.find(e=>e.key==='impurities')?.status)},{key:'damaged',label:'Avar. %',width:42,align:'right',value:x=>pv(x.params?.damaged),color:x=>qualityColor(x.evaluation.find(e=>e.key==='damaged')?.status)},{key:'ph',label:'PH',width:34,align:'right',value:x=>pv(x.params?.ph)},{key:'quality',label:'Situação',width:70,value:x=>qualityLabel[x.quality]||x.quality,color:x=>qualityColor(x.quality)},{key:'goal',label:'Meta',width:40,align:'right',value:x=>x.goalT?x.goalPercent+'%':'—'}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:stockRows,x:m,y,onNewPage:header,rowHeight:15,fontSize:8})+12}
 else{doc.text(m,y+10,'Sem leituras de estoque registradas.',{size:9,color:'#6B7A70'});y+=24}
 // padrões por cereal (média ponderada) × limites
 const byC=summary.byCommodity.filter(c=>!filters.commodity||c.commodity===filters.commodity).filter(c=>c.evaluation.length)
 if(byC.length){need(60);y=sectionTitle(doc,y,'Padrões por cereal — média ponderada do estoque × limite da unidade');const rows=byC.flatMap(c=>c.evaluation.map(e=>({grain:c.label,stockT:c.stockT,...e})));const cols=[{key:'grain',label:'Grão',width:60},{key:'label',label:'Parâmetro',width:150},{key:'value',label:'Medido',width:56,align:'right',bold:true,value:e=>String(e.value).replace('.',',')},{key:'limit',label:'Limite',width:70,align:'right',value:e=>e.max!=null?'máx. '+String(e.max).replace('.',','):e.min!=null?'mín. '+String(e.min).replace('.',','):'—'},{key:'ideal',label:'Ideal',width:50,align:'right',value:e=>e.ideal!=null?String(e.ideal).replace('.',','):'—'},{key:'pct',label:'% limite',width:54,align:'right',value:e=>e.percentOfLimit!=null?e.percentOfLimit+'%':'—'},{key:'status',label:'Situação',width:90,value:e=>qualityLabel[e.status]||e.status,color:e=>qualityColor(e.status)},{key:'stockT',label:'Estoque',width:60,align:'right',value:e=>num(e.stockT,1)}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows,x:m,y,onNewPage:header,rowHeight:15})+12}
 if(compact)return su.length
 // padrões em vigor
 const stdRows=Object.entries(standards).filter(([c])=>commodityLabels[c]&&(!filters.commodity||c===filters.commodity)).flatMap(([c,params])=>Object.entries(params).map(([k,rule])=>({grain:commodityLabels[c],label:rule.label||k,max:rule.max,min:rule.min,ideal:rule.ideal})))
 if(stdRows.length){need(60);y=sectionTitle(doc,y,'Padrões de qualidade em vigor na unidade');const cols=[{key:'grain',label:'Grão',width:70},{key:'label',label:'Parâmetro',width:200},{key:'max',label:'Máximo',width:70,align:'right',value:s=>s.max!=null?String(s.max).replace('.',','):'—'},{key:'min',label:'Mínimo',width:70,align:'right',value:s=>s.min!=null?String(s.min).replace('.',','):'—'},{key:'ideal',label:'Ideal',width:70,align:'right',value:s=>s.ideal!=null?String(s.ideal).replace('.',','):'—'}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:stdRows,x:m,y,onNewPage:header,rowHeight:14,fontSize:8})+12}
 // evolução por unidade e grão
 const trends=stockRows.filter(x=>x.trend&&x.trend.length>=2)
 if(trends.length){need(60);y=sectionTitle(doc,y,'Evolução das últimas leituras (estoque, umidade e temperatura)');for(const x of trends){need(40);doc.text(m,y+8,`${x.unitName} • ${x.label}`,{size:8.5,bold:true,color:'#3A7D34'});y+=12;const cols=[{key:'date',label:'Leitura',width:90,value:r=>dt(r.date)},{key:'quantityT',label:'Estoque (t)',width:90,align:'right',value:r=>num(r.quantityT,1)},{key:'moisture',label:'Umidade %',width:90,align:'right',value:r=>pv(r.moisture)},{key:'temperature',label:'Temperatura °C',width:100,align:'right',value:r=>pv(r.temperature)},{key:'delta',label:'Δ temperatura',width:90,align:'right',value:(r,i)=>''}];const rows=x.trend.map((r,i)=>({...r,delta:i>0&&r.temperature!=null&&x.trend[i-1].temperature!=null?r.temperature-x.trend[i-1].temperature:null}));cols[4].value=r=>r.delta==null?'—':(r.delta>=0?'+':'')+pv(r.delta);cols[4].color=r=>r.delta>=2?'#A54634':'#1B2A3A';const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows,x:m,y,onNewPage:header,rowHeight:14,fontSize:8})+8}}
 // leituras do período
 const period=readings.filter(rd=>inRange(rd.date,f)&&(!filters.unitId||rd.unitId===filters.unitId)&&(!filters.commodity||rd.commodity===filters.commodity)).sort((l,r2)=>r2.date.localeCompare(l.date)||String(r2.createdAt||'').localeCompare(String(l.createdAt||''))).slice(0,300)
 need(60);y=sectionTitle(doc,y,`Leituras registradas no período (${period.length})`)
 if(period.length){const cols=[{key:'date',label:'Data',width:52,value:rd=>dt(rd.date)},{key:'unit',label:'Unidade',width:96,value:rd=>unitName(rd.unitId)},{key:'grain',label:'Grão',width:44,value:rd=>commodityLabels[rd.commodity]||rd.commodity},{key:'silo',label:'Silo',width:50,value:rd=>rd.silo||'—'},{key:'quantityT',label:'Estoque (t)',width:56,align:'right',bold:true,value:rd=>num(rd.quantityT,1)},{key:'moisture',label:'Umid.',width:38,align:'right',value:rd=>pv(rd.params?.moisture),color:rd=>{const mx=standards[rd.commodity]?.moisture?.max;return mx!=null&&rd.params?.moisture>mx?'#A54634':'#1B2A3A'}},{key:'temperature',label:'Temp.',width:38,align:'right',value:rd=>pv(rd.params?.temperature),color:rd=>{const mx=standards[rd.commodity]?.temperature?.max;return mx!=null&&rd.params?.temperature>mx?'#A54634':'#1B2A3A'}},{key:'impurities',label:'Imp.',width:34,align:'right',value:rd=>pv(rd.params?.impurities)},{key:'damaged',label:'Avar.',width:36,align:'right',value:rd=>pv(rd.params?.damaged)},{key:'ph',label:'PH',width:32,align:'right',value:rd=>pv(rd.params?.ph)},{key:'notes',label:'Observação',width:100,value:rd=>rd.notes||''}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:period,x:m,y,onNewPage:header,rowHeight:14,fontSize:8})+8}
 else{doc.text(m,y+10,'Nenhuma leitura no período.',{size:9,color:'#6B7A70'});y+=24}
 return su.length
}
export function storageReport(args={}){const doc=createPdf({title:'Relatório de armazenagem e qualidade — VAL-SOG'});const count=drawStorage(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`armazenagem-qualidade-${(args.now||new Date()).toISOString().slice(0,10)}.pdf`}}

const signed=(v,fmt=x=>money(x))=>v==null?'—':(v>0?'+':v<0?'−':'')+fmt(Math.abs(v))
function drawMarket(doc,{quotes=[],praca=null,indicators={},automation={},now=new Date(),user=''}={}){
 const mk=buildMarketNow({quotes,praca,indicators,automation},{now})
 const header=d=>pageHeader(d,{title:'Mercado agora — praça de São Luiz Gonzaga',subtitle:`Última leitura das fontes ${mk.lastRead?dtm(mk.lastRead):'—'} • cotação mais recente ${mk.lastObserved?dtm(mk.lastObserved):'—'}`,now,user})
 doc.addPage();let y=header(doc);const m=doc.margin;const W=doc.W-2*m
 const need=h=>{if(y+h>doc.H-doc.margin-30){doc.addPage();y=header(doc)}}
 const withData=mk.commodities.filter(c=>c.own||c.today||c.praca.best||c.port.rioGrande)
 // cartões por grão
 const cols=2;const gap=10;const cw=(W-gap)/cols;const ch=118
 withData.forEach((c,i)=>{const col=i%cols;if(col===0)need(ch+8);const x=m+col*(cw+gap);const main=c.own?c.own.price:c.today?c.today.price:null
  doc.rect(x,y,cw,ch,{fill:'#F4F6F1',stroke:'#DDE4D8'});doc.rect(x,y,4,ch,{fill:'#3A7D34'})
  doc.text(x+12,y+16,c.label,{size:11,bold:true,color:'#16241B'});if(c.stage)doc.text(x+cw-10,y+16,c.stage.label,{size:7.5,bold:true,color:'#6B7A70',align:'right'})
  doc.text(x+12,y+40,main!=null?money(main):'—',{size:18,bold:true,color:'#14401F'})
  const dc=c.dayChange;doc.text(x+12+textWidth(main!=null?money(main):'—',18,true)+8,y+40,dc==null?'sem comparação':`${dc>0?'▲':dc<0?'▼':'●'} ${money(Math.abs(dc))}${c.dayChangePercent!=null?' ('+(c.dayChangePercent>=0?'+':'')+c.dayChangePercent.toFixed(1).replace('.',',')+'%)':''}`,{size:8.5,bold:true,color:dc>0?'#2F6B2C':dc<0?'#A54634':'#6B7A70'})
  doc.text(x+12,y+52,c.own?`C.Vale • ${dtm(c.own.observedAt)}${c.own.paymentTerms?' • '+c.own.paymentTerms:''}`:c.today?`média da praça em ${dt(c.today.date)}`:'sem cotação recente',{size:7,color:'#6B7A70',maxWidth:cw-24})
  const rows=[['Melhor concorrente',c.praca.best?`${c.praca.best.sourceName.split(' — ')[0]} ${money(c.praca.best.price)}`:'—'],['Média da praça',c.praca.avg!=null?`${money(c.praca.avg)} (${c.praca.sources} fonte(s))`:'—'],['Rio Grande / Paranaguá',`${c.port.rioGrande?money(c.port.rioGrande.price):'—'} / ${c.port.paranagua?money(c.port.paranagua.price):'—'}`],['Base × Rio Grande',c.basisRg!=null?money(c.basisRg):'—'],['7 dias',signed(c.weekChange)+(c.weekChangePercent!=null?' ('+signed(c.weekChangePercent,v=>v.toFixed(1).replace('.',',')+'%')+')':'')]]
  rows.forEach((rw,k)=>{const ry=y+66+k*10;doc.text(x+12,ry,rw[0],{size:7.5,color:'#6B7A70'});doc.text(x+cw-10,ry,rw[1],{size:7.5,bold:true,color:'#16241B',align:'right',maxWidth:cw-120})})
  if(col===cols-1||i===withData.length-1)y+=ch+8})
 if(!withData.length){doc.text(m,y+10,'Sem cotações recentes registradas.',{size:9,color:'#6B7A70'});y+=24}
 // indicadores
 const ind=(mk.indicators||[]).filter(i=>i.value!=null)
 if(ind.length){need(70);y=sectionTitle(doc,y,'Indicadores (dólar e Chicago)');const iw=(W-gap*(ind.length-1))/ind.length;ind.forEach((i,k)=>{const x=m+k*(iw+gap);doc.rect(x,y,iw,44,{fill:'#0B1A12'});doc.text(x+8,y+13,i.label.toUpperCase(),{size:6.5,bold:true,color:'#B5D95A',maxWidth:iw-16});doc.text(x+8,y+29,i.display||String(i.value),{size:12,bold:true,color:'#FFFFFF'});doc.text(x+8,y+39,`${i.changePercent!=null?(i.changePercent>=0?'+':'')+i.changePercent.toFixed(2).replace('.',',')+'% • ':''}${i.sourceName||''} • ${dtm(i.observedAt)}`,{size:6,color:'#C9D6C5',maxWidth:iw-16})});y+=56}
 // comparativo por grão (lista de fontes)
 const rowsCmp=withData.flatMap(c=>c.praca.list.map(s=>({grain:c.label,sourceName:s.sourceName,price:s.price,diff:c.own?s.price-c.own.price:null,observedAt:s.observedAt,automatic:s.automatic,crusher:s.crusher})))
 if(rowsCmp.length){need(60);y=sectionTitle(doc,y,'Concorrentes com cotação nas últimas 72 horas');const cc=[{key:'grain',label:'Grão',width:60},{key:'sourceName',label:'Comprador',width:220,value:s=>s.sourceName+(s.crusher?' (esmagadora)':'')},{key:'price',label:'R$/sc',width:60,align:'right',bold:true,value:s=>num(s.price,2)},{key:'diff',label:'vs C.Vale',width:60,align:'right',value:s=>s.diff==null?'—':(s.diff>=0?'+':'')+num(s.diff,2),color:s=>s.diff>0?'#A54634':s.diff<0?'#2F6B2C':'#1B2A3A'},{key:'observedAt',label:'Leitura',width:115,value:s=>dtm(s.observedAt)+(s.automatic?' • auto':'')}];const sc=W/cc.reduce((s,c)=>s+c.width,0);cc.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cc,rows:rowsCmp,x:m,y,onNewPage:header,rowHeight:14,fontSize:8})+10}
 // manchetes e riscos
 if(mk.headlines.length||mk.brief?.risks?.length){need(50);y=sectionTitle(doc,y,'Leitura do dia');for(const h of mk.headlines){need(14);doc.text(m+2,y+8,'•',{size:8,color:'#6B7A70'});y=doc.wrap(m+12,y+8,h,{size:8.5,color:'#1B2A3A',width:W-14})+2}for(const rk of (mk.brief?.risks||[])){need(14);doc.text(m+2,y+8,'•',{size:8,color:'#6B7A70'});y=doc.wrap(m+12,y+8,`Praça (${dt(mk.brief.observedAt)}): ${rk}`,{size:8,color:'#6B7A70',width:W-14})+2}}
 return withData.length
}
function drawRegion(doc,{regional=null,now=new Date(),user=''}={}){
 const v=regional;const modeLabel={gps:'localização do aparelho (GPS)',busca:'busca por região',praca:'praça escolhida',casa:'praça de casa'}[v?.mode]||'—'
 const header=d=>pageHeader(d,{title:'Preços da região',subtitle:`${v?.region?.label||v?.origin?.label||'—'} • ${modeLabel} • ${dt(now.toISOString().slice(0,10))}`,now,user})
 doc.addPage();let y=header(doc);const m=doc.margin;const W=doc.W-2*m
 if(!v){doc.text(m,y+10,'Sem leitura regional.',{size:9,color:'#6B7A70'});return 0}
 const ok=(v.results||[]).filter(r=>r.status==='ok').length;const total=(v.commodities||[]).reduce((s,c)=>s+c.totalPlaces,0);const local=(v.commodities||[]).reduce((s,c)=>s+(c.localQuotes||0),0)
 y=tiles(doc,y,[{label:`Região (${modeLabel})`,value:v.region?.name||v.origin?.label||'—',detail:`${v.region?.uf||''}${v.mode==='gps'&&v.region?` • praça mais próxima, a ${num(v.region.distanceKm)} km`:v.origin?` • origem: ${v.origin.label}`:''}`},{label:'Grãos com preço',value:String((v.commodities||[]).length),detail:`${total} preço(s) considerados`},{label:'Compradores registrados',value:String(local),detail:'cotações dos últimos 7 dias'},{label:'Tabelas públicas',value:`${ok}/${(v.results||[]).length}`,detail:v.readAt?`lidas em ${dtm(v.readAt)}`:'ainda não lidas'}])
 if(!(v.commodities||[]).length){doc.text(m,y+10,'Nenhuma praça com preço lido para esta região ainda. As tabelas públicas são lidas junto com o comparativo; use “Ler fontes agora” no card Mercado agora.',{size:9,color:'#6B7A70',maxWidth:W});return 0}
 for(const c of v.commodities){
  if(y>doc.H-doc.margin-120){doc.addPage();y=header(doc)}
  y=sectionTitle(doc,y,`${c.label}${c.own?` — C.Vale ${money(c.own.price)}/sc (${dt(String(c.own.observedAt).slice(0,10))})`:' — sem preço C.Vale registrado'}`)
  const cols=[{key:'label',label:'Praça / comprador',width:150,bold:true},{key:'kind',label:'Origem',width:74,value:r=>r.kind==='cotacao'?'cotação registrada':'tabela pública'},{key:'distanceKm',label:'km reta',width:46,align:'right',value:r=>num(r.distanceKm)},{key:'roadKm',label:'≈ rodov.',width:48,align:'right',value:r=>num(r.roadKm)},{key:'priceSc',label:'R$/sc',width:56,align:'right',bold:true,value:r=>num(r.priceSc,2)},{key:'vsOwnSc',label:'vs C.Vale',width:58,align:'right',value:r=>r.vsOwnSc==null?'—':(r.vsOwnSc>=0?'+':'')+num(r.vsOwnSc,2),color:r=>r.vsOwnSc>0?'#A54634':r.vsOwnSc<0?'#2F6B2C':'#1B2A3A'},{key:'date',label:'Data',width:56,value:r=>dt(r.date)},{key:'sourceName',label:'Fonte',width:100,value:r=>String(r.sourceName||'').split(' — ')[0]+(r.paymentTerms?' • '+r.paymentTerms:'')}]
  const sc=W/cols.reduce((s,x)=>s+x.width,0);cols.forEach(x=>x.width=x.width*sc)
  y=drawTable(doc,{columns:cols,rows:c.nearest,x:m,y,onNewPage:header,rowHeight:15})+6
  const foot=[c.best?`melhor preço entre as mais próximas: ${c.best.label} ${money(c.best.priceSc)}`:null,c.ufAverage!=null?`média ${c.uf}: ${money(c.ufAverage)} (${c.ufCount} praças)`:null,`${c.totalPlaces} preço(s) lidos`,c.unlocated?.length?`${c.unlocated.length} praça(s) sem coordenada no catálogo: ${c.unlocated.slice(0,6).join(', ')}${c.unlocated.length>6?'…':''}`:null].filter(Boolean).join(' • ')
  y=doc.wrap(m,y+6,foot,{size:7.5,color:'#6B7A70',width:W})+10
 }
 if(y>doc.H-doc.margin-60){doc.addPage();y=header(doc)}
 y=sectionTitle(doc,y,'Leitura')
 const notes=[`Distâncias em linha reta a partir de ${v.origin?.label||'origem'}; a estimativa rodoviária multiplica por ${String(v.roadFactor||1.3).replace('.',',')}.`,'“vs C.Vale” compara com o último preço C.Vale registrado do mesmo grão: positivo significa que a praça paga mais.','Cotações registradas são as dos compradores lançadas no sistema nos últimos 7 dias; tabelas públicas são as linhas “Cidade/UF” do mercado físico (Notícias Agrícolas), lidas junto com o comparativo.',...(v.results||[]).filter(r=>r.status!=='ok').map(r=>`Fonte ${r.name.split(' — ')[1]||r.name}: ${r.error||r.status}`)]
 for(const n of notes){y=doc.wrap(m+8,y+4,'• '+n,{size:8,color:'#1B2A3A',width:W-8})+2}
 return v.commodities.length
}
export function regionReport(args={}){const doc=createPdf({title:`Preços da região — ${args.regional?.region?.label||args.regional?.origin?.label||''} — VAL-SOG`});const count=drawRegion(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`precos-regiao-${String(args.regional?.region?.name||args.regional?.origin?.label||'regiao').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-')}-${(args.now||new Date()).toISOString().slice(0,10)}.pdf`}}
const askStatus={atende:'atendida',ajustavel:'ajustável',inviavel:'acima da oferta',abaixo:'acima da ref.'}
const offerStatusLabel=s=>s==='open'?'aberto':s==='closed'?'concluído':s==='cancelled'?'cancelado':(statusLabels[s]||s||'—')
const sgn=(v,d=2)=>v==null?'—':(v>0?'+':v<0?'−':'')+num(Math.abs(v),d)
const dts=v=>{const d=dt(String(v||'').slice(0,10));return d==='—'?d:d.slice(0,6)+d.slice(8)}
function drawAsking(doc,{askingHistory=[],producers=[],filters={},now=new Date(),user='',detail=true}={}){
 const inPeriod=e=>inRange(String(e.at).slice(0,10),filters)
 const hist=askingHistory.filter(h=>!filters.producerId||h.producerId===filters.producerId).map(h=>{const entries=h.entries.filter(e=>(!filters.commodity||e.commodity===filters.commodity)&&inPeriod(e));return {...h,entries,n:entries.length,byCommodity:h.byCommodity.filter(c=>(!filters.commodity||c.commodity===filters.commodity)&&entries.some(e=>e.commodity===c.commodity))}}).filter(h=>h.n).sort((a,b)=>a.producerName.localeCompare(b.producerName,'pt-BR'))
 const all=hist.flatMap(h=>h.entries.map(e=>({...e,producerName:h.producerName})))
 const header=d=>pageHeader(d,{title:'Histórico de pedidas dos produtores',subtitle:`${hist.length} produtor(es) • ${all.length} pedida(s) • ${periodLabel(filters)}${filters.commodity?' • '+(commodityLabels[filters.commodity]||filters.commodity):''}`,now,user})
 doc.addPage();let y=header(doc);const m=doc.margin;const W=doc.W-2*m
 const avg=list=>list.length?list.reduce((a,b)=>a+b,0)/list.length:null
 const prem=all.filter(e=>e.cvaleOnDay!=null).map(e=>e.askingPrice-e.cvaleOnDay);const met=all.filter(e=>e.askingStatus==='atende').length;const decided=all.filter(e=>['aceita','recusada','closed'].includes(e.offerStatus));const accepted=all.filter(e=>e.offerStatus==='aceita'||e.offerStatus==='closed');const closed=all.filter(e=>e.closedPrice!=null)
 y=tiles(doc,y,[{label:'Produtores com pedida',value:String(hist.length),detail:`${producers.length} cadastrados`},{label:'Pedidas registradas',value:String(all.length),detail:`${all.filter(e=>e.kind==='oferta').length} em ofertas • ${all.filter(e=>e.kind==='pedido').length} em pedidos`},{label:'Pedida vs C.Vale do dia',value:prem.length?sgn(avg(prem))+' R$/sc':'—',detail:prem.length?`média de ${prem.length} comparação(ões)`:'sem C.Vale no dia'},{label:'Atendidas pela oferta',value:all.length?Math.round(met/all.length*100)+'%':'—',detail:`${met} de ${all.length}`},{label:'Aceite',value:decided.length?Math.round(accepted.length/decided.length*100)+'%':'—',detail:`${accepted.length} aceita(s) de ${decided.length} decidida(s)`},{label:'Fechou vs pedida',value:closed.length?sgn(avg(closed.map(e=>e.closedPrice-e.askingPrice)))+' R$/sc':'—',detail:closed.length?`${closed.length} fechamento(s)`:'sem fechamentos'}])
 if(!hist.length){doc.text(m,y+10,'Nenhuma pedida registrada com os filtros informados. As pedidas entram pelas ofertas (campo “Pedida do produtor”) e pelos pedidos com preço-alvo.',{size:9,color:'#6B7A70',maxWidth:W});return 0}
 // por grão (carteira)
 const grains=[...new Set(all.map(e=>e.commodity))].sort((a,b)=>Object.keys(commodityLabels).indexOf(a)-Object.keys(commodityLabels).indexOf(b))
 y=sectionTitle(doc,y,'Pedidas por grão (todos os produtores do filtro)')
 const gRows=grains.map(c=>{const list=all.filter(e=>e.commodity===c);const asks=list.map(e=>e.askingPrice);const pr=list.filter(e=>e.cvaleOnDay!=null).map(e=>e.askingPrice-e.cvaleOnDay);const gaps=list.filter(e=>e.gapSc!=null).map(e=>e.gapSc);const dec=list.filter(e=>['aceita','recusada','closed'].includes(e.offerStatus));const acc=list.filter(e=>e.offerStatus==='aceita'||e.offerStatus==='closed');const cl=list.filter(e=>e.closedPrice!=null);const last=list[0];return {label:commodityLabels[c]||c,n:list.length,producers:new Set(list.map(e=>e.producerId)).size,avg:avg(asks),min:Math.min(...asks),max:Math.max(...asks),last:last?.askingPrice,lastAt:last?.at,prem:avg(pr),gap:avg(gaps),acc:dec.length?Math.round(acc.length/dec.length*100):null,closedVs:cl.length?avg(cl.map(e=>e.closedPrice-e.askingPrice)):null}})
 const gCols=[{key:'label',label:'Grão',width:60,bold:true},{key:'n',label:'Pedidas',width:46,align:'right'},{key:'producers',label:'Produtores',width:56,align:'right'},{key:'avg',label:'Média',width:56,align:'right',bold:true,value:r=>num(r.avg,2)},{key:'min',label:'Mín.',width:52,align:'right',value:r=>num(r.min,2)},{key:'max',label:'Máx.',width:52,align:'right',value:r=>num(r.max,2)},{key:'last',label:'Última',width:50,align:'right',value:r=>num(r.last,2)},{key:'lastAt',label:'Data últ.',width:48,value:r=>dts(r.lastAt)},{key:'prem',label:'vs C.Vale dia',width:62,align:'right',value:r=>sgn(r.prem),color:r=>r.prem>0?'#A54634':r.prem<0?'#2F6B2C':'#1B2A3A'},{key:'gap',label:'Oferta − pedida',width:66,align:'right',value:r=>sgn(r.gap)},{key:'acc',label:'Aceite',width:44,align:'right',value:r=>r.acc!=null?r.acc+'%':'—'},{key:'closedVs',label:'Fechou vs pedida',width:70,align:'right',value:r=>sgn(r.closedVs)}]
 {const sc=W/gCols.reduce((s,c)=>s+c.width,0);gCols.forEach(c=>c.width=c.width*sc)}
 y=drawTable(doc,{columns:gCols,rows:gRows,x:m,y,onNewPage:header,rowHeight:15})+12
 // resumo por produtor e grão
 if(y>doc.H-doc.margin-90){doc.addPage();y=header(doc)}
 y=sectionTitle(doc,y,'Resumo por produtor e grão')
 const pRows=hist.flatMap(h=>h.byCommodity.map(c=>({producer:h.producerName,...c})))
 const pCols=[{key:'producer',label:'Produtor',width:100,bold:true},{key:'label',label:'Grão',width:44},{key:'n',label:'Pedidas',width:40,align:'right'},{key:'avgAsking',label:'Média',width:50,align:'right',bold:true,value:r=>num(r.avgAsking,2)},{key:'minAsking',label:'Mín.',width:46,align:'right',value:r=>num(r.minAsking,2)},{key:'maxAsking',label:'Máx.',width:46,align:'right',value:r=>num(r.maxAsking,2)},{key:'lastAsking',label:'Última',width:48,align:'right',value:r=>num(r.lastAsking,2)},{key:'lastAt',label:'Data últ.',width:46,value:r=>dts(r.lastAt)},{key:'avgPremiumVsCvaleSc',label:'vs C.Vale',width:52,align:'right',value:r=>r.avgPremiumVsCvaleSc==null?'—':`${sgn(r.avgPremiumVsCvaleSc)}${r.avgPremiumVsCvalePercent!=null?' ('+sgn(r.avgPremiumVsCvalePercent,1)+'%)':''}`,color:r=>r.avgPremiumVsCvaleSc>0?'#A54634':r.avgPremiumVsCvaleSc<0?'#2F6B2C':'#1B2A3A'},{key:'avgGapSc',label:'Oferta − pedida',width:60,align:'right',value:r=>sgn(r.avgGapSc)},{key:'acceptedRate',label:'Aceite',width:40,align:'right',value:r=>r.acceptedRate!=null?r.acceptedRate+'%':'—'},{key:'avgClosedVsAsking',label:'Fechou vs ped.',width:58,align:'right',value:r=>sgn(r.avgClosedVsAsking)},{key:'trendSc',label:'Tendência',width:52,align:'right',value:r=>r.trendSc==null?'—':(r.trendSc>=0?'▲ ':'▼ ')+sgn(r.trendSc)}]
 {const sc=W/pCols.reduce((s,c)=>s+c.width,0);pCols.forEach(c=>c.width=c.width*sc)}
 y=drawTable(doc,{columns:pCols,rows:pRows,x:m,y,onNewPage:header,rowHeight:15})+8
 doc.text(m,y+6,'“vs C.Vale” = pedida menos o preço C.Vale do dia da pedida (positivo: o produtor pede acima da C.Vale). “Oferta − pedida” = quanto a oferta ou referência ficou acima (+) ou abaixo (−) da pedida.',{size:7,color:'#6B7A70',maxWidth:W});y+=18
 if(detail){
  const eCols=[{key:'at',label:'Data',width:52,value:e=>dt(String(e.at).slice(0,10))},{key:'kind',label:'Origem',width:40,value:e=>e.kind==='oferta'?'Oferta':'Pedido'},{key:'commodityLabel',label:'Grão',width:42},{key:'volumeSc',label:'Sacas',width:46,align:'right',value:e=>e.volumeSc?num(e.volumeSc):'—'},{key:'askingPrice',label:'Pedida',width:50,align:'right',bold:true,value:e=>num(e.askingPrice,2)},{key:'offerPrice',label:'Oferta / ref.',width:58,align:'right',value:e=>e.offerPrice!=null?num(e.offerPrice,2):'—'},{key:'gapSc',label:'Dif.',width:44,align:'right',value:e=>sgn(e.gapSc),color:e=>e.gapSc>0?'#2F6B2C':e.gapSc<0?'#A54634':'#1B2A3A'},{key:'cvaleOnDay',label:'C.Vale dia',width:52,align:'right',value:e=>e.cvaleOnDay!=null?num(e.cvaleOnDay,2):'—'},{key:'competitorOnDay',label:'Concorrente',width:56,align:'right',value:e=>e.competitorOnDay!=null?num(e.competitorOnDay,2):'—'},{key:'closedPrice',label:'Fechado',width:48,align:'right',value:e=>e.closedPrice!=null?num(e.closedPrice,2):'—'},{key:'offerStatus',label:'Situação',width:86,value:e=>`${offerStatusLabel(e.offerStatus)}${e.askingStatus?' • '+(askStatus[e.askingStatus]||e.askingStatus):''}`}]
  {const sc=W/eCols.reduce((s,c)=>s+c.width,0);eCols.forEach(c=>c.width=c.width*sc)}
  for(const h of hist){
   if(y>doc.H-doc.margin-110){doc.addPage();y=header(doc)}
   y=sectionTitle(doc,y,`${h.producerName} — ${h.n} pedida(s)`)
   for(const hint of h.hints||[]){y=doc.wrap(m+8,y+2,'• '+hint,{size:8,color:'#1B2A3A',width:W-8})+2}
   if(h.hints?.length)y+=4
   y=drawTable(doc,{columns:eCols,rows:h.entries.slice(0,60),x:m,y,onNewPage:header,rowHeight:15})+12
   if(h.entries.length>60){doc.text(m,y-4,`Mostrando as 60 pedidas mais recentes de ${h.entries.length}.`,{size:7,color:'#6B7A70'});y+=8}
  }
 }
 return all.length
}
export function askingReport(args={}){const doc=createPdf({title:'Histórico de pedidas dos produtores — VAL-SOG'});const count=drawAsking(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`historico-pedidas-${(args.now||new Date()).toISOString().slice(0,10)}.pdf`}}
export function marketReport(args={}){const doc=createPdf({title:'Mercado agora — VAL-SOG'});const count=drawMarket(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`mercado-agora-${(args.now||new Date()).toISOString().slice(0,16).replace(/[:T]/g,'-')}.pdf`}}

function drawDashboard(doc,{portfolio=null,targetHits=[],quotes=[],praca=null,indicators={},automation={},now=new Date(),user=''}={}){
 const pf=portfolio||{kpis:{},commodities:[],sourcesToday:[],agenda:[],attention:[]};const k=pf.kpis||{}
 const mk=buildMarketNow({quotes,praca,indicators,automation},{now})
 const header=d=>pageHeader(d,{title:'Painel de originação — praça de São Luiz Gonzaga',subtitle:`Posição em ${dtm(now.toISOString())} • fontes lidas ${mk.lastRead?dtm(mk.lastRead):'—'}`,now,user})
 doc.addPage();let y=header(doc);const m=doc.margin;const W=doc.W-2*m
 const need=h=>{if(y+h>doc.H-doc.margin-30){doc.addPage();y=header(doc)}}
 y=tiles(doc,y,[{label:'Produtores',value:String(k.producers??0),detail:'cadastrados'},{label:'Pedidos abertos',value:String(k.openRequests??0),detail:`${num(k.openVolumeSc||0)} sc em acompanhamento`},{label:'Alvos atingidos',value:String(targetHits.length),detail:'por cotação registrada'},{label:'Cotações de hoje',value:String(k.quotesToday??0),detail:`${k.sourcesMissing||0} fonte(s) principal(is) sem registro`},{label:'Abaixo do ritmo',value:String(k.behindPace??0),detail:'produtor × grão a proteger'},{label:'Volume fechado',value:`${num(k.closedVolumeSc||0)} sc`,detail:'registrado nos pedidos'}])
 // posição da carteira por grão
 y=sectionTitle(doc,y,'Posição da carteira por grão (produção estimada × fixado)')
 const cms=(pf.commodities||[])
 if(cms.length){const cols=[{key:'label',label:'Grão',width:60},{key:'stage',label:'Fase',width:70,value:c=>c.stage?.label||'—'},{key:'latest',label:'Cotação',width:64,align:'right',bold:true,value:c=>c.latest?num(c.latest.price,2):'—'},{key:'chg',label:'No período',width:60,align:'right',value:c=>c.changePercent!=null?pct(c.changePercent):'—',color:c=>c.changePercent>0?'#2F6B2C':c.changePercent<0?'#A54634':'#1B2A3A'},{key:'producersWithPosition',label:'Produtores',width:58,align:'right',value:c=>String(c.producersWithPosition||0)},{key:'productionSc',label:'Produção (sc)',width:76,align:'right',value:c=>num(c.productionSc)},{key:'fixedPercent',label:'Fixado',width:50,align:'right',value:c=>c.fixedPercent!=null?c.fixedPercent+'%':'—'},{key:'openSc',label:'Aberto (sc)',width:72,align:'right',value:c=>num(c.openSc)},{key:'behindPace',label:'Abaixo do ritmo',width:76,align:'right',value:c=>String(c.behindPace||0),color:c=>c.behindPace?'#A54634':'#1B2A3A'},{key:'openRequests',label:'Pedidos',width:50,align:'right',value:c=>`${c.openRequests||0} (${num(c.openVolumeSc||0)} sc)`}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:cms,x:m,y,onNewPage:header,rowHeight:15,fontSize:8})+12}
 else{doc.text(m,y+10,'Sem posição de carteira: cadastre área e produtividade dos produtores.',{size:9,color:'#6B7A70'});y+=24}
 // C.Vale × concorrência
 const cmp=mk.commodities.filter(c=>c.own||c.praca.best||c.port.rioGrande)
 if(cmp.length){need(60);y=sectionTitle(doc,y,'C.Vale × concorrência (últimas 72 h) e portos');const cols=[{key:'label',label:'Grão',width:60},{key:'own',label:'C.Vale',width:66,align:'right',bold:true,value:c=>c.own?num(c.own.price,2):'—'},{key:'best',label:'Melhor concorrente',width:170,value:c=>c.praca.best?`${c.praca.best.sourceName.split(' — ')[0]} ${num(c.praca.best.price,2)}`:'—'},{key:'gap',label:'Diferença',width:60,align:'right',value:c=>c.own&&c.praca.best?(c.praca.best.price-c.own.price>=0?'+':'')+num(c.praca.best.price-c.own.price,2):'—',color:c=>c.own&&c.praca.best&&c.praca.best.price>c.own.price?'#A54634':'#2F6B2C'},{key:'avg',label:'Média praça',width:64,align:'right',value:c=>c.praca.avg!=null?num(c.praca.avg,2):'—'},{key:'rg',label:'Rio Grande',width:64,align:'right',value:c=>c.port.rioGrande?num(c.port.rioGrande.price,2):'—'},{key:'basis',label:'Base × RG',width:60,align:'right',value:c=>c.basisRg!=null?num(c.basisRg,2):'—'},{key:'day',label:'Dia',width:56,align:'right',value:c=>signed(c.dayChange,v=>num(v,2)),color:c=>c.dayChange>0?'#2F6B2C':c.dayChange<0?'#A54634':'#1B2A3A'}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:cmp,x:m,y,onNewPage:header,rowHeight:15,fontSize:8})+12}
 // alvos atingidos
 if(targetHits.length){need(50);y=sectionTitle(doc,y,'Alvos atingidos por cotação registrada');const cols=[{key:'producerName',label:'Produtor',width:110},{key:'commodity',label:'Grão',width:50,value:h=>commodityLabels[h.commodity]||h.commodity},{key:'target',label:'Alvo',width:120},{key:'targetPrice',label:'Alvo (R$/sc)',width:66,align:'right',value:h=>num(h.targetPrice,2)},{key:'marketPrice',label:'Mercado',width:60,align:'right',bold:true,value:h=>num(h.marketPrice,2)},{key:'sourceName',label:'Fonte',width:100},{key:'volumeSc',label:'Sacas',width:50,align:'right',value:h=>num(h.volumeSc)}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:targetHits,x:m,y,onNewPage:header,rowHeight:15,fontSize:8})+12}
 // agenda
 need(50);y=sectionTitle(doc,y,'Agenda de fechamentos (próximos 45 dias)')
 if((pf.agenda||[]).length){const cols=[{key:'date',label:'Data',width:70,value:a=>dt(a.date),color:a=>a.overdue?'#A54634':'#1B2A3A'},{key:'kind',label:'Tipo',width:60},{key:'label',label:'Compromisso',width:385}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:pf.agenda,x:m,y,onNewPage:header,rowHeight:14,fontSize:8})+12}
 else{doc.text(m,y+10,'Nada agendado: as datas vêm dos pedidos (caixa, entrega, revisão do Alvo 3) e dos meses de caixa dos produtores.',{size:8.5,color:'#6B7A70'});y+=24}
 // produtores abaixo do ritmo
 need(50);y=sectionTitle(doc,y,'Produtores abaixo do ritmo de proteção')
 if((pf.attention||[]).length){const cols=[{key:'producerName',label:'Produtor',width:130},{key:'label',label:'Grão',width:60},{key:'fixedPercent',label:'Fixado',width:56,align:'right',value:a=>a.fixedPercent+'%'},{key:'band',label:'Faixa da fase',width:80,align:'right',value:a=>`${a.band[0]}–${a.band[1]}%`},{key:'openSc',label:'Em aberto (sc)',width:80,align:'right',bold:true,value:a=>num(a.openSc)},{key:'gap',label:'Para o mínimo (sc)',width:109,align:'right',value:a=>a.productionSc?num(Math.max(0,Math.round(a.productionSc*a.band[0]/100-a.fixedSc))):'—'}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:pf.attention,x:m,y,onNewPage:header,rowHeight:14,fontSize:8})+12}
 else{doc.text(m,y+10,'Nenhum produtor abaixo do ritmo de proteção para a fase atual.',{size:8.5,color:'#6B7A70'});y+=24}
 // fontes de hoje
 if((pf.sourcesToday||[]).length){need(40);y=sectionTitle(doc,y,'Cotações de hoje por fonte principal');const cols=[{key:'name',label:'Fonte',width:300},{key:'done',label:'Situação',width:215,value:f=>f.done?'registrada hoje':'pendente',color:f=>f.done?'#2F6B2C':'#A54634'}];const sc=W/cols.reduce((s,c)=>s+c.width,0);cols.forEach(c=>c.width=c.width*sc);y=drawTable(doc,{columns:cols,rows:pf.sourcesToday,x:m,y,onNewPage:header,rowHeight:13,fontSize:8})+8}
 return cms.length
}
export function dashboardReport(args={}){const doc=createPdf({title:'Painel de originação — VAL-SOG'});const count=drawDashboard(doc,args);finish(doc);return {buffer:doc.render(),count,filename:`painel-originacao-${(args.now||new Date()).toISOString().slice(0,16).replace(/[:T]/g,'-')}.pdf`}}
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
export function generalReport(args={}){const doc=createPdf({title:'Relatório geral — pedidos, ofertas e recebimentos — VAL-SOG'});const dsh=drawDashboard(doc,args);const mk=drawMarket(doc,args);const q=drawQuotes(doc,{...args,compact:true});const pr=drawProducers(doc,{...args,detail:false});const p=drawRequests(doc,{...args,detail:false});const a=drawOffers(doc,args);const b=drawReceipts(doc,args);const s=drawStorage(doc,{...args,compact:true});finish(doc);return {buffer:doc.render(),count:dsh+mk+q+pr+p+a+b+s,filename:`relatorio-geral-${args.filters?.from||'inicio'}-${args.filters?.to||'hoje'}.pdf`}}

function finish(doc){doc.eachPage((n,total)=>pageFooter(doc,n,total))}
