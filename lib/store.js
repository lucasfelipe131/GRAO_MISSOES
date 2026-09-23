import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'

const empty=()=>({producers:[],quotes:[],requests:[],version:1})

export function createStore(dataDir){
 mkdirSync(dataDir,{recursive:true})
 const file=join(dataDir,'store.json')
 if(!existsSync(file))writeFileSync(file,JSON.stringify(empty(),null,2))
 let cache=null
 const read=()=>{if(cache)return cache;try{cache={...empty(),...JSON.parse(readFileSync(file,'utf8'))}}catch{cache=empty()}return cache}
 const write=next=>{cache=next;const temporary=`${file}.tmp`;writeFileSync(temporary,JSON.stringify(next,null,2));renameSync(temporary,file);return next}
 return {
  read,
  update(mutate){const store=structuredClone(read());const result=mutate(store);write(store);return result},
  file
 }
}
