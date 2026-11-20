const API = 'https://api.github.com'
export function esperaGitHub(headers, now = Date.now()) {
  const after = headers.get('retry-after')
  if (after !== null) {
    const seconds = Number(after)
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(after) - now
    if (Number.isFinite(delay) && delay >= 0) return delay
  }
  if (headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset')) * 1000 - now
    if (Number.isFinite(reset)) return Math.max(1000, reset + 1000)
  }
  return 60000
}

// Nunca escribe tokens o cuerpos de error. POST no se repite tras un fallo
// ambiguo: el servidor podría haber aceptado ya el trabajo.
export async function githubDataRequest(path, {token,method='GET',body} = {}, io = {}) {
  if (!path.startsWith('/') || path.startsWith('//') || !token) throw Error('Petición GitHub inválida')
  const fetcher = io.fetch || fetch, sleep = io.sleep || (ms=>new Promise(r=>setTimeout(r,ms)))
  const now = io.now || Date.now
  for (let attempt=0; attempt<3; attempt++) {
    let response
    try { response = await fetcher(API+path, {method,redirect:'error',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'espana-util-data-clock','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)}) }
    catch { const error=Error('GitHub no confirmó la petición'); error.code='GITHUB_UNCONFIRMED'; throw error }
    const text = await response.text()
    if (response.ok) return text ? JSON.parse(text) : null
    const limited = response.status===429 || (response.status===403 && (response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining')==='0'))
    if (attempt<2 && (limited || (method==='GET' && response.status>=500))) {
      const delay = limited ? esperaGitHub(response.headers,now()) : 1000 * 2**attempt
      // No acortamos Retry-After. Una espera larga queda para el próximo pulso.
      if (delay<=30000) { await sleep(Math.max(1000,delay)); continue }
    }
    const error=Error('GitHub rechazó la petición (HTTP '+response.status+')')
    error.code=limited?'GITHUB_RETRY_LATER':'GITHUB_HTTP_ERROR'; error.status=response.status
    if (limited) error.retryAt=now()+esperaGitHub(response.headers,now())
    throw error
  }
}
