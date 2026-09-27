import {createHmac,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto'
import {domainError,text} from './analysis.js'

export const roleKeys=['gerencial','operador','armazem']
const usernameRe=/^[a-z0-9][a-z0-9._-]{2,39}$/

export function hashPassword(password){
 const salt=randomBytes(16).toString('hex')
 const hash=scryptSync(String(password),salt,64).toString('hex')
 return `scrypt$${salt}$${hash}`
}
export function verifyPassword(password,stored){
 if(!stored||typeof stored!=='string')return false
 const [algo,salt,hash]=stored.split('$');if(algo!=='scrypt'||!salt||!hash)return false
 const candidate=scryptSync(String(password||''),salt,64)
 const expected=Buffer.from(hash,'hex')
 return candidate.length===expected.length&&timingSafeEqual(candidate,expected)
}
export function normalizeUserInput(input={},{requirePassword=true}={}){
 const username=text(input.username,40).toLowerCase()
 if(!usernameRe.test(username))throw domainError('Usuário inválido: use de 3 a 40 caracteres com letras minúsculas, números, ponto, hífen ou sublinhado.')
 const name=text(input.name,120)||username
 const role=text(input.role,20);if(!roleKeys.includes(role))throw domainError('Nível de acesso inválido.')
 const password=String(input.password??'')
 if(requirePassword||password){if(password.length<8)throw domainError('A senha precisa ter pelo menos 8 caracteres.');if(password.length>200)throw domainError('Senha longa demais.')}
 return {username,name,role,password:password||null,active:input.active===undefined?true:!(input.active===false||input.active==='false'||input.active===0||input.active==='0')}
}
export function makeToken(userId,secret,{ttlDays=30,now=Date.now()}={}){
 const exp=now+ttlDays*864e5
 const payload=`${userId}.${exp}`
 const sig=createHmac('sha256',secret).update(payload).digest('base64url')
 return `${payload}.${sig}`
}
export function verifyToken(token,secret,{now=Date.now()}={}){
 if(!token||typeof token!=='string')return null
 const parts=token.split('.');if(parts.length!==3)return null
 const [userId,expRaw,sig]=parts;const exp=Number(expRaw);if(!Number.isFinite(exp)||exp<now)return null
 const expected=createHmac('sha256',secret).update(`${userId}.${exp}`).digest('base64url')
 const a=Buffer.from(sig);const b=Buffer.from(expected)
 if(a.length!==b.length||!timingSafeEqual(a,b))return null
 return {userId,exp}
}
export const publicUser=u=>({id:u.id,username:u.username,name:u.name,role:u.role,active:u.active!==false,createdAt:u.createdAt,updatedAt:u.updatedAt,lastLoginAt:u.lastLoginAt||null,createdBy:u.createdBy||null})
