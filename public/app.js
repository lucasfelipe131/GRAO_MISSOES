(()=>{
const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)]
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format
const money0=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}).format
const int=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format
const dt=v=>{if(!v)return 'Não informada';const d=new Date(v.length===10?v+'T12:00:00':v);return isNaN(d)?'Não informada':new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',year:'numeric',...(v.length>10?{hour:'2-digit',minute:'2-digit'}:{})}).format(d)}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const unit={'BRL/sc_60kg':'sc','BRL/t':'t','USD/bu':'bu','BRL/USD':'US$'}
const fresh=v=>{const h=(Date.now()-new Date(v))/36e5;return h<=24?['Atual','fresh']:h<=72?['Atenção','attention']:h<=168?['No limite','limit']:['Vencida','expired']}
const refFmt=r=>r.priceUnit==='USD/bu'?`US$ ${r.price.toFixed(2).replace('.',',')}/bu`:r.priceUnit==='BRL/USD'?`R$ ${r.price.toFixed(4).replace('.',',')}`:`${money(r.price)}/${unit[r.priceUnit]||r.priceUnit}`
let code='';try{code=localStorage.getItem('gm.code')||''}catch{}
let state={producers:[],quotes:[],requests:[],brief:null,catalog:{commodities:[],objectives:[]},targetHits:[]}
const status=(t,ms=3500)=>{$('#status').textContent=t;if(ms)setTimeout(()=>{if($('#status').textContent===t)$('#status').textContent=''},ms)}
async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Content-Type':'application/json','x-access-code':code,...(options.headers||{})}});const data=await r.json().catch(()=>({}));if(r.status===401){showLogin(true);throw new Error(data.error||'Acesso negado.')}if(!r.ok)throw new Error(data.error||'Falha na operação.');return data}
function showLogin(on){$('#login').hidden=!on;$$('.panel').forEach(p=>p.hidden=on||p.dataset.panel!==currentTab);$('#hits').hidden=on||!state.targetHits.length}
let currentTab='pedidos'
$$('.tabs button').forEach(b=>b.addEventListener('click',()=>{currentTab=b.dataset.tab;$$('.tabs button').forEach(x=>x.setAttribute('aria-selected',x===b));$$('.panel').forEach(p=>p.hidden=p.dataset.panel!==currentTab);try{localStorage.setItem('gm.tab',currentTab)}catch{}}))
try{const t=localStorage.getItem('gm.tab');if(t&&$(`.tabs button[data-tab="${t}"]`))$(`.tabs button[data-tab="${t}"]`).click()}catch{}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();code=new FormData(e.target).get('code');try{await api('/api/session');try{localStorage.setItem('gm.code',code)}catch{}$('#loginError').hidden=true;showLogin(false);load()}catch(err){$('#loginError').textContent=err.message;$('#loginError').hidden=false}})
const localNow=()=>{const d=new Date(Date.now()-new Date().getTimezoneOffset()*6e4);return d.toISOString().slice(0,16)}
const formData=f=>Object.fromEntries(new FormData(f).entries())
function fillSelects(){
 const comm=state.catalog.commodities.map(c=>`<option value="${c.value}">${c.label}</option>`).join('')
 $$('select[name=commodity]').forEach(s=>{const v=s.value;s.innerHTML=comm;if(v)s.value=v})
 $('select[name=objective]').innerHTML=state.catalog.objectives.map(o=>`<option value="${o.value}">${esc(o.label)}</option>`).join('')
 const ps=$('#requestForm select[name=producerId]');const v=ps.value;ps.innerHTML='<option value="">Selecione</option>'+state.producers.map(p=>`<option value="${p.id}">${esc(p.name)} • ${esc(p.municipality)}</option>`).join('');if(v)ps.value=v
 if(!$('#quoteForm input[name=observedAt]').value)$('#quoteForm input[name=observedAt]').value=localNow()
 const ss=$('#quoteForm select[name=sourceId]');const sv=ss.value;const sources=state.catalog.sources||[]
 ss.innerHTML='<option value="">Selecione a fonte</option>'+sources.map(f=>`<option value="${f.id}">${esc(f.name)}${f.region?' • '+esc(f.region):''}</option>`).join('');if(sv)ss.value=sv
 renderSourceBar()
}
function applySource(id,commodity){
 const f=$('#quoteForm');const src=(state.catalog.sources||[]).find(x=>x.id===id)
 if(!src){$('#openSource').hidden=true;$('#sourceHow').hidden=true;return}
 f.sourceName.value=src.requiresName?'':src.name;f.sourceUrl.value=src.url||'';f.region.value=src.region||'';f.priceUnit.value=src.priceUnit||'BRL/sc_60kg';f.paymentTerms.value=src.paymentTerms||'';f.marketKind.value=src.marketKind||'spot'
 const allowed=src.commodities||[];const cs=f.commodity;[...cs.options].forEach(o=>{o.disabled=allowed.length&&!allowed.includes(o.value)});if(commodity)cs.value=commodity;else if(allowed.length&&!allowed.includes(cs.value))cs.value=allowed[0]
 if(src.url){$('#openSource').href=src.url;$('#openSource').hidden=false}else $('#openSource').hidden=true
 $('#sourceHow').innerHTML=`<b>Como copiar:</b> ${esc(src.howTo)}${src.cadence?` <em>(${esc(src.cadence)})</em>`:''}`;$('#sourceHow').hidden=false
 if(src.requiresName)f.sourceName.focus();else if(!src.region)f.region.focus();else f.price.focus()
}
function renderSourceBar(){
 const bar=$('#sourcebar');if(!bar)return
 const primary=(state.catalog.sources||[]).filter(f=>f.primary)
 const label=v=>(state.catalog.commodities.find(c=>c.value===v)||{}).label||v
 const today=(state.quotes||[]).filter(q=>q.status!=='inactive'&&(Date.now()-new Date(q.observedAt))<864e5)
 bar.innerHTML=`<div class="sourcecards">${primary.map(f=>{const done=today.filter(q=>q.sourceId===f.id||q.sourceName===f.name).map(q=>label(q.commodity));return `<article class="sourcecard${done.length?' is-done':''}"><header><b>${esc(f.name)}</b><small>${esc(f.cadence||'')}</small></header><p>${esc(f.region)} • ${f.priceUnit==='BRL/t'?'R$/t':'R$/sc'}${f.paymentTerms?' • '+esc(f.paymentTerms):''}</p><div class="row">${(f.commodities||[]).filter(c=>state.catalog.commodities.some(x=>x.value===c)).map(c=>`<button type="button" class="mini${done.includes(label(c))?' is-done':''}" data-source="${f.id}" data-commodity="${c}">${done.includes(label(c))?'✓ ':''}${esc(label(c))}</button>`).join('')}${f.url?`<a class="mini" href="${esc(f.url)}" target="_blank" rel="noreferrer">abrir</a>`:''}</div></article>`}).join('')}</div>
 <p class="muted">Clique no grão para preparar o registro com a fonte já preenchida. ✓ indica cotação registrada nas últimas 24 h.</p>`
 $$('#sourcebar [data-source]').forEach(b=>b.addEventListener('click',()=>{const f=$('#quoteForm');f.sourceId.value=b.dataset.source;applySource(b.dataset.source,b.dataset.commodity);f.scrollIntoView({behavior:'smooth',block:'start'})}))
}

async function load(){try{const s=await api('/api/bootstrap');state={...state,...s};fillSelects();renderAll();showLogin(false)}catch(e){status(e.message,6000)}}
function renderAll(){renderHits();renderRequests();renderQuotes();renderProducers();renderBrief()}
function renderHits(){const h=state.targetHits||[];$('#hits').hidden=!h.length;if(!h.length)return;$('#hits').innerHTML=`<b>Alvos atingidos por cotação registrada (${h.length})</b><ul>${h.map(x=>`<li><b>${esc(x.producerName)}</b> • ${esc(x.commodity)} • ${esc(x.target)} (${money(x.targetPrice)}) — mercado ${money(x.marketPrice)} por ${esc(x.sourceName)} em ${dt(x.observedAt)} • ${int(x.volumeSc)} sc</li>`).join('')}</ul>`}
function analysisHtml(a){
 const m=a.marketReading||{}
 const targets=a.closingTargets?.length?`<section class="targets"><header><div><small>TARGET DE FECHAMENTO</small><b>Três alvos escalonados • ${esc(a.ladder.sharesNote)}</b></div><em>Média da escada ${a.ladder.averagePriceSc?money(a.ladder.averagePriceSc):'—'}/sc • ${money0(a.ladder.revenueBRL||0)}</em></header><div class="targetlist">${a.closingTargets.map(t=>`<article class="target ${t.key}"><header><span>${t.share}%</span><div><small>${esc(t.label)}</small><b>${money(t.price)}/sc</b></div></header><dl><div><dt>VOLUME</dt><dd>${int(t.volumeSc)} sc</dd></div><div><dt>RECEITA</dt><dd>${money0(t.revenueBRL)}</dd></div><div><dt>GATILHO</dt><dd>${esc(t.trigger)}</dd></div>${t.deadline?`<div><dt>ATÉ</dt><dd>${dt(t.deadline)}</dd></div>`:''}</dl><p>${esc(t.condition)}</p></article>`).join('')}</div></section>`:''
 return `<div class="headline"><div class="orb">G</div><div><small>LEITURA DO SISTEMA • ${esc(a.rulesVersion)}</small><h3>${esc(a.headline)}</h3><p>${esc(a.producer.name)}${a.producer.municipality?' • '+esc(a.producer.municipality):''} • ${esc(a.request.commodityLabel)} • ${int(a.request.volumeSc)} sc • objetivo: ${esc(a.request.objectiveLabel)}${a.praca.stage?' • praça em '+esc(a.praca.stage.label.toLowerCase()):''}</p></div></div>
 <div class="metrics"><div><small>REFERÊNCIA USADA</small><b>${m.reference?money(m.reference.price):'Sem cotação'}</b><span>${m.reference?esc(m.reference.sourceName)+' • '+esc(m.reference.freshness):'registre uma cotação'}</span></div><div><small>PREÇO-ALVO</small><b>${a.request.targetPriceSc?money(a.request.targetPriceSc):'A completar'}</b><span>${m.priceGapPercent==null?'sem comparação':(m.priceGapPercent>=0?'atingido ':'faltam ')+Math.abs(m.priceGapPercent).toFixed(1).replace('.',',')+'%'}</span></div><div><small>MARGEM SOBRE CUSTO</small><b>${m.marginPercent==null?'Sem custo':m.marginPercent.toFixed(1).replace('.',',')+'%'}</b><span>${a.request.costPriceSc?'custo '+money(a.request.costPriceSc)+'/sc':'informe o custo'}</span></div><div><small>BASE × PORTO</small><b>${m.basisSc==null?'Sem porto':money(m.basisSc)}</b><span>${m.port?esc(m.port.region)+' • '+money(m.port.price):'registre cotação de porto'}</span></div></div>
 ${targets}
 <div class="cols"><div class="box"><h4>Dicas para o fechamento</h4><ul>${a.tips.map(t=>`<li>${esc(t.text)}<small>${t.scope==='praca'?'praça':t.scope==='pedido'?'pedido':'geral'}</small></li>`).join('')}</ul></div><div class="box"><h4>Como o sistema leu o pedido</h4><ul>${a.reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>${a.scenarios?.length?`<div class="scen">${a.scenarios.map(s=>`<div><small>${esc(s.label.toUpperCase())}</small><b>${money(s.price)}</b><span>${money0(s.revenueBRL)}</span></div>`).join('')}</div>`:''}</div></div>
 ${a.alerts.map(x=>`<p class="note warn">${esc(x)}</p>`).join('')}${a.dataGaps.map(x=>`<p class="note gap">${esc(x)}</p>`).join('')}
 ${a.assumptions.length?`<details><summary>Premissas e padrões considerados</summary><ul>${a.assumptions.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details>`:''}
 <p class="note ok">${esc(a.disclaimer)}</p>`
}
async function submitRequest(persist){
 const f=$('#requestForm');const payload=formData(f);$('#requestError').hidden=true
 const btns=f.querySelectorAll('button');btns.forEach(b=>b.disabled=true)
 try{const r=await api(persist?'/api/requests':'/api/analyze',{method:'POST',body:JSON.stringify(payload)});const a=persist?r.request.analysis:r.analysis;$('#analysis').innerHTML=analysisHtml(a);if(persist){status('Pedido registrado com análise.');await load()}$('#analysis').scrollIntoView({behavior:'smooth',block:'start'})}
 catch(e){$('#requestError').textContent=e.message;$('#requestError').hidden=false}
 finally{btns.forEach(b=>b.disabled=false)}
}
$('#requestForm').addEventListener('submit',e=>{e.preventDefault();submitRequest(true)})
$('#previewBtn').addEventListener('click',()=>submitRequest(false))
function renderRequests(){
 const list=state.requests||[];$('#requestCount').textContent=`${list.filter(r=>r.status==='open').length} abertos • ${list.length} no total`
 if(!list.length){$('#requests').innerHTML='<div class="empty"><p>Nenhum pedido registrado ainda.</p></div>';return}
 $('#requests').innerHTML=list.map(r=>{const a=r.analysis||{};const closed=(r.closings||[]).reduce((s,c)=>s+c.volumeSc,0);const avg=closed?(r.closings.reduce((s,c)=>s+c.price*c.volumeSc,0)/closed):null
  return `<article class="item" data-id="${r.id}"><header><div><b>${esc(r.producerName)}</b> <span class="tag ${r.status}">${r.status==='open'?'Aberto':r.status==='closed'?'Concluído':'Cancelado'}</span><div class="meta">${esc(a.request?.commodityLabel||r.commodity)} • ${int(a.request?.volumeSc||r.volume)} sc • ${r.direction==='sell'?'venda':'compra'} • ${esc(a.request?.objectiveLabel||r.objective)} • registrado em ${dt(r.createdAt)}</div></div><div class="row"><button data-act="show">Ver análise</button><button data-act="rerun">Recalcular</button>${r.status==='open'?'<button data-act="cancel">Cancelar</button>':''}</div></header>
  <div class="meta">${esc(a.headline||'')}</div>
  ${a.closingTargets?.length?`<div class="row">${a.closingTargets.map(t=>`<span class="tag">${esc(t.label.split(' — ')[0])}: ${money(t.price)} • ${int(t.volumeSc)} sc</span>`).join('')}</div>`:''}
  ${closed?`<div class="meta">Fechado: ${int(closed)} sc de ${int(a.request?.volumeSc||0)} • preço médio ${money(avg)} • ${r.closings.map(c=>`${esc(c.buyer||'comprador')} ${money(c.price)}×${int(c.volumeSc)}`).join(', ')}</div>`:''}
  ${r.request?`<div class="meta">“${esc(r.request)}”</div>`:''}
  ${r.status==='open'?`<form class="closing" data-close="${r.id}"><label>Preço fechado (R$/sc)<input name="price" type="number" step="0.01" min="0.01" required></label><label>Volume (sc)<input name="volumeSc" type="number" step="1" min="1" required></label><label>Comprador<input name="buyer" placeholder="Coopatrigo…"></label><button class="primary" type="submit">Registrar fechamento</button></form>`:''}
  <div class="detail" hidden></div></article>`}).join('')
 $$('#requests [data-act]').forEach(b=>b.addEventListener('click',async()=>{const item=b.closest('.item');const id=item.dataset.id;const r=list.find(x=>x.id===id);try{if(b.dataset.act==='show'){const d=item.querySelector('.detail');d.hidden=!d.hidden;if(!d.hidden)d.innerHTML=`<div class="output">${analysisHtml(r.analysis)}</div>`}if(b.dataset.act==='rerun'){await api(`/api/requests/${id}/rerun`,{method:'POST'});status('Análise recalculada com as cotações atuais.');await load()}if(b.dataset.act==='cancel'&&confirm('Cancelar este pedido?')){await api(`/api/requests/${id}`,{method:'PATCH',body:JSON.stringify({status:'cancelled'})});await load()}}catch(e){status(e.message,6000)}}))
 $$('#requests form[data-close]').forEach(f=>f.addEventListener('submit',async e=>{e.preventDefault();try{await api(`/api/requests/${f.dataset.close}/closings`,{method:'POST',body:JSON.stringify(formData(f))});status('Fechamento registrado.');await load()}catch(err){status(err.message,6000)}}))
}
$('#quoteForm select[name=sourceId]').addEventListener('change',e=>applySource(e.target.value))
$('#quoteForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.target;$('#quoteError').hidden=true;try{const p=formData(f);p.observedAt=new Date(p.observedAt).toISOString();await api('/api/quotes',{method:'POST',body:JSON.stringify(p)});const keep=f.sourceId.value;f.reset();f.observedAt.value=localNow();f.sourceId.value=keep;applySource(keep);status('Cotação registrada.');await load()}catch(err){$('#quoteError').textContent=err.message;$('#quoteError').hidden=false}})
function renderQuotes(){
 const list=(state.quotes||[]).filter(q=>q.status!=='inactive');$('#quoteCount').textContent=`${list.length} ativas`
 if(!list.length){$('#quotes').innerHTML='<div class="empty"><p>Nenhuma cotação registrada. Comece pela Coopatrigo, Cotrisal ou CEPEA.</p></div>';return}
 const label=v=>(state.catalog.commodities.find(c=>c.value===v)||{}).label||v
 $('#quotes').innerHTML=list.map(q=>{const [fl,fs]=fresh(q.observedAt);return `<article class="item" data-id="${q.id}"><header><div><b>${esc(label(q.commodity))} • ${money(q.price)}/${unit[q.priceUnit]||q.priceUnit}</b><div class="meta">${esc(q.region)} • ${esc(q.sourceName)}${q.paymentTerms?' • '+esc(q.paymentTerms):''} • ${q.marketKind==='spot'?'disponível':q.marketKind==='forward'?'a termo':'futuro'}</div></div><div class="row"><span class="tag ${fs}">${fl}</span><span class="tag">${dt(q.observedAt)}</span>${q.confidence?`<span class="tag">${q.confidence}% confiança</span>`:''}${q.sourceUrl?`<a class="mini" href="${esc(q.sourceUrl)}" target="_blank" rel="noreferrer">fonte</a>`:''}<button data-del>Remover</button></div></header>${q.notes?`<div class="meta">${esc(q.notes)}</div>`:''}</article>`}).join('')
 $$('#quotes [data-del]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Desativar esta cotação?'))return;try{await api(`/api/quotes/${b.closest('.item').dataset.id}`,{method:'DELETE'});await load()}catch(e){status(e.message,6000)}}))
}
$('#producerForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.target;$('#producerError').hidden=true;try{const p=formData(f);const id=p.id;delete p.id;await api(id?`/api/producers/${id}`:'/api/producers',{method:id?'PUT':'POST',body:JSON.stringify(p)});f.reset();f.municipality.value='São Luiz Gonzaga';$('#producerFormTitle').textContent='Cadastrar produtor';status('Produtor salvo.');await load()}catch(err){$('#producerError').textContent=err.message;$('#producerError').hidden=false}})
$('#producerReset').addEventListener('click',()=>{const f=$('#producerForm');f.reset();f.id.value='';f.municipality.value='São Luiz Gonzaga';$('#producerFormTitle').textContent='Cadastrar produtor'})
function renderProducers(){
 const list=state.producers||[];$('#producerCount').textContent=`${list.length} cadastrados`
 if(!list.length){$('#producers').innerHTML='<div class="empty"><p>Cadastre o primeiro produtor para registrar pedidos.</p></div>';return}
 $('#producers').innerHTML=list.map(p=>`<article class="item" data-id="${p.id}"><header><div><b>${esc(p.name)}</b><div class="meta">${esc(p.municipality)}${p.deliveryLocation?' • entrega: '+esc(p.deliveryLocation):''}${p.storageT?' • '+int(p.storageT)+' t de armazenagem':''}${p.phone?' • '+esc(p.phone):''}</div></div><div class="row">${Object.entries(p.costs||{}).map(([k,v])=>`<span class="tag">custo ${k} ${money(v)}</span>`).join('')}<button data-edit>Editar</button></div></header>${p.notes?`<div class="meta">${esc(p.notes)}</div>`:''}</article>`).join('')
 $$('#producers [data-edit]').forEach(b=>b.addEventListener('click',()=>{const p=list.find(x=>x.id===b.closest('.item').dataset.id);const f=$('#producerForm');f.id.value=p.id;for(const k of ['name','municipality','phone','deliveryLocation','storageT','logistics','notes'])f[k].value=p[k]??'';for(const k of ['soja','milho','trigo'])f[`cost_${k}`].value=p.costs?.[k]??'';$('#producerFormTitle').textContent='Editar produtor';$('.tabs button[data-tab=produtores]').click();f.scrollIntoView({behavior:'smooth'})}))
}
function renderBrief(){
 const b=state.brief;if(!b){$('#brief').innerHTML='';return}
 $('#brief').innerHTML=`<div class="brief"><div class="card"><div class="briefhead"><div><small>BRIEFING DA PRAÇA • ${esc(b.praca?.label||'')}</small><h2>Leitura de mercado observada em ${dt(b.brief.observedAt)}</h2><p>${esc(b.governance.note)}</p></div>${b.warning?`<p class="note warn">${esc(b.warning)}</p>`:'<p class="note ok">Briefing dentro da validade</p>'}</div></div>
 <div class="briefgrid">${b.commodities.map(c=>`<div class="card"><header><h3>${esc(c.label)}</h3>${c.stage?`<span class="tag ${c.stage.key}">${esc(c.stage.label)}</span>`:''}</header><div class="ref"><small>COTAÇÃO REGISTRADA</small><b>${c.registeredReference?money(c.registeredReference.price)+'/'+(unit[c.registeredReference.priceUnit]||''):'Nenhuma'}</b><span>${c.registeredReference?esc(c.registeredReference.sourceName)+' • '+esc(c.registeredReference.region)+' • '+esc(c.registeredReference.freshness):'registre uma cotação com fonte'}</span></div><ul class="seed">${c.seededReferences.map(r=>`<li><span><b>${esc(r.label)}</b><small>${esc(r.source)} • ${dt(r.observedAt)}${r.note?' • '+esc(r.note):''}</small></span><em>${refFmt(r)}</em></li>`).join('')}</ul>${c.reading.length?`<ul class="reading">${c.reading.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}${c.stage?`<p class="note gap">${esc(c.stage.note)}</p>`:''}<details><summary>Dicas de fechamento para ${esc(c.label.toLowerCase())}</summary><ul>${c.closingTips.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></details></div>`).join('')}</div>
 <div class="card"><h3>Riscos acompanhados</h3><ul class="reading">${b.brief.risks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${b.praca?.logistics?.freightToPortBRLPerSc?`<p class="note gap">Frete interior × ${esc(b.praca.geography?.portReference||'porto')}: ${money(b.praca.logistics.freightToPortBRLPerSc.low)} a ${money(b.praca.logistics.freightToPortBRLPerSc.high)} por saca (${esc(b.praca.logistics.freightToPortBRLPerSc.source)}).</p>`:''}</div>
 <div class="card"><div class="cardhead"><h3>Compradores e referências da praça</h3><small>confiança declarada; confirmar antes de negociar</small></div><div class="buyers">${(b.praca?.buyers||[]).map(x=>`<div><span><b>${esc(x.name)}</b><small>${esc(x.municipality)} • ${esc(x.note)}</small></span><em>${x.confidence}%</em></div>`).join('')}</div></div>
 <div class="card"><h3>Referências de apoio</h3><ul class="reading">${(state.catalog.references||[]).map(r=>`<li><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.name)}</a> — ${esc(r.note)}</li>`).join('')}</ul></div><div class="card"><h3>Fontes do briefing</h3><div class="sources">${b.brief.sources.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.name)}</a>`).join('')}</div></div></div>`
}
;(async()=>{try{const s=await fetch('/api/session',{headers:{'x-access-code':code}}).then(r=>r.json());if(s.protected&&!s.authorized){showLogin(true);return}await load()}catch(e){status('Servidor indisponível.',0)}})()
})()
