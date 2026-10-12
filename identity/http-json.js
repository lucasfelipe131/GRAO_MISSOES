import {fault} from './primitives.js'

// The deadline covers headers and the complete body. Redirects cannot move
// credential-bearing requests away from the configured identity issuer.
export async function identityJson(fetcher,url,options={}, {timeoutMs=8000,maxBytes=16384}={}){
 const controller=new AbortController();let timer
 const work=(async()=>{
  const response=await fetcher(url,{...options,redirect:'error',signal:controller.signal})
  if(!response.ok)throw fault('central_identity_unavailable',401)
  const declared=Number(response.headers?.get?.('content-length'))
  if(Number.isFinite(declared)&&declared>maxBytes)throw fault('central_identity_response_limit',401)
  let raw
  if(response.body?.getReader){
   const reader=response.body.getReader();const chunks=[];let size=0
   try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw fault('central_identity_response_limit',401);chunks.push(Buffer.from(part.value))}raw=Buffer.concat(chunks).toString('utf8')}
   finally{reader.cancel().catch(()=>{})}
  }else if(typeof response.text==='function')raw=await response.text()
  else raw=JSON.stringify(await response.json())
  if(Buffer.byteLength(raw)>maxBytes)throw fault('central_identity_response_limit',401)
  const value=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw fault('central_identity_response_invalid',401)
  return value
 })()
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fault('central_identity_timeout',401))},timeoutMs)})
 try{return await Promise.race([work,deadline])}finally{clearTimeout(timer)}
}
