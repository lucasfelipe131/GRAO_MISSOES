import test from 'node:test'
import assert from 'node:assert/strict'
import {buildMap,buildRegionalView,deskSummary,extractPlaceRows,findPlace,geocode,haversineKm,nearestPlaces,normalizeCoords,parsePlaceCell,priceFromCells,runRegional,searchPlaces} from '../lib/geo.js'

const html=`<html><body><h2>Soja - Mercado Físico</h2><table><tr><th>Praça</th><th>Preço (R$/sc)</th><th>Variação</th><th>Data</th></tr>
<tr><td>Cruz Alta/RS</td><td>146,00</td><td>0,69%</td><td>29/09/2026</td></tr>
<tr><td>Santa Rosa/RS</td><td>R$ 147,00</td><td>-0,50%</td><td>29/09/2026</td></tr>
<tr><td>Passo Fundo (RS)</td><td>144,00</td><td>0,00%</td><td>29/09/2026</td></tr>
<tr><td>Rondonópolis/MT</td><td>141,50</td><td>1,00%</td><td>29/09/2026</td></tr>
<tr><td>Média/RS</td><td>145,00</td><td></td><td></td></tr>
<tr><td>Vila Nova do Nada/RS</td><td>140,00</td><td></td><td>29/09/2026</td></tr>
<tr><td>DEZ/26</td><td>1.288,50</td><td></td><td></td></tr></table>
<table><tr><td>Chicago</td><td>1.288,50</td></tr></table></body></html>`

test('distâncias, catálogo, busca e coordenadas',()=>{
 assert.equal(haversineKm({lat:-28.408,lon:-54.961},{lat:-28.299,lon:-54.263}),69.4)
 assert.equal(haversineKm({lat:-28.4,lon:-54.9},null),null)
 assert.equal(findPlace('Santo Angelo').uf,'RS');assert.equal(findPlace('cruz alta','RS').name,'Cruz Alta');assert.equal(findPlace('Nao Me Toque').name,'Não-Me-Toque');assert.equal(findPlace('Cidade Inexistente'),null)
 assert.equal(searchPlaces('cascavel pr')[0].label,'Cascavel/PR');assert.equal(searchPlaces('santo ang')[0].label,'Santo Ângelo/RS');assert.ok(searchPlaces('mt').every(p=>p.uf==='MT'));assert.equal(searchPlaces('').length,0)
 const near=nearestPlaces({lat:-28.5,lon:-54.9},{limit:2});assert.equal(near[0].label,'São Luiz Gonzaga/RS');assert.ok(near[0].distanceKm<near[1].distanceKm)
 assert.deepEqual(normalizeCoords({lat:'-28,4',lon:'-54.96'}),{lat:-28.4,lon:-54.96});assert.deepEqual(normalizeCoords({}),{lat:null,lon:null})
 assert.throws(()=>normalizeCoords({lat:-28.4}),/juntas/);assert.throws(()=>normalizeCoords({lat:40,lon:-54}),/fora do Brasil/)
})

test('leitura das tabelas de mercado físico por praça ignora médias, contratos e datas',()=>{
 assert.deepEqual(parsePlaceCell('Cascavel/PR'),{name:'Cascavel',uf:'PR',buyer:''});assert.deepEqual(parsePlaceCell('Rio Grande (RS)'),{name:'Rio Grande',uf:'RS',buyer:''});assert.deepEqual(parsePlaceCell('Não-Me-Toque/RS (Cotrijal)'),{name:'Não-Me-Toque',uf:'RS',buyer:'Cotrijal'});assert.deepEqual(parsePlaceCell('Porto Rio Grande (disponível) (Insoy Commodities)'),{name:'Rio Grande',uf:'RS',buyer:'Insoy Commodities'});assert.equal(parsePlaceCell('DEZ/26'),null);assert.equal(parsePlaceCell('Média/PR'),null);assert.equal(parsePlaceCell('Soja'),null)
 assert.deepEqual(priceFromCells(['29/09/2026','0,72%','R$ 141,50'],'soja'),{price:141.5,priceUnit:'BRL/sc_60kg',cell:'R$ 141,50'})
 assert.equal(priceFromCells(['2026','1.288,50'],'trigo').priceUnit,'BRL/t');assert.equal(priceFromCells(['abc','12'],'soja'),null)
 const {rows,pageDate}=extractPlaceRows(html,{commodity:'soja',now:new Date('2026-09-29T12:00:00Z')})
 assert.equal(pageDate,'2026-09-29');assert.deepEqual(rows.map(r=>r.name),['Cruz Alta','Santa Rosa','Passo Fundo','Rondonópolis','Vila Nova do Nada'])
 assert.equal(rows[0].price,146);assert.equal(rows[0].placeId,'cruz-alta-rs');assert.equal(rows[2].lat,-28.263);assert.equal(rows[4].placeId,null)
})

test('runRegional lê as fontes e a visão regional ordena por distância com comparação à C.Vale',async()=>{
 const fetchImpl=async url=>url.includes('falha')?{ok:false,status:404}:{ok:true,status:200,text:async()=>html}
 const reg=await runRegional([{id:'r1',name:'NA soja',commodity:'soja',url:'http://x/falha',urls:['http://x/ok']},{id:'r2',name:'NA milho',commodity:'milho',url:'http://x/falha'}],{fetchImpl,now:new Date('2026-09-29T12:00:00Z')})
 assert.equal(reg.okCount,1);assert.equal(reg.results[0].status,'ok');assert.equal(reg.results[0].count,5);assert.equal(reg.results[0].readUrl,'http://x/ok');assert.equal(reg.results[1].status,'failed');assert.equal(reg.rows.length,5)
 const quotes=[{commodity:'soja',price:140,priceUnit:'BRL/sc_60kg',sourceId:'cvale',observedAt:'2026-09-29T10:00:00Z',status:'active'}]
 const gps=buildRegionalView({regional:reg,quotes,ownSourceId:'cvale',lat:-28.4,lon:-54.5,now:new Date('2026-09-29T12:00:00Z')})
 assert.equal(gps.mode,'gps');assert.equal(gps.region.label,'Vitória das Missões/RS');assert.equal(gps.commodities.length,1)
 const soja=gps.commodities[0];assert.deepEqual(soja.nearest.map(x=>x.label),['Santa Rosa/RS','Cruz Alta/RS','Passo Fundo/RS','Rondonópolis/MT'])
 assert.equal(soja.nearest[0].vsOwnSc,7);assert.equal(soja.own.price,140);assert.equal(soja.ufAverage,144.25);assert.equal(soja.ufCount,4);assert.deepEqual(soja.unlocated,['Vila Nova do Nada/RS']);assert.equal(soja.best.label,'Santa Rosa/RS');assert.ok(soja.nearest[0].roadKm>soja.nearest[0].distanceKm)
 const byPlace=buildRegionalView({regional:reg,quotes:[],placeId:'rondonopolis-mt'});assert.equal(byPlace.mode,'praca');assert.equal(byPlace.commodities[0].nearest[0].label,'Rondonópolis/MT');assert.equal(byPlace.commodities[0].nearest[0].distanceKm,0);assert.equal(byPlace.commodities[0].uf,'MT')
 const byQuery=buildRegionalView({regional:reg,quotes:[],query:'passo fundo'});assert.equal(byQuery.mode,'busca');assert.equal(byQuery.origin.label,'Passo Fundo/RS')
 const home=buildRegionalView({regional:null,quotes:[]});assert.equal(home.mode,'casa');assert.equal(home.origin.label,'São Luiz Gonzaga/RS');assert.equal(home.commodities.length,0)
})

test('mapa de produtores: coordenadas do cadastro ou do município, unidade mais próxima e resumo para a mesa',()=>{
 const producers=[{id:'p1',name:'João',municipality:'Bossoroca',storageT:500,season:'2026/27',crops:{soja:{areaHa:100,yieldScHa:60,fixedPercent:20}}},{id:'p2',name:'Maria',municipality:'Santo Ângelo',lat:-28.3,lon:-54.26,distanceKm:80,deliveryLocation:'Coopatrigo',crops:{}},{id:'p3',name:'Zé',municipality:'Lugar Inexistente',crops:{}}]
 const map=buildMap({producers,units:[{id:'u1',name:'Unidade SLG',municipality:'São Luiz Gonzaga',capacityT:12000},{id:'u2',name:'Sem coordenada',municipality:'',capacityT:100}]})
 assert.equal(map.units.length,1);assert.equal(map.units[0].coordSource,'municipio')
 const j=map.producers.find(p=>p.id==='p1');assert.equal(j.coordSource,'municipio');assert.equal(j.straightKm,36.1);assert.equal(j.estimatedKm,47);assert.equal(j.distanceKm,47);assert.equal(j.distanceSource,'estimado');assert.equal(j.nearestUnit.name,'Unidade SLG');assert.equal(j.productionSc,6000);assert.equal(j.openSc,4800)
 const m=map.producers.find(p=>p.id==='p2');assert.equal(m.coordSource,'cadastro');assert.equal(m.distanceKm,80);assert.equal(m.distanceSource,'informado');assert.equal(m.estimatedKm,90)
 const z=map.producers.find(p=>p.id==='p3');assert.equal(z.lat,null);assert.equal(z.distanceKm,null)
 assert.deepEqual(map.summary.missing,['Zé']);assert.equal(map.summary.located,2);assert.equal(map.producers[0].id,'p1')
 const noUnits=buildMap({producers,units:[]});assert.equal(noUnits.units.length,1);assert.ok(noUnits.units[0].virtual);assert.equal(noUnits.units[0].name,'C.Vale — São Luiz Gonzaga')
 const desk=deskSummary(j);assert.match(desk,/Produtor: João — Bossoroca/);assert.match(desk,/47 km \(estimativa rodoviária; 36,1 km em linha reta\)/);assert.match(desk,/Safra 2026\/27: Soja 100 ha × 60 sc\/ha = 6.000 sc \(20% fixado, 4.800 sc em aberto\)/);assert.match(desk,/Armazenagem própria: 500 t/)
})

test('geocodificação: catálogo local primeiro, OSM quando disponível, e falha silenciosa',async()=>{
 const osm=async()=>({ok:true,status:200,json:async()=>[{lat:'-28.41',lon:'-54.96',display_name:'Linha Sete, São Luiz Gonzaga, RS, Brasil',type:'hamlet',address:{municipality:'São Luiz Gonzaga','ISO3166-2-lvl4':'BR-RS'}}]})
 const r=await geocode('Linha Sete São Luiz Gonzaga',{fetchImpl:osm});assert.equal(r.results.filter(x=>x.source==='osm').length,1);assert.equal(r.results.find(x=>x.source==='osm').uf,'RS');assert.equal(r.error,'')
 const local=await geocode('santo angelo',{fetchImpl:async()=>{throw new Error('sem rede')}});assert.equal(local.results[0].source,'catalogo');assert.equal(local.results[0].label,'Santo Ângelo/RS');assert.equal(local.error,'sem rede')
 assert.deepEqual((await geocode('',{fetchImpl:osm})).results,[])
})
