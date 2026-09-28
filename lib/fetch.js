const ranges={soja:{'BRL/sc_60kg':[95,320],'BRL/t':[1500,5400]},milho:{'BRL/sc_60kg':[35,130],'BRL/t':[550,2200]},trigo:{'BRL/sc_60kg':[55,140],'BRL/t':[900,2400]},sorgo:{'BRL/sc_60kg':[15,140],'BRL/t':[250,2400]},arroz:{'BRL/sc_50kg':[40,200],'BRL/sc_60kg':[40,200],'BRL/t':[700,3400]},canola:{'BRL/sc_60kg':[80,400],'BRL/t':[1300,6500]},aveia:{'BRL/sc_60kg':[20,160],'BRL/t':[350,2700]}}
const numberRe=/(?<!\d)(\d{1,3}(?:\.\d{3})+|\d{1,5})(?:,(\d{1,2}))?(?!\d)/g
const dateRe=/(\d{2})\/(\d{2})\/(\d{4})/g
const fold=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
const escapeRe=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
export const keyRegex=key=>{const k=fold(key);const head=/^[a-z0-9]/.test(k)?'(?<![a-z0-9])':'';const tail=/[a-z0-9]$/.test(k)?'(?![a-z0-9])':'';return new RegExp(head+escapeRe(k)+tail,'g')}
const hasKey=(folded,key)=>keyRegex(key).test(folded)
const indexOfKey=(folded,key,from=0)=>{const re=keyRegex(key);re.lastIndex=from;const m=re.exec(folded);return m?m.index:-1}

export function htmlToText(html){
 return String(html||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|td|th)>/gi,' | ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(m,c)=>String.fromCodePoint(Number(c))).replace(/\s+/g,' ').trim()
}
const parseNumber=(whole,cents)=>{const raw=whole.replace(/\./g,'');const value=Number(raw)+(cents?Number(cents.padEnd(2,'0'))/100:0);return Number.isFinite(value)?value:null}
const plausible=(commodity,unit,value)=>{const range=ranges[commodity]?.[unit];return range?value>=range[0]&&value<=range[1]:value>0}
export function latestDate(text,now=new Date()){
 let best=null
 for(const match of text.matchAll(dateRe)){const iso=`${match[3]}-${match[2]}-${match[1]}`;const time=new Date(`${iso}T12:00:00Z`).getTime();if(!Number.isFinite(time)||time>now.getTime()+864e5)continue;if(!best||time>best.time)best={iso,time}}
 return best?.iso||null
}
export function extractKeyword(text,keywords,{commodity,unit='BRL/sc_60kg',window=160}={}){
 const folded=fold(text)
 for(const keyword of keywords){
  const key=fold(keyword);let from=0
  while(true){
   const at=indexOfKey(folded,key,from);if(at<0)break
   const slice=text.slice(at+key.length,at+key.length+window)
   for(const match of slice.matchAll(numberRe)){
    if(!match[2]&&match[1].length<=2)continue
    const value=parseNumber(match[1],match[2])
    if(value!==null&&plausible(commodity,unit,value))return {price:value,priceUnit:unit,snippet:text.slice(Math.max(0,at-10),at+key.length+match.index+match[0].length+2).trim(),keyword}
   }
   from=at+key.length
  }
 }
 return null
}
export function extractTableLatest(text,{commodity,unit='BRL/sc_60kg'}={}){
 const re=/(\d{2}\/\d{2}\/\d{4})[^0-9]{0,40}?(\d{1,3}(?:\.\d{3})*,\d{2})/g
 for(const match of text.matchAll(re)){const value=parseNumber(match[2].split(',')[0],match[2].split(',')[1]);if(value!==null&&plausible(commodity,unit,value)){const [d,m,y]=match[1].split('/');return {price:value,priceUnit:unit,observedDate:`${y}-${m}-${d}`,snippet:match[0]}}}
 return null
}
export function parseTables(html,{withContext=false}={}){
 const tables=[];const source=String(html||'');let lastEnd=0
 for(const table of source.matchAll(/<table[\s\S]*?<\/table>/gi)){
  const rows=[]
  for(const row of table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)){
   const cells=[...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>htmlToText(m[1]).replace(/\s*\|\s*/g,' ').trim())
   if(cells.length)rows.push(cells)
  }
  if(!rows.length)continue
  if(withContext){const before=htmlToText(source.slice(Math.max(lastEnd,table.index-1500),table.index)).slice(-220);tables.push({rows,before})}else tables.push(rows)
  lastEnd=table.index+table[0].length
 }
 return tables
}
const firstNumberIn=(cell,commodity,unit)=>{for(const match of String(cell).matchAll(numberRe)){if(!match[2]&&match[1].length<=2)continue;const value=parseNumber(match[1],match[2]);if(value!==null&&plausible(commodity,unit,value))return value}return null}
export function extractTableColumns(html,{columns={},unit='BRL/sc_60kg'}={}){
 const wanted=Object.entries(columns);const prices={}
 for(const rows of parseTables(html)){
  const headerIndex=rows.findIndex(cells=>wanted.some(([,keys])=>cells.some(c=>keys.some(k=>hasKey(fold(c),k)))))
  if(headerIndex<0)continue
  const header=rows[headerIndex].map(fold);const map={}
  for(const [commodity,keys] of wanted){if(prices[commodity])continue;const idx=header.findIndex(c=>keys.some(k=>hasKey(c,k)));if(idx>=0)map[commodity]=idx}
  if(!Object.keys(map).length)continue
  const single=Object.keys(map).length===1
  for(const cells of rows.slice(headerIndex+1)){
   const found={};const dateMatch=cells.join(' ').match(/(\d{2})\/(\d{2})\/(\d{4})/)
   for(const [commodity,idx] of Object.entries(map)){
    let value=firstNumberIn(cells[idx]||'',commodity,unit);let cellText=cells[idx]||''
    if(value===null&&single){for(const cell of cells){const v=firstNumberIn(cell,commodity,unit);if(v!==null){value=v;cellText=cell;break}}}
    if(value!==null)found[commodity]={price:value,priceUnit:unit,snippet:`${rows[headerIndex][idx]}: ${cellText}${dateMatch?` (${dateMatch[0]})`:''}`,observedDate:dateMatch?`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`:undefined}
   }
   if(Object.keys(found).length){Object.assign(prices,found);break}
  }
  if(Object.keys(prices).length>=wanted.length)break
 }
 return prices
}
export function extractTableRows(html,{rows={},unit='BRL/sc_60kg'}={}){
 const prices={};const tables=parseTables(html)
 for(const [commodity,keys] of Object.entries(rows)){
  for(const key of keys){
   const folded=fold(key);let found=null
   for(const table of tables){for(const cells of table){if(!hasKey(fold(cells[0]||''),key))continue;for(const cell of cells.slice(1)){const value=firstNumberIn(cell,commodity,unit);if(value!==null){found={price:value,priceUnit:unit,snippet:cells.slice(0,4).join(' | '),keyword:key};break}}if(found)break}if(found)break}
   if(found){prices[commodity]=found;break}
  }
 }
 return prices
}
export function extractOrderedValues(html,text,{order=[],unit='BRL/sc_60kg',debug=null}={}){
 const folded=fold(text)
 let present=order.map(c=>({c,at:indexOfKey(folded,c)})).filter(x=>x.at>=0).sort((a,b)=>a.at-b.at).map(x=>x.c)
 if(present.length<2)present=[...order]
 const tables=parseTables(html).map(rows=>rows.map(cells=>cells.find(cell=>/\d/.test(cell))||'').filter(Boolean)).filter(values=>values.length>=2)
 tables.sort((a,b)=>b.length-a.length)
 if(debug){debug.ordem=present.join(',');debug.valores=(tables[0]||[]).slice(0,8).join(' | ')}
 for(const values of tables){
  const prices={};let matched=0
  present.forEach((commodity,i)=>{const cell=values[i];if(!cell)return;const value=firstNumberIn(cell,commodity,unit);if(value!==null){prices[commodity]={price:value,priceUnit:unit,snippet:`${commodity}: ${cell} (ordem da página)`};matched++}})
  if(matched>=Math.min(3,present.length))return prices
 }
 return {}
}
export function extractHistory(html,text,{commodity,unit='BRL/sc_60kg',rowKey=null,limit=400,now=new Date()}={}){
 const seen=new Map();const push=(iso,value,snippet)=>{if(!seen.has(iso))seen.set(iso,{date:iso,price:value,snippet})}
 const toIso=m=>`${m[3]}-${m[2]}-${m[1]}`;const valid=iso=>{const t=new Date(`${iso}T12:00:00Z`).getTime();return Number.isFinite(t)&&t<=now.getTime()+864e5&&t>=now.getTime()-3*365*864e5}
 for(const rows of parseTables(html)){
  let column=-1
  if(rowKey){const header=rows.find(cells=>!/\d{2}\/\d{2}\/\d{4}/.test(cells.join(' '))&&cells.some(c=>hasKey(fold(c),rowKey)));if(header)column=header.findIndex(c=>hasKey(fold(c),rowKey))}
  for(const cells of rows){
   const joined=cells.join(' ')
   const monthly=String(cells[0]||'').trim().match(/^(\d{1,2})\/(\d{4})$/)
   if(monthly&&!/\d{2}\/\d{2}\/\d{4}/.test(joined)){const iso=`${monthly[2]}-${String(monthly[1]).padStart(2,'0')}-15`;if(!valid(iso))continue;for(const cell of cells.slice(1)){const mm=String(cell).match(/-?\d{1,3}(?:\.\d{3})*,\d{1,4}|-?\d+(?:\.\d+)?/);if(!mm)continue;const raw=mm[0].includes(',')?mm[0].replace(/\./g,'').replace(',','.'):mm[0];const value=Math.round(Number(raw)*100)/100;if(Number.isFinite(value)&&plausible(commodity,unit,value)){push(iso,value,`média mensal ${monthly[1]}/${monthly[2]}: ${cells.slice(0,3).join(' | ')}`);break}}continue}
   const m=joined.match(/(\d{2})\/(\d{2})\/(\d{4})/);if(!m)continue;const iso=toIso(m);if(!valid(iso))continue
   let candidates=cells
   if(rowKey&&column>=0)candidates=[cells[column]||''].concat(cells.filter((c,i)=>i!==column))
   else if(rowKey){if(!hasKey(fold(joined),rowKey))continue;const idx=cells.findIndex(c=>hasKey(fold(c),rowKey));if(idx>=0)candidates=cells.slice(idx+1).concat(cells.slice(0,idx))}
   for(const cell of candidates){if(/\d{2}\/\d{2}\/\d{4}/.test(cell))continue;const value=firstNumberIn(cell,commodity,unit);if(value!==null){push(iso,value,cells.slice(0,4).join(' | '));break}}
  }
 }
 if(!seen.size){const re=/(\d{2})\/(\d{2})\/(\d{4})[^0-9]{0,40}?(\d{1,3}(?:\.\d{3})*,\d{2})/g;for(const m of text.matchAll(re)){const iso=toIso(m);if(!valid(iso))continue;const value=parseNumber(m[4].split(',')[0],m[4].split(',')[1]);if(value!==null&&plausible(commodity,unit,value))push(iso,value,m[0])}}
 return [...seen.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-limit)
}
// Indicadores de mercado (dólar, Chicago): valor único por página, com faixa de plausibilidade própria.
const parseBr=raw=>{const t=String(raw).trim();if(!t)return null;const v=/,\d{1,4}$/.test(t)?Number(t.replace(/\./g,'').replace(',','.')):Number(t.replace(/,/g,''));return Number.isFinite(v)?v:null}
export function extractIndicator(html,text,config={}){
 const [lo,hi]=config.range||[0,Infinity]
 const rowKeys=(config.rowKeys||(config.rowKey?[config.rowKey]:[])).map(fold)
 const rowPattern=config.rowPattern?new RegExp(config.rowPattern,'i'):null
 const decRe=/-?\d{1,3}(?:\.\d{3})*,\d{1,4}(?![\d,])/g
 const pick=cells=>{for(let i=1;i<cells.length;i++){const cell=String(cells[i]).trim();if(/[\/:]/.test(cell)||/%/.test(cell))continue;for(const m of cell.matchAll(decRe)){const v=parseBr(m[0]);if(v!=null&&v>=lo&&v<=hi){let change=null;const pc=cells.slice(i+1).map(c=>String(c).trim()).find(c=>/%/.test(c));if(pc){const cv=parseBr(pc.replace(/[%\s]/g,''));if(cv!=null&&Math.abs(cv)<30)change=cv}return {value:v,change,snippet:cells.slice(0,4).join(' | ').slice(0,160)}}}}return null}
 const withCtx=parseTables(html,{withContext:true});const tables=withCtx.map(t=>t.rows)
 if(rowKeys.length){for(const rows of tables)for(const cells of rows){const first=fold(cells[0]);if(!rowKeys.some(k=>first.includes(k)))continue;const found=pick(cells);if(found)return found}}
 if(rowPattern){const ctx=config.contextKey?fold(config.contextKey):null;const names=['soja','milho','trigo','cafe','boi','algodao','arroz','farelo','oleo','acucar','etanol'];const info=t=>{const f=fold(t.before);const present=names.filter(n=>new RegExp('(^|[^a-z])'+n+'([^a-z]|$)').test(f));let lastName=null,lastAt=-1;for(const n of present){const at=f.lastIndexOf(n);if(at>lastAt){lastAt=at;lastName=n}}return {present,lastName}};const tiers=ctx?[withCtx.filter(t=>{const i=info(t);return i.present.length===1&&i.present[0]===ctx}),withCtx.filter(t=>info(t).lastName===ctx),withCtx.filter(t=>fold(t.before).includes(ctx)),withCtx]:[withCtx];if(ctx){for(let i=0;i<withCtx.length;i++){const f=fold(withCtx[i].before);const order=names.map(n=>({n,at:f.search(new RegExp('(^|[^a-z])'+n+'([^a-z]|$)'))})).filter(x=>x.at>=0).sort((x,y)=>x.at-y.at).map(x=>x.n);if(order.length<2||!order.includes(ctx))continue;const group=[withCtx[i]];for(let k=i+1;k<withCtx.length&&group.length<order.length;k++){if(fold(withCtx[k].before).replace(/[^a-z]/g,'').length>3)break;group.push(withCtx[k])}const target=group[order.indexOf(ctx)];if(!target)continue;for(const cells of target.rows){if(!rowPattern.test(String(cells[0]).trim()))continue;const found=pick(cells);if(found)return {...found,context:'widget de abas: '+order.join(' | ')+' → '+ctx};break}}}
  const months=(config.months||[]).map(fold);const monthOf=label=>fold(label).slice(0,3);const typical=config.typical||null;const pickTyped=cells=>{const found=pick(cells);if(!found)return null;if(typical&&(found.value<typical[0]||found.value>typical[1]))return null;return found};for(const strict of [true,false])for(const tier of tiers)for(const t of tier)for(const cells of t.rows){if(!rowPattern.test(String(cells[0]).trim()))continue;if(strict&&months.length&&!months.includes(monthOf(cells[0])))break;const found=strict?pickTyped(cells):pick(cells);if(found)return {...found,context:t.before.slice(-80)};break}}
 if(config.keywords){const folded=fold(text);for(const key of config.keywords){const at=indexOfKey(folded,key);if(at<0)continue;const windowText=text.slice(at,at+(config.window||140)).replace(/\d{1,2}[\/:]\d{2}(?:[\/:]\d{2,4})?/g,' ');for(const m of windowText.matchAll(decRe)){const v=parseBr(m[0]);if(v!=null&&v>=lo&&v<=hi)return {value:v,change:null,snippet:windowText.slice(0,140)}}}}
 return null
}
export async function fetchIndicator(source,{timeoutMs=15000,fetchImpl=globalThis.fetch,now=new Date()}={}){
 const started=Date.now();const urls=[...new Set([source.url,...(source.urls||[])].filter(Boolean))];const attempts=[];let last=null
 for(const url of urls){
  try{
   const response=await fetchImpl(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GraosMissoes/1.0','Accept':'text/html,application/xhtml+xml','Accept-Language':'pt-BR,pt;q=0.9'},signal:AbortSignal.timeout(timeoutMs),redirect:'follow'})
   if(!response.ok){attempts.push(`${url}: HTTP ${response.status}`);last={key:source.key,label:source.label,status:'failed',error:`HTTP ${response.status} em ${url}`,attempts,ms:Date.now()-started};continue}
   const html=(await response.text()).slice(0,1_500_000);const text=htmlToText(html);const found=extractIndicator(html,text,source.fetch||{})
   const monthRe=source.fetch?.rowPattern?new RegExp(source.fetch.rowPattern,'i'):null;const tablesDebug=monthRe?parseTables(html,{withContext:true}).map((t,i)=>({i,ctx:t.before.replace(/\s+/g,' ').slice(-60),row:(t.rows.find(r=>monthRe.test(String(r[0]).trim()))||[]).slice(0,3).join('|')})).filter(t=>t.row).map(t=>`#${t.i} «${t.ctx}» → ${t.row}`).join(' ;; ').slice(0,600):''
   const tables=parseTables(html);const sample=tables.sort((a,b)=>b.length-a.length)[0]?.slice(0,6).map(r=>r.slice(0,5).join(' | ')).join(' // ').slice(0,260)||text.slice(0,200)
   if(!found){attempts.push(`${url}: vazio (${text.length} caracteres, ${tables.length} tabelas) amostra «${sample.slice(0,160)}»${tablesDebug?' tabelas-mes '+tablesDebug:''}`);last={key:source.key,label:source.label,status:'empty',error:`Página lida (${url}), mas nenhum valor reconhecido.`,debug:sample,attempts,ms:Date.now()-started};continue}
   attempts.push(`${url}: ok${tablesDebug?' tabelas-mes '+tablesDebug:''}`);const pageDate=latestDate(text,now)
   return {key:source.key,label:source.label,status:'ok',value:found.value,display:source.format?source.format.replace('{v}',found.value.toLocaleString('pt-BR',{minimumFractionDigits:source.decimals??2,maximumFractionDigits:source.decimals??2})).replace('{usd}',(found.value/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})):String(found.value),unit:source.unit||'',changePercent:found.change,observedAt:pageDate?`${pageDate}T12:00:00.000Z`:now.toISOString(),pageDate,sourceName:source.sourceName||source.label,url,snippet:found.snippet,context:found.context||'',attempts,ms:Date.now()-started}
  }catch(error){attempts.push(`${url}: ${error.name==='TimeoutError'?'tempo esgotado':String(error.message||error).slice(0,80)}`);last={key:source.key,label:source.label,status:'failed',error:error.name==='TimeoutError'?'Tempo esgotado ao abrir a página.':String(error.message||error).slice(0,160),attempts,ms:Date.now()-started}}
 }
 return last||{key:source.key,label:source.label,status:'failed',error:'Sem URL configurada.',attempts,ms:Date.now()-started}
}
export async function runIndicators(list=[],options={}){const now=options.now||new Date();const results=await Promise.all(list.map(src=>fetchIndicator(src,{...options,now})));return {fetchedAt:now.toISOString(),results,okCount:results.filter(r=>r.status==='ok').length,total:results.length}}
export function extractFromHtml(html,source,now=new Date()){
 const config=source.fetch||{};const text=htmlToText(html);const unit=config.priceUnit||source.priceUnit||'BRL/sc_60kg'
 const prices={};const pageDate=latestDate(text,now);const orderedDebug={}
 if(config.strategy==='auto'){
  if(config.columns)Object.assign(prices,extractTableColumns(html,{columns:config.columns,unit}))
  if(!Object.keys(prices).length&&config.order)Object.assign(prices,extractOrderedValues(html,text,{order:config.order,unit,debug:orderedDebug}))
  if(!Object.keys(prices).length&&config.rows)Object.assign(prices,extractTableRows(html,{rows:config.rows,unit}))
  if(!Object.keys(prices).length){for(const [commodity,keywords] of Object.entries(config.keywords||{})){const found=extractKeyword(text,keywords,{commodity,unit,window:config.window||160});if(found)prices[commodity]=found}}
 }
 else if(config.strategy==='table-latest'){const commodity=config.commodity||source.commodities?.[0];const found=extractTableLatest(text,{commodity,unit});if(found)prices[commodity]=found}
 else if(config.strategy==='table-columns')Object.assign(prices,extractTableColumns(html,{columns:config.columns||{},unit}))
 else if(config.strategy==='table-rows')Object.assign(prices,extractTableRows(html,{rows:config.rows||{},unit}))
 else{
  let scope=text
  if(config.anchor){const folded=fold(text);const at=config.anchor.map(a=>indexOfKey(folded,a)).filter(i=>i>=0).sort((a,b)=>a-b)[0];if(at!==undefined)scope=text.slice(at)}
  for(const [commodity,keywords] of Object.entries(config.keywords||{})){const found=extractKeyword(scope,keywords,{commodity,unit,window:config.window||160});if(found)prices[commodity]=found}
 }
 const debug={...orderedDebug}
 const folded=fold(text)
 for(const [commodity,keywords] of Object.entries(config.keywords||config.columns||config.rows||{})){if(prices[commodity])continue;const key=keywords.find(k=>hasKey(folded,k));if(key){const at=indexOfKey(folded,key);debug[commodity]=text.slice(at,at+220)}else debug[commodity]='palavra-chave não encontrada'}
 {const tables=parseTables(html);debug.tabelas=String(tables.length);if(!Object.keys(prices).length){const largest=tables.sort((a,b)=>b.length-a.length)[0];if(largest)debug.amostra=largest.slice(0,8).map(r=>r.slice(0,6).join(' | ')).join(' // ').slice(0,300)}}
 if(!Object.keys(prices).length&&!Object.keys(debug).length)debug.inicio=text.slice(0,220)
 if(!Object.keys(prices).length&&text.length<400)debug.inicio=text.slice(0,400)
 let history=[]
 if(config.history){const commodity=config.commodity||Object.keys(prices)[0]||source.commodities?.[0];history=extractHistory(html,text,{commodity,unit,rowKey:config.rowKey||null,now});history=history.map(h=>({...h,commodity}))
  if(history.length){const latest=history[history.length-1];debug.historico=`${history.length} data(s) de ${history[0].date} a ${latest.date}`;const cur=prices[commodity];if(!cur||!cur.observedDate||cur.observedDate<latest.date)prices[commodity]={price:latest.price,priceUnit:unit,observedDate:latest.date,snippet:latest.snippet||'',fromHistory:true}}}
 return {prices,pageDate,textLength:text.length,debug,history}
}
export async function fetchSource(source,{timeoutMs=15000,fetchImpl=globalThis.fetch,now=new Date()}={}){
 const started=Date.now()
 if(!source.url||!source.fetch)return {sourceId:source.id,name:source.name,status:'skipped',error:'Fonte sem leitura automática configurada.',prices:{},url:source.url||'',fetchedAt:now.toISOString()}
 try{
  const urls=[...new Set([...(source.fetch.urls||[]),source.url].filter(Boolean))]
  let last=null;const attempts=[]
  for(const url of urls){
   const response=await fetchImpl(url,{headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 GraosMissoes/1.0','Accept':'text/html,application/xhtml+xml','Accept-Language':'pt-BR,pt;q=0.9'},signal:AbortSignal.timeout(timeoutMs),redirect:'follow'})
   if(!response.ok){attempts.push(`${url}: HTTP ${response.status}`);last={sourceId:source.id,name:source.name,status:'failed',error:`HTTP ${response.status} em ${url}`,prices:{},url:source.url,fetchedAt:now.toISOString(),ms:Date.now()-started,attempts};continue}
   const html=(await response.text()).slice(0,1_500_000)
   const {prices,pageDate,textLength,debug,history}=extractFromHtml(html,source,now)
   const found=Object.keys(prices).length
   attempts.push(`${url}: ${found?'ok':'vazio'} (${textLength} caracteres, ${debug?.tabelas||'?'} tabelas)${!found&&debug?.amostra?` amostra «${debug.amostra.slice(0,200)}»`:''}${!found&&debug?.ordem?` ordem «${debug.ordem}» valores «${debug.valores}»`:''}`)
   last={sourceId:source.id,name:source.name,region:source.region,port:Boolean(source.port),status:found?'ok':'empty',error:found?'':`Página lida (${url}), mas nenhum preço reconhecido.`,prices,pageDate,textLength,debug,history:history||[],readUrl:url,url:source.url,fetchedAt:now.toISOString(),ms:Date.now()-started,attempts}
   if(found)return last
  }
  return last
 }catch(error){return {sourceId:source.id,name:source.name,status:'failed',error:error.name==='TimeoutError'?'Tempo esgotado ao abrir a página.':String(error.message||error).slice(0,160),prices:{},url:source.url,fetchedAt:now.toISOString(),ms:Date.now()-started}}
}
export async function runComparison(sources,options={}){
 const now=options.now||new Date()
 const targets=sources.filter(source=>source.fetch&&source.url&&!source.own)
 const results=await Promise.all(targets.map(source=>fetchSource(source,{...options,now})))
 return {fetchedAt:now.toISOString(),results,okCount:results.filter(r=>r.status==='ok').length,total:results.length}
}
