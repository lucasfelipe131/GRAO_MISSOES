import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('app.js não usa $(...) (elemento único) com forEach', ()=>{
 const src=readFileSync(new URL('../public/app.js',import.meta.url),'utf8')
 const bad=src.split('\n').map((l,i)=>[i+1,l]).filter(([,l])=>/(^|[^$\w])\$\((['"`])[^)]*\2\)\.forEach/.test(l))
 assert.deepEqual(bad.map(([n,l])=>n+': '+l.slice(0,80)),[])
})
