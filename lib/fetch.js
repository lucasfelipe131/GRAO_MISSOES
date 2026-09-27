const ranges={soja:{'BRL/sc_60kg':[60,320],'BRL/t':[1000,5400]},milho:{'BRL/sc_60kg':[20,160],'BRL/t':[350,2700]},trigo:{'BRL/sc_60kg':[40,220],'BRL/t':[700,3700]},sorgo:{'BRL/sc_60kg':[15,140],'BRL/t':[250,2400]},arroz:{'BRL/sc_50kg':[40,200],'BRL/sc_60kg':[40,200],'BRL/t':[700,3400]},canola:{'BRL/sc_60kg':[80,400],'BRL/t':[1300,6500]},aveia:{'BRL/sc_60kg':[20,160],'BRL/t':[350,2700]}}
const numberRe=/(?<!\d)(\d{1,3}(?:\.\d{3})+|\d{1,5})(?:,(\d{1,2}))?(?!\d)/g
const dateRe=/(\d{2})\/(\d{2})\/(\d{4})/g
const fold=value=>String(value||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()

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
   const at=folded.indexOf(key,from);if(at<0)break
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
export function extractFromHtml(html,source,now=new Date()){
 const config=source.fetch||{};const text=htmlToText(html);const unit=config.priceUnit||source.priceUnit||'BRL/sc_60kg'
 const prices={};const pageDate=latestDate(text,now)
 if(config.strategy==='table-latest'){const commodity=config.commodity||source.commodities?.[0];const found=extractTableLatest(text,{commodity,unit});if(found)prices[commodity]=found}
 else{for(const [commodity,keywords] of Object.entries(config.keywords||{})){const found=extractKeyword(text,keywords,{commodity,unit,window:config.window||160});if(found)prices[commodity]=found}}
 return {prices,pageDate,textLength:text.length}
}
export async function fetchSource(source,{timeoutMs=15000,fetchImpl=globalThis.fetch,now=new Date()}={}){
 const started=Date.now()
 if(!source.url||!source.fetch)return {sourceId:source.id,name:source.name,status:'skipped',error:'Fonte sem leitura automática configurada.',prices:{},url:source.url||'',fetchedAt:now.toISOString()}
 try{
  const response=await fetchImpl(source.url,{headers:{'User-Agent':'Mozilla/5.0 (compatible; GraosMissoes/1.0; +https://github.com/lucasfelipe131/GRAO_MISSOES)','Accept':'text/html,application/xhtml+xml','Accept-Language':'pt-BR,pt;q=0.9'},signal:AbortSignal.timeout(timeoutMs),redirect:'follow'})
  if(!response.ok)return {sourceId:source.id,name:source.name,status:'failed',error:`HTTP ${response.status}`,prices:{},url:source.url,fetchedAt:now.toISOString(),ms:Date.now()-started}
  const html=(await response.text()).slice(0,1_500_000)
  const {prices,pageDate,textLength}=extractFromHtml(html,source,now)
  const found=Object.keys(prices).length
  return {sourceId:source.id,name:source.name,region:source.region,status:found?'ok':'empty',error:found?'':'Página lida, mas nenhum preço reconhecido.',prices,pageDate,textLength,url:source.url,fetchedAt:now.toISOString(),ms:Date.now()-started}
 }catch(error){return {sourceId:source.id,name:source.name,status:'failed',error:error.name==='TimeoutError'?'Tempo esgotado ao abrir a página.':String(error.message||error).slice(0,160),prices:{},url:source.url,fetchedAt:now.toISOString(),ms:Date.now()-started}}
}
export async function runComparison(sources,options={}){
 const now=options.now||new Date()
 const targets=sources.filter(source=>source.fetch&&source.url&&!source.own)
 const results=await Promise.all(targets.map(source=>fetchSource(source,{...options,now})))
 return {fetchedAt:now.toISOString(),results,okCount:results.filter(r=>r.status==='ok').length,total:results.length}
}
