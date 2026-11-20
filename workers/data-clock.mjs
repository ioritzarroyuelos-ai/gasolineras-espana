import { DATA_REPOSITORY, DATA_REPOSITORY_ID, DATA_APP_SLUG, DATA_CLOCK_EVENT, clockPayload } from '../scripts/lib/data-clock-protocol.mjs'
import { githubDataRequest } from '../scripts/lib/github-data-api.mjs'

const b64url = value => btoa(typeof value==='string'?value:String.fromCharCode(...new Uint8Array(value))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
export async function appJwt(clientId, pkcs8, now = Date.now()) {
  if (!/^Iv[0-9A-Za-z_.-]+$/.test(clientId || '') || !/^-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]+-----END PRIVATE KEY-----\s*$/.test(pkcs8 || '')) throw Error('Credenciales del reloj no válidas')
  const der = Uint8Array.from(atob(pkcs8.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),c=>c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign'])
  const seconds = Math.floor(now/1000)
  const text = b64url(JSON.stringify({alg:'RS256',typ:'JWT'}))+'.'+b64url(JSON.stringify({iat:seconds-60,exp:seconds+540,iss:clientId}))
  return text+'.'+b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(text)))
}

export async function sendClockPulse(env, io = {}) {
  const now = io.now?.() ?? Date.now(), request = io.request || githubDataRequest
  // Si KV no responde o su contenido es inválido, no se consulta GitHub.
  const saved=await env.CLOCK_STATE.get('notBefore',{cacheTtl:30})
  if (saved!==null && (!/^\d+$/.test(saved) || !Number.isSafeInteger(Number(saved)))) throw Error('Espera persistente no válida')
  if (saved!==null && Number(saved)>now) return {skipped:true,notBefore:new Date(Number(saved)).toISOString()}
  let token,limited=false
  const persistLimit=async error=>{
    if (error.code!=='GITHUB_RETRY_LATER') return
    limited=true
    if (!Number.isSafeInteger(error.retryAt) || error.retryAt<now) throw Error('GitHub no indicó una espera válida')
    await env.CLOCK_STATE.put('notBefore',String(error.retryAt),{expirationTtl:Math.max(60,Math.ceil((error.retryAt-now)/1000)+60)})
  }
  try {
    const jwt = await appJwt(env.DATA_APP_CLIENT_ID,env.DATA_APP_PRIVATE_KEY,now)
    const app = await request('/app',{token:jwt})
    if (app.slug!==DATA_APP_SLUG || app.client_id!==env.DATA_APP_CLIENT_ID || !Number.isSafeInteger(app.id)) throw Error('La clave no pertenece a la App autorizada')
    const install = await request('/repos/'+DATA_REPOSITORY+'/installation',{token:jwt})
    if (install.app_id!==app.id || install.account?.login!==DATA_REPOSITORY.split('/')[0] || !Number.isSafeInteger(install.id) || install.suspended_at) throw Error('Instalación del robot incorrecta')
    const issued = await request('/app/installations/'+install.id+'/access_tokens',{token:jwt,method:'POST',body:{repository_ids:[DATA_REPOSITORY_ID],permissions:{contents:'write'}}})
    token=issued.token
    if (typeof token!=='string' || !token || issued.permissions?.contents!=='write' || Object.entries(issued.permissions||{}).some(([k,v])=>k!=='contents' && k!=='metadata' && v!=='none')) throw Error('Permisos temporales inesperados')
    const accessible = await request('/installation/repositories?per_page=100',{token})
    if (accessible.total_count!==1 || accessible.repositories?.length!==1 || accessible.repositories[0].id!==DATA_REPOSITORY_ID || accessible.repositories[0].full_name!==DATA_REPOSITORY) throw Error('El token no está limitado al repositorio autorizado')
    const payload = clockPayload(env.DATA_APP_CLIENT_ID,now)
    await request('/repos/'+DATA_REPOSITORY+'/dispatches',{token,method:'POST',body:{event_type:DATA_CLOCK_EVENT,client_payload:payload}})
    return {slot:payload.slot,sentAt:payload.sentAt,repository:DATA_REPOSITORY}
  } catch(error) { await persistLimit(error); throw error }
  finally {
    // Revocar también es una petición: una cuota agotada espera a que el token
    // expire por sí solo (1h), sin saltarse Retry-After para intentar borrarlo.
    if (token && !limited) {
      try { await request('/installation/token',{token,method:'DELETE'}) }
      catch(error) { await persistLimit(error); throw error }
    }
  }
}

export default {
  async scheduled(_controller,env) {
    try { const result=await sendClockPulse(env); console.log(JSON.stringify({event:'data-clock',result:result.skipped?'deferred':'delivered',...result})) }
    catch(error) { console.error(JSON.stringify({event:'data-clock',result:'failed',code:error.code||'CLOCK_ERROR',status:error.status||null})); throw Error('No se ha completado el pulso de actualización') }
  },
  fetch(request) {
    if (request.method==='GET' && new URL(request.url).pathname==='/health') return Response.json({ok:true,service:'data-clock'},{headers:{'Cache-Control':'no-store'}})
    return new Response('Not found',{status:404})
  },
}
