import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {extractFromHtml,extractKeyword,htmlToText,latestDate,runComparison} from '../lib/fetch.js'
import {loadSources} from '../lib/analysis.js'

const sources=loadSources().sources
const coopHtml=`<html><head><title>Coopatrigo</title><style>.x{}</style><script>var a=1;</script></head><body><h1>Todas as cotações</h1><p>Atualizado em 27/09/2026 09:15</p><table><tr><td>Soja (60kg) 72hs</td><td>R$ 141,50</td></tr><tr><td>Milho (60kg)</td><td>R$ 62,00</td></tr><tr><td>Trigo (60kg) pH 78</td><td>R$ 76,00</td></tr><tr><td>Arroz</td><td>R$ 90,00</td></tr></table><footer>Telefone 55 3352 1000</footer></body></html>`
const cepeaHtml=`<html><body><h2>Indicador da Soja CEPEA/ESALQ - Paranaguá</h2><table><tr><th>Data</th><th>Valor R$</th><th>Var</th></tr><tr><td>26/09/2026</td><td>160,80</td><td>-0,45%</td></tr><tr><td>25/09/2026</td><td>161,52</td><td>0,10%</td></tr></table></body></html>`
const trigoHtml=`<html><body><h2>Trigo CEPEA</h2><div>Paraná: 1.532,17 (+0,3%)</div><div>Rio Grande do Sul: 1.419,84 (+0,2%) 26/09/2026</div></body></html>`

test('texto é extraído sem scripts e o preço é lido perto do nome do grão',()=>{
 const text=htmlToText(coopHtml)
 assert.doesNotMatch(text,/var a=1/)
 const soja=extractKeyword(text,['soja (60kg) 72hs','soja'],{commodity:'soja'})
 assert.equal(soja.price,141.5);assert.match(soja.snippet,/Soja/)
 assert.equal(extractKeyword(text,['telefone'],{commodity:'soja'}),null)
 assert.equal(latestDate(text,new Date('2026-09-27T12:00:00Z')),'2026-09-27')
})

test('estratégias por fonte reconhecem cooperativa, indicador CEPEA e trigo em R$/t',()=>{
 const coop=extractFromHtml(coopHtml,sources.find(s=>s.id==='coopatrigo'))
 assert.deepEqual(Object.keys(coop.prices).sort(),['milho','soja','trigo']);assert.equal(coop.prices.trigo.price,76);assert.equal(coop.pageDate,'2026-09-27')
 const cepea=extractFromHtml(cepeaHtml,sources.find(s=>s.id==='cepea-soja-paranagua'))
 assert.equal(cepea.prices.soja.price,160.8);assert.equal(cepea.prices.soja.observedDate,'2026-09-26')
 const trigo=extractFromHtml(trigoHtml,sources.find(s=>s.id==='cepea-trigo'))
 assert.equal(trigo.prices.trigo.price,1419.84);assert.equal(trigo.prices.trigo.priceUnit,'BRL/t')
})

test('comparativo lê fontes em paralelo, tolera falhas e nunca inclui a fonte própria',async()=>{
 const pages={'/coop':coopHtml,'/cepea':cepeaHtml}
 const server=createServer((req,res)=>{if(req.url==='/lento'){setTimeout(()=>res.end('x'),3000);return}const html=pages[req.url];if(!html){res.statusCode=500;res.end('erro');return}res.setHeader('Content-Type','text/html');res.end(html)})
 await new Promise(r=>server.listen(0,r));const base=`http://127.0.0.1:${server.address().port}`
 const fake=[
  {id:'cvale',name:'C.Vale',own:true,url:base+'/coop',fetch:{strategy:'keyword',keywords:{soja:['soja']}},priceUnit:'BRL/sc_60kg'},
  {id:'coopatrigo',name:'Coopatrigo',url:base+'/coop',fetch:sources.find(s=>s.id==='coopatrigo').fetch,priceUnit:'BRL/sc_60kg'},
  {id:'cepea-soja-paranagua',name:'CEPEA',url:base+'/cepea',fetch:{strategy:'table-latest',commodity:'soja'},priceUnit:'BRL/sc_60kg'},
  {id:'quebrada',name:'Quebrada',url:base+'/erro',fetch:{strategy:'keyword',keywords:{soja:['soja']}},priceUnit:'BRL/sc_60kg'},
  {id:'lenta',name:'Lenta',url:base+'/lento',fetch:{strategy:'keyword',keywords:{soja:['soja']}},priceUnit:'BRL/sc_60kg'},
  {id:'semfetch',name:'Manual',url:'',priceUnit:'BRL/sc_60kg'}
 ]
 try{
  const result=await runComparison(fake,{timeoutMs:500})
  assert.equal(result.total,4);assert.equal(result.okCount,2)
  assert.ok(!result.results.some(r=>r.sourceId==='cvale'));assert.ok(!result.results.some(r=>r.sourceId==='semfetch'))
  assert.equal(result.results.find(r=>r.sourceId==='quebrada').status,'failed')
  assert.match(result.results.find(r=>r.sourceId==='lenta').error,/Tempo esgotado/)
  assert.equal(result.results.find(r=>r.sourceId==='coopatrigo').prices.soja.price,141.5)
 }finally{server.close()}
})
