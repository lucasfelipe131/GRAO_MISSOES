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
export function parseTables(html){
 const tables=[]
 for(const table of String(html||'').matchAll(/<table[\s\S]*?<\/table>/gi)){
  const rows=[]
  for(const row of table[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)){
   const cells=[...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>htmlToText(m[1]).replace(/\s*\|\s*/g,' ').trim())
   if(cells.length)rows.push(cells)
  }
  if(rows.length)tables.push(rows)
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
export function extractOrderedValues(html,text,{order=[],unit='BRL/sc_60kg'}={}){
 const folded=fold(text)
 const present=order.map(c=>({c,at:indexOfKey(folded,c)})).filter(x=>x.at>=0).sort((a,b)=>a.at-b.at).map(x=>x.c)
 if(present.length<2)return {}
 const tables=parseTables(html).map(rows=>rows.map(cells=>cells.find(cell=>/\d/.test(cell))||'').filter(Boolean)).filter(values=>values.length>=2)
 tables.sort((a,b)=>b.length-a.length)
 for(const values of tables){
  const prices={};let matched=0
  present.forEach((commodity,i)=>{const cell=values[i];if(!cell)return;const value=firstNumberIn(cell,commodity,unit);if(value!==null){prices[commodity]={price:value,priceUnit:unit,snippet:`${commodity}: ${cell} (ordem da página)`};matched++}})
  if(matched>=Math.min(3,present.length))return prices
 }
 return {}
}
export function extractFromHtml(html,source,now=new Date()){
 const config=source.fetch||{};const text=htmlToText(html);const unit=config.priceUnit||source.priceUnit||'BRL/sc_60kg'
 const prices={};const pageDate=latestDate(text,now)
 if(config.strategy==='auto'){
  if(config.columns)Object.assign(prices,extractTableColumns(html,{columns:config.columns,unit}))
  if(!Object.keys(prices).length&&config.order)Object.assign(prices,extractOrderedValues(html,text,{order:config.order,unit}))
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
 const debug={}
 const folded=fold(text)
 for(const [commodity,keywords] of Object.entries(config.keywords||config.columns||config.rows||{})){if(prices[commodity])continue;const key=keywords.find(k=>hasKey(folded,k));if(key){const at=indexOfKey(folded,key);debug[commodity]=text.slice(at,at+220)}else debug[commodity]='palavra-chave não encontrada'}
 {const tables=parseTables(html);debug.tabelas=String(tables.length);if(!Object.keys(prices).length){const largest=tables.sort((a,b)=>b.length-a.length)[0];if(largest)debug.amostra=largest.slice(0,8).map(r=>r.slice(0,6).join(' | ')).join(' // ').slice(0,300)}}
 if(!Object.keys(prices).length&&!Object.keys(debug).length)debug.inicio=text.slice(0,220)
 if(!Object.keys(prices).length&&text.length<400)debug.inicio=text.slice(0,400)
 return {prices,pageDate,textLength:text.length,debug}
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
   const {prices,pageDate,textLength,debug}=extractFromHtml(html,source,now)
   const found=Object.keys(prices).length
   attempts.push(`${url}: ${found?'ok':'vazio'} (${textLength} caracteres, ${debug?.tabelas||'?'} tabelas)${!found&&debug?.amostra?` amostra «${debug.amostra.slice(0,200)}»`:''}`)
   last={sourceId:source.id,name:source.name,region:source.region,status:found?'ok':'empty',error:found?'':`Página lida (${url}), mas nenhum preço reconhecido.`,prices,pageDate,textLength,debug,readUrl:url,url:source.url,fetchedAt:now.toISOString(),ms:Date.now()-started,attempts}
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
