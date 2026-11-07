import { validaUrlDeportiva } from './deportes.mjs'

/** Minimal anonymous cookie jar for the public federation navigation, not a login. */
export function creaSesionFederativa(origen, opciones = {}) {
  const permitidos = new Set([new URL(origen).origin, ...(opciones.origenesPermitidos || [])])
  const cookies = new Map(), fetcher = opciones.fetcher || fetch
  const reloj = opciones.reloj || Date.now
  const espera = opciones.espera || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  let siguiente = 0, peticiones = 0, bytes = 0
  const limite = 12 * 1024 * 1024
  function guardaCookie(cadena, url) {
    const [par, ...atributos] = cadena.split(';'), corte = par.indexOf('=')
    if (corte <= 0) return
    const nombre = par.slice(0, corte).trim(), valor = par.slice(corte + 1).trim()
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(nombre) || /[\r\n;]/.test(valor)) return
    const attrs = Object.fromEntries(atributos.map(a => { const i = a.indexOf('='); return [a.slice(0, i < 0 ? a.length : i).trim().toLowerCase(), i < 0 ? '' : a.slice(i + 1).trim()] }))
    const dominio = (attrs.domain || url.hostname).replace(/^\./, '').toLowerCase()
    if (!dominio.includes('.') || url.hostname !== dominio && !url.hostname.endsWith('.' + dominio)) return
    const defecto = url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/'
    const ruta = attrs.path?.startsWith('/') ? attrs.path : defecto
    const caduca = /^-?\d+$/.test(attrs['max-age'] || '') ? reloj() + Number(attrs['max-age']) * 1000 : Number.isFinite(Date.parse(attrs.expires)) ? Date.parse(attrs.expires) : Infinity
    const clave = `${dominio}|${ruta}|${nombre}`
    if (caduca <= reloj()) cookies.delete(clave)
    else cookies.set(clave, { nombre, valor, dominio, ruta, soloHost: !attrs.domain, segura: Object.hasOwn(attrs, 'secure'), caduca })
  }
  function cabecera(url) {
    return [...cookies.values()].filter(c => c.caduca > reloj() && (c.soloHost ? c.dominio === url.hostname : c.dominio === url.hostname || url.hostname.endsWith('.' + c.dominio)) && (url.pathname === c.ruta || url.pathname.startsWith(c.ruta.endsWith('/') ? c.ruta : c.ruta + '/')) && (!c.segura || url.protocol === 'https:')).sort((a, b) => b.ruta.length - a.ruta.length).map(c => `${c.nombre}=${c.valor}`).join('; ')
  }
  async function leer(entrada) {
    let url = new URL(entrada, origen)
    for (let salto = 0; salto < 8; salto++) {
      if (!validaUrlDeportiva(url.href) || !permitidos.has(url.origin)) throw Error('La federación redirige fuera de sus portales públicos permitidos')
      const demora = siguiente - reloj()
      if (demora > 0) await espera(demora)
      await opciones.antesDePedir?.(url.href)
      siguiente = reloj() + 1000
      const cookie = cabecera(url)
      const respuesta = await fetcher(url.href, { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'EspanaUtil/1.0 (+https://webapp-3ft.pages.dev/privacidad)', Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', ...(cookie ? { Cookie: cookie } : {}) } })
      peticiones++
      for (const c of respuesta.headers.getSetCookie?.() || []) guardaCookie(c, url)
      if (respuesta.status === 429) {
        const valor = respuesta.headers.get('Retry-After'), fecha = Number.isFinite(Date.parse(valor)) ? Date.parse(valor) : 0
        const solicitada = /^\d+$/.test(valor || '') ? reloj() + Number(valor) * 1000 : fecha > reloj() ? fecha : reloj() + 3600000
        const hasta = Number.isFinite(solicitada) && Math.abs(solicitada) <= 8640000000000000 ? solicitada : reloj() + 3600000
        await opciones.alLimite?.(new Date(Math.max(reloj() + 1000, hasta)).toISOString())
        await respuesta.body?.cancel()
        throw Error('La federación ha limitado las consultas; se respeta su descanso antes de continuar')
      }
      if ([301, 302, 303, 307, 308].includes(respuesta.status) && respuesta.headers.get('location')) {
        url = new URL(respuesta.headers.get('location'), url)
        await respuesta.body?.cancel()
        continue
      }
      if (!respuesta.ok) { await respuesta.body?.cancel(); throw Error(`Fuente federativa HTTP ${respuesta.status}`) }
      if (Number(respuesta.headers.get('content-length')) > limite) { await respuesta.body?.cancel(); throw Error('Documento federativo demasiado grande') }
      if (!respuesta.body) throw Error('Documento federativo vacío')
      const lector = respuesta.body.getReader(), trozos = []
      let total = 0
      try {
        for (;;) {
          const { done, value } = await lector.read()
          if (done) break
          total += value.byteLength
          if (total > limite) { await lector.cancel(); throw Error('Documento federativo demasiado grande') }
          trozos.push(value)
        }
      } finally { lector.releaseLock() }
      const cuerpo = new Uint8Array(total)
      let offset = 0
      for (const trozo of trozos) { cuerpo.set(trozo, offset); offset += trozo.byteLength }
      bytes += total
      const cab = respuesta.headers.get('content-type') || '', inicio = new TextDecoder().decode(cuerpo.slice(0, 1500))
      const juego = `${cab} ${inicio}`.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase() || 'utf-8'
      if (!['utf-8', 'utf8', 'iso-8859-1', 'iso-8859-15', 'windows-1252'].includes(juego)) throw Error('Codificación federativa no reconocida')
      return { html: new TextDecoder(juego).decode(cuerpo), url: url.href }
    }
    throw Error('La federación no ha completado su navegación pública')
  }
  return { leer, estadisticas: () => ({ peticiones, bytes }) }
}
