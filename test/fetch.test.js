import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {extractFromHtml,extractIndicator,extractKeyword,htmlToText,latestDate,runComparison,runIndicators} from '../lib/fetch.js'
import {loadSources} from '../lib/analysis.js'

const sources=loadSources().sources
const coopHtml=`<html><head><title>Coopatrigo</title><style>.x{}</style><script>var a=1;</script></head><body><h1>Todas as cotações</h1><p>Atualizado em 27/09/2026 09:15</p><table><tr><th>Data da Cotação</th><th>Soja (60kg) 72hs</th><th>Trigo (60kg) pH 78</th><th>Milho (60kg)</th><th>Arroz</th></tr><tr><td>27/09/2026</td><td>R$ 141,50</td><td>R$ 76,00</td><td>R$ 62,00</td><td>R$ 90,00</td></tr></table><footer>Telefone 55 3352 1000</footer></body></html>`
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
 assert.deepEqual(Object.keys(coop.prices).sort(),['arroz','milho','soja','trigo']);assert.equal(coop.prices.trigo.price,76);assert.equal(coop.prices.soja.observedDate,'2026-09-27');assert.equal(coop.pageDate,'2026-09-27')
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

test('tabela por coluna (Coopatrigo) e por linha (praças) são lidas a partir do HTML',()=>{
 const coopTable=`<html><body><h2>Todas as cotações</h2><table><thead><tr><th><div>Data da Cotação</div></th><th><div>Soja</div></th><th><div>Trigo</div></th><th><div>Milho</div></th><th><div>Arroz</div></th><th><div>Canola</div></th><th>Triguilho</th></tr></thead><tbody><tr><td>27/09/2026</td><td>R$ 141,00</td><td>R$ 75,00</td><td>R$ 62,00</td><td></td><td>R$ 215,00</td><td>R$ 40,00</td></tr><tr><td>26/09/2026</td><td>R$ 140,00</td><td>R$ 75,00</td><td>R$ 62,00</td><td>R$ 88,00</td><td>R$ 214,00</td><td>R$ 40,00</td></tr></tbody></table></body></html>`
 const coop=extractFromHtml(coopTable,sources.find(s=>s.id==='coopatrigo'))
 assert.equal(coop.prices.soja.price,141);assert.equal(coop.prices.trigo.price,75);assert.equal(coop.prices.milho.price,62);assert.equal(coop.prices.canola.price,215);assert.equal(coop.prices.soja.observedDate,'2026-09-27');assert.equal(coop.prices.arroz,undefined)
 const naTable=`<html><body><aside>Milho (Passo Fundo-RS-R$/60Kg) 70,00</aside><table><tr><th>Praça</th><th>Preço</th><th>Var</th></tr><tr><td>Santo Ângelo/RS</td><td>141,50</td><td>0,35%</td></tr><tr><td>Cruz Alta/RS</td><td>142,00</td><td>0,00%</td></tr></table></body></html>`
 const na=extractFromHtml(naTable,sources.find(s=>s.id==='na-soja-fisico'))
 assert.equal(na.prices.soja.price,141.5);assert.match(na.prices.soja.snippet,/Santo Ângelo/)
 const agro=extractFromHtml(`<table><tr><td>Trigo em Grão Nacional Sc 60Kg São Luiz Gonzaga (RS)</td><td>São Luiz Gonzaga (RS)</td><td></td><td>21/09/2026</td></tr></table><p>Mostrando 1 até 30 de 132</p>`,sources.find(s=>s.id==='agrolink-slg'))
 assert.deepEqual(agro.prices,{})
 const cotrisal=extractFromHtml(`<div>Região Norte | SOJA | R$ 138,00 | MILHO | R$ 60,00</div><div>Região Noroeste | SOJA | R$ 141,00 | MILHO | R$ 62,00 | TRIGO (pH 78) | R$ 75,00</div>`,sources.find(s=>s.id==='cotrisal'))
 assert.equal(cotrisal.prices.soja.price,141);assert.equal(cotrisal.prices.milho.price,62);assert.equal(cotrisal.prices.trigo.price,75)
})

test('leitura por linha respeita a prioridade das praças e ignora linhas sem cotação',()=>{
 const html=`<table><tr><th>Praça</th><th>Preço</th><th>Var</th></tr><tr><td>Não-Me-Toque/RS (Cotrijal)</td><td>s/ cotação</td><td>-</td></tr><tr><td>Ubiratã/PR (Coagru)</td><td>139,00</td><td>-0,71</td></tr><tr><td>Passo Fundo/RS</td><td>140,00</td><td>0,00</td></tr><tr><td>Santo Ângelo/RS (Cotrisa)</td><td>141,50</td><td>0,35</td></tr></table>`
 const na=extractFromHtml(html,sources.find(s=>s.id==='na-soja-fisico'))
 assert.equal(na.prices.soja.price,141.5);assert.equal(na.prices.soja.keyword,'santo angelo')
 const onlyRs=extractFromHtml(html.replace('Santo Ângelo/RS (Cotrisa)','Tupanciretã/RS'),sources.find(s=>s.id==='na-soja-fisico'))
 assert.equal(onlyRs.prices.soja.price,140);assert.equal(onlyRs.prices.soja.keyword,'passo fundo')
})

test('tabelas de um grão só (uma por cultura) também são lidas por coluna',()=>{
 const html=`<table><tr><th>Data</th><th>Soja (60kg) 72hs</th></tr><tr><td>27/09/2026</td><td>141,00</td></tr></table><table><tr><th>Data</th><th>Milho</th></tr><tr><td>27/09/2026</td><td>62,00</td></tr></table><table><tr><th>Data</th><th>Canola</th></tr><tr><td>27/09/2026</td><td></td></tr><tr><td>26/09/2026</td><td>214,00</td></tr></table><table><tr><th>Telefones</th></tr><tr><td>3352 4400</td></tr></table>`
 const coop=extractFromHtml(html,sources.find(s=>s.id==='coopatrigo'))
 assert.equal(coop.prices.soja.price,141);assert.equal(coop.prices.milho.price,62);assert.equal(coop.prices.canola.price,214);assert.equal(coop.prices.canola.observedDate,'2026-09-26');assert.equal(coop.prices.trigo,undefined)
})

test('valores em ordem da página (Coopatrigo cotações completas) são pareados com os nomes dos grãos',()=>{
 const html=`<html><body><div class="cot"><div>Soja</div><div>Trigo</div><div>Milho</div><div>Arroz</div><div>Canola</div><div>Triguilho</div><div>Triticale</div></div><table><tr><td>R$ 141,00</td></tr><tr><td>R$ 74,00</td></tr><tr><td>R$ 61,00</td></tr><tr><td>R$ 80,00</td></tr><tr><td>R$ 214,00</td></tr><tr><td>R$ 40,00</td></tr><tr><td>R$ 55,00</td></tr></table><table><tr><td>55 3352 4400</td></tr></table></body></html>`
 const coop=extractFromHtml(html,sources.find(s=>s.id==='coopatrigo'))
 assert.equal(coop.prices.soja.price,141);assert.equal(coop.prices.trigo.price,74);assert.equal(coop.prices.milho.price,61);assert.equal(coop.prices.arroz.price,80);assert.equal(coop.prices.canola.price,214)
 assert.match(coop.prices.soja.snippet,/ordem da página/)
})

test('ordem da página aceita tabela de valores com linhas extras e pares parciais',()=>{
 const html=`<div>Soja</div><div>Trigo</div><div>Milho</div><div>Arroz</div><div>Canola</div><div>Triguilho</div><div>Triticale</div><table>${['R$ 141,00','R$ 74,00','R$ 61,00','R$ 80,00','-','-','-','27/09/2026','26/09/2026'].map(v=>`<tr><td>${v}</td></tr>`).join('')}</table>`
 const coop=extractFromHtml(html,sources.find(s=>s.id==='coopatrigo'))
 assert.equal(coop.prices.soja.price,141);assert.equal(coop.prices.trigo.price,74);assert.equal(coop.prices.milho.price,61);assert.equal(coop.prices.arroz.price,80);assert.equal(coop.prices.canola,undefined)
})

test('nome de grão exige limite de palavra: “trigo” não casa com “Coopatrigo”',()=>{
 const html=`<title>Coopatrigo • Cooperativa Tritícola » Cotações completas</title><nav>Soja | Trigo | Milho | Arroz | Canola | Triguilho | Triticale</nav><table>${['R$ 141,00','R$ 74,00','R$ 61,00','R$ 80,00','R$ 150,00','R$','R$'].map(v=>`<tr><td>${v}</td></tr>`).join('')}</table>`
 const coop=extractFromHtml(html,sources.find(s=>s.id==='coopatrigo'))
 assert.equal(coop.prices.soja.price,141);assert.equal(coop.prices.trigo.price,74);assert.equal(coop.prices.milho.price,61);assert.equal(coop.prices.canola.price,150)
 const text=htmlToText('<p>Coopatrigo cotações 3352 4400</p><p>Trigo pH 78 R$ 75,00</p>')
 assert.equal(extractKeyword(text,['trigo'],{commodity:'trigo'}).price,75)
 assert.equal(extractKeyword('Coopatrigo telefone 3352 4400 valor 75,00',['trigo'],{commodity:'trigo'}),null)
})

test('sem os nomes dos grãos no texto, a ordem configurada é usada como padrão',()=>{
 const html=`<title>Cotações completas</title><table>${['R$ 141,00','R$ 74,00','R$ 61,00','R$ 80,00','R$ 150,00','R$','R$'].map(v=>`<tr><td>${v}</td></tr>`).join('')}</table>`
 const coop=extractFromHtml(html,sources.find(s=>s.id==='coopatrigo'))
 assert.equal(coop.prices.soja.price,141);assert.equal(coop.prices.trigo.price,74);assert.equal(coop.prices.milho.price,61);assert.equal(coop.prices.canola.price,150)
})

test('histórico de datas é extraído das páginas de indicador e do trigo por linha do RS',()=>{
 const cepea=`<table><tr><th>Data</th><th>Valor</th><th>Var</th></tr><tr><td>26/09/2026</td><td>160,80</td><td>-0,45%</td></tr><tr><td>25/09/2026</td><td>161,52</td><td>0,10%</td></tr><tr><td>24/09/2026</td><td>161,36</td><td>0,00%</td></tr></table>`
 const soja=extractFromHtml(cepea,sources.find(s=>s.id==='cepea-soja-paranagua'))
 assert.equal(soja.history.length,3);assert.equal(soja.history[0].date,'2026-09-24');assert.equal(soja.history[2].price,160.8);assert.equal(soja.history[0].commodity,'soja')
 const trigo=`<table><tr><th>Data</th><th>Paraná</th><th>Var</th><th>Rio Grande do Sul</th><th>Var</th></tr><tr><td>25/09/2026</td><td>1.532,17</td><td>0,3</td><td>1.437,03</td><td>0,2</td></tr><tr><td>24/09/2026</td><td>1.530,00</td><td>0,1</td><td>1.430,00</td><td>0,1</td></tr></table>`
 const rs=extractFromHtml(trigo,sources.find(s=>s.id==='cepea-trigo'))
 assert.equal(rs.history.length,2);assert.equal(rs.history[1].price,1437.03)
 const porto=extractFromHtml(`<table><tr><th>Praça</th><th>Preço</th></tr><tr><td>Rio Grande/RS</td><td>162,00</td></tr><tr><td>Ijuí/RS</td><td>143,00</td></tr></table>`,sources.find(s=>s.id==='na-soja-porto-rio-grande'))
 assert.equal(porto.prices.soja.price,162)
})

test('página só de histórico (Agrolink RS) vira leitura ok com o último dia e todas as datas',()=>{
 const html=`<h1>Histórico de cotações</h1><table><tr><th>Data</th><th>Preço</th><th>Variação</th></tr><tr><td>26/09/2026</td><td>R$ 143,42</td><td>0,5%</td></tr><tr><td>25/09/2026</td><td>R$ 142,70</td><td>0,0%</td></tr><tr><td>15/03/2026</td><td>R$ 121,10</td><td>-1,2%</td></tr><tr><td>15/11/2025</td><td>R$ 128,00</td><td>0,3%</td></tr></table>`
 const src=sources.find(s=>s.id==='agrolink-hist-rs-soja');assert.ok(src&&src.fetch.history)
 const r=extractFromHtml(html,src,new Date('2026-09-27T12:00:00Z'))
 assert.equal(r.history.length,4);assert.equal(r.history[0].date,'2025-11-15');assert.equal(r.history[3].price,143.42)
 assert.equal(r.prices.soja.price,143.42);assert.equal(r.prices.soja.observedDate,'2026-09-26');assert.match(r.debug.historico,/4 data/)
 const onlyText=extractFromHtml('<p>15/11/2025 128,00</p><p>26/09/2026 143,42</p>',src,new Date('2026-09-27T12:00:00Z'));assert.equal(onlyText.prices.soja?.fromHistory,true);assert.equal(onlyText.prices.soja.observedDate,'2026-09-26')
})

test('histórico mensal Mês/Ano (Agrolink RS) vira um ponto por mês com a média estadual',()=>{
 const html=`<table><tr><th>Mês/Ano</th><th>Estadual</th><th>Nacional</th></tr><tr><td>9/2026</td><td>138,6711</td><td>140,7668</td></tr><tr><td>8/2026</td><td>127,3591</td><td>129,0178</td></tr><tr><td>12/2025</td><td>121,0000</td><td>119,5</td></tr><tr><td>1/2024</td><td>130,1</td><td>128,0</td></tr></table>`
 const src=sources.find(s=>s.id==='agrolink-hist-rs-soja')
 const r=extractFromHtml(html,src,new Date('2026-09-27T12:00:00Z'))
 assert.deepEqual(r.history.map(h=>[h.date,h.price]),[['2024-01-15',130.1],['2025-12-15',121],['2026-08-15',127.36],['2026-09-15',138.67]])
 assert.match(r.history[0].snippet,/média mensal 1\/2024/);assert.equal(r.prices.soja.price,138.67);assert.equal(r.prices.soja.observedDate,'2026-09-15')
 const empty=extractFromHtml('<table><tr><th>Mês/Ano</th><th>Estadual</th><th>Nacional</th></tr></table>',sources.find(s=>s.id==='agrolink-hist-rs-trigo'),new Date('2026-09-27T12:00:00Z'));assert.equal(empty.history.length,0);assert.equal(Object.keys(empty.prices).length,0)
})

test('indicadores: dólar e Chicago exigem número decimal na linha do contrato ou do grão, ignorando anos, horas e outras commodities',async()=>{
 const pattern='^(jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[a-z]*\\.?\\s*/?\\s*(20)?\\d{2}$'
 const page='<table><tr><th>Contrato</th><th>Último</th><th>Var.</th></tr><tr><td>NOV 2026</td><td>1.288,00</td><td>-31,00</td></tr><tr><td>JAN 2027</td><td>1.301,25</td><td>-30,00</td></tr></table><p>Última atualização: 13:47 (28/09)</p><table><tr><td>Café (Dec26)</td><td>288,95</td><td>3,72 %</td></tr><tr><td>Milho (Dec26)</td><td>528,50</td><td>-0,52 %</td></tr><tr><td>Soja (Nov26)</td><td>1.288,00</td><td>-2,35 %</td></tr></table>'
 const text=htmlToText(page)
 const soja=extractIndicator(page,text,{range:[700,2200],rowKeys:['soja ('],rowPattern:pattern});assert.equal(soja.value,1288);assert.equal(soja.change,-2.35)
 const milho=extractIndicator(page,text,{range:[250,900],rowKeys:['milho ('],rowPattern:pattern});assert.equal(milho.value,528.5);assert.equal(milho.change,-0.52)
 const trigo=extractIndicator(page,text,{range:[350,1300],rowKeys:['trigo ('],rowPattern:pattern});assert.equal(trigo.value,1288);assert.equal(trigo.change,null)
 const wheatPage='<h2>Soja - Bolsa de Chicago</h2><table><tr><th>Contrato</th><th>Último</th></tr><tr><td>NOV 2026</td><td>1.288,00</td></tr></table><h2>Trigo - Bolsa de Chicago (CME Group)</h2><table><tr><th>Contrato</th><th>Último</th><th>Var.</th></tr><tr><td>DEC 2026</td><td>782,50</td><td>+1,10%</td></tr></table>'
 const w=extractIndicator(wheatPage,htmlToText(wheatPage),{range:[350,1300],rowKeys:['trigo ('],rowPattern:pattern,contextKey:'trigo'});assert.equal(w.value,782.5);assert.equal(w.change,1.1);assert.match(w.context,/Trigo/)
 const sj=extractIndicator(wheatPage,htmlToText(wheatPage),{range:[700,2200],rowKeys:['soja ('],rowPattern:pattern,contextKey:'soja'});assert.equal(sj.value,1288)
 const widgetPage='<div>CHICAGO (CME)</div><ul><li>Soja</li><li>Prêmio</li><li>Milho</li><li>Trigo</li></ul><table><tr><td>NOV 2026</td><td>1.289,25</td><td>-29,75</td></tr></table><h1>Cotações Mercado Futuro do Trigo - Chicago</h1><table><tr><th>Contrato</th><th>Último</th><th>Var.</th></tr><tr><td>DEC 2026</td><td>782,50</td><td>+1,10%</td></tr></table>'
 const wt=extractIndicator(widgetPage,htmlToText(widgetPage),{range:[350,1300],rowKeys:['trigo ('],rowPattern:pattern,contextKey:'trigo'});assert.equal(wt.value,782.5)
 const ws=extractIndicator(widgetPage,htmlToText(widgetPage),{range:[700,2200],rowKeys:['soja ('],rowPattern:pattern,contextKey:'soja'});assert.equal(ws.value,1289.25)
 const tabs='<div>CHICAGO (CME)</div><ul><li>Soja</li><li>Prêmio</li><li>Milho</li><li>Trigo</li></ul><table><tr><td>NOV 2026</td><td>1.290,50</td><td>-28,50</td></tr></table><table><tr><td>DEC 2026</td><td>522,75</td><td>-5,50</td></tr></table><table><tr><td>DEC 2026</td><td>781,25</td><td>+0,90</td></tr></table>'
 const tabsText=htmlToText(tabs)
 assert.equal(extractIndicator(tabs,tabsText,{range:[350,1300],rowPattern:pattern,contextKey:'trigo',months:['mar','mai','may','jul','set','sep','dez','dec'],typical:[400,1150]}).value,781.25)
 assert.equal(extractIndicator(tabs,tabsText,{range:[250,900],rowPattern:pattern,contextKey:'milho',months:['mar','mai','may','jul','set','sep','dez','dec'],typical:[300,800]}).value,522.75)
 assert.equal(extractIndicator(tabs,tabsText,{range:[700,2200],rowPattern:pattern,contextKey:'soja',months:['jan','mar','mai','may','jul','ago','aug','set','sep','nov'],typical:[850,1800]}).value,1290.5)
 const dolar='<p>Última atualização: 13:47 (28/09)</p><table><tr><th>Moeda</th><th>Compra</th><th>Venda</th><th>Var.</th></tr><tr><td>Dólar Comercial</td><td>5,3812</td><td>5,3820</td><td>-0,21%</td></tr></table>'
 const d=extractIndicator(dolar,htmlToText(dolar),{range:[3,9],rowKeys:['dolar comercial'],keywords:['dolar comercial']});assert.equal(d.value,5.3812);assert.equal(d.change,-0.21)
 assert.equal(extractIndicator('<p>Última atualização: 13:47 (28/09) valor 9</p>','Última atualização: 13:47 (28/09) valor 9',{range:[3,9],keywords:['atualiza']}),null)
 const txt='Dólar comercial fechou a R$ 5,52 nesta sexta';assert.equal(extractIndicator('<p>'+txt+'</p>',txt,{range:[3,9],keywords:['dolar comercial']}).value,5.52)
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(req.url.includes('dolar')?dolar:'<html>vazio</html>')});await new Promise(r=>server.listen(0,r));const base='http://127.0.0.1:'+server.address().port
 try{const out=await runIndicators([{key:'dolar',label:'Dólar',url:base+'/nada',urls:[base+'/dolar'],unit:'BRL/USD',format:'R$ {v}',decimals:4,fetch:{range:[3,9],rowKeys:['dolar comercial']}},{key:'x',label:'X',url:base+'/nada',fetch:{range:[1,2]}}],{now:new Date('2026-09-28T12:00:00Z')});assert.equal(out.okCount,1);assert.equal(out.results[0].display,'R$ 5,3812');assert.equal(out.results[0].attempts.length,2);assert.equal(out.results[1].status,'empty')}finally{server.close()}
})
