import { validarCompeticionDeportiva, validarIndiceDeportes, validarAgendaDeportes, fechaDeportiva } from './deportes.mjs'
import { construyeIndiceDeportes } from './deportes-indice.mjs'

const REPO = 'ioritzarroyuelos-ai/gasolineras-espana'
const BOT = 'espanautildatos-ioritzarroyuelos[bot]'
const TIPOS = ['agenda', 'clasificacion']
const fecha = b => b?.estado !== 'no_disponible' && b?.verificadoEn ? Date.parse(b.verificadoEn) : -Infinity

export function parseaPRsRecuperacion(valor) {
  if (typeof valor !== 'string' || !/^\s*[1-9]\d{0,8}:[a-f0-9]{40}(?:\s*,\s*[1-9]\d{0,8}:[a-f0-9]{40}){0,3}\s*$/.test(valor)) throw Error('Indica entre uno y cuatro pares explícitos PR:SHA de recuperación')
  const prs = valor.split(',').map(v => { const [numero, sha] = v.trim().split(':'); return { numero: Number(numero), sha } })
  if (new Set(prs.map(pr => pr.numero)).size !== prs.length) throw Error('PR de recuperación repetido')
  return prs
}

export function parseaFechaRecuperacion(valor, ahora = Date.now()) {
  if (!fechaDeportiva(valor) || Date.parse(valor + 'T00:00:00Z') > ahora) throw Error('La fecha mínima UTC de recuperación debe ser AAAA-MM-DD y no futura')
  return Date.parse(valor + 'T00:00:00Z')
}

export function validaPRRecuperacion(pr, { numero, sha }) {
  parseaPRsRecuperacion(numero + ':' + sha)
  if (pr?.number !== numero || pr.user?.login !== BOT || pr.user?.type !== 'Bot' || pr.user?.id !== 352320937 ||
    pr.head?.repo?.full_name !== REPO || pr.base?.repo?.full_name !== REPO || pr.base?.ref !== 'main' ||
    !/^datos\/deportes-\d+-\d+$/.test(pr.head?.ref || '') || pr.head?.sha !== sha) throw Error('La propuesta no corresponde al snapshot deportivo autorizado del robot')
  return pr.head.sha
}

/** Select whole verified blocks; a recovery never invents a consultation date. */
export function combinaRecuperacionDeportiva(actual, recuperada, tipos = TIPOS, ahora = Date.now()) {
  const candidata = validarCompeticionDeportiva(recuperada, ahora)
  if (actual) {
    actual = validarCompeticionDeportiva(actual, ahora)
    if (actual.id !== candidata.id || actual.deporte !== candidata.deporte || actual.temporada !== candidata.temporada) throw Error('La recuperación no puede mezclar identidades o temporadas')
  }
  const vacio = tipo => {
    const { verificadoEn, aviso, ...b } = candidata[tipo]
    return { ...b, estado: 'no_disponible', [tipo === 'agenda' ? 'eventos' : 'tablas']: [], aviso: 'Consulta la fuente oficial para este apartado.' }
  }
  const salida = { ...(actual || candidata), agenda: actual?.agenda || vacio('agenda'), clasificacion: actual?.clasificacion || vacio('clasificacion') }
  for (const tipo of tipos) {
    if (!TIPOS.includes(tipo)) throw Error('Apartado deportivo no reconocido')
    if (fecha(candidata[tipo]) > fecha(salida[tipo])) salida[tipo] = candidata[tipo]
  }
  if (Date.parse(candidata.comprobadoEn) > Date.parse(salida.comprobadoEn)) salida.comprobadoEn = candidata.comprobadoEn
  return validarCompeticionDeportiva(salida, ahora)
}

function coincideResumen(c, resumen) {
  for (const campo of ['id', 'deporte', 'temporada', 'nombre', 'grupo']) if (c[campo] !== resumen[campo]) throw Error('El JSON recuperado no corresponde a su índice')
  for (const tipo of TIPOS) if (c[tipo].verificadoEn !== resumen[tipo].verificadoEn || c[tipo].estado !== resumen[tipo].estado ||
    c[tipo][tipo === 'agenda' ? 'eventos' : 'tablas'].length !== resumen[tipo].total) throw Error('El apartado recuperado no coincide con su índice')
}

/** Fixed GitHub origins, pinned snapshots, bounded bodies, no upstream federation requests. */
export async function recuperaDeportesDesdePR({ seleccion, desde, indiceAnterior, anteriores, token = '', fetcher = fetch, ahora = Date.now() }) {
  const prs = parseaPRsRecuperacion(seleccion), minimo = parseaFechaRecuperacion(desde, ahora), indiceBase = validarIndiceDeportes(indiceAnterior, ahora)
  const mapa = new Map(anteriores.map(c => { const v = validarCompeticionDeportiva(c, ahora); return [v.id, v] }))
  if (mapa.size !== anteriores.length || mapa.size !== indiceBase.competiciones.length) throw Error('La copia actual está incompleta o repetida')
  for (const resumen of indiceBase.competiciones) {
    const c = mapa.get(resumen.id)
    if (!c) throw Error('Falta una competición de la copia actual')
    coincideResumen(c, resumen)
  }
  const limiteTiempo = Date.now() + 15 * 60000, control = new AbortController()
  let bytes = 0, peticiones = 0
  async function lee(url, maximo, autenticada = false) {
    if (++peticiones > 2500 || Date.now() >= limiteTiempo) throw Error('Se ha alcanzado el límite de la recuperación')
    const headers = { Accept: 'application/json', 'User-Agent': 'EspanaUtil-recuperacion-deportes' }
    if (autenticada && token) headers.Authorization = 'Bearer ' + token
    const r = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.any([control.signal, AbortSignal.timeout(Math.min(30000, limiteTiempo - Date.now()))]) })
    if (!r.ok) { await r.body?.cancel(); throw Error('GitHub rechazó la recuperación (HTTP ' + r.status + '); no se reintenta ni se publica') }
    if (!r.body) throw Error('Snapshot sin contenido')
    const lector = r.body.getReader(), partes = []; let tamaño = 0
    try {
      for (;;) {
        const { value, done } = await lector.read(); if (done) break
        tamaño += value.byteLength; bytes += value.byteLength
        if (tamaño > maximo || bytes > 256 * 1024 * 1024) { await lector.cancel(); throw Error('Snapshot demasiado grande') }
        partes.push(Buffer.from(value))
      }
    } finally { lector.releaseLock() }
    return JSON.parse(Buffer.concat(partes).toString('utf8'))
  }
  const raw = (sha, archivo) => `https://raw.githubusercontent.com/${REPO}/${sha}/public/data/deportes/${archivo}`
  const elegidos = new Map(), snapshots = []
  for (const objetivo of prs) {
    const { numero } = objetivo
    const sha = validaPRRecuperacion(await lee(`https://api.github.com/repos/${REPO}/pulls/${numero}`, 1024 * 1024, true), objetivo)
    const indice = validarIndiceDeportes(await lee(raw(sha, 'index.json'), 16 * 1024 * 1024), ahora)
    snapshots.push({ pr: numero, sha, generado: indice.generado })
    for (const c of indice.competiciones) for (const tipo of TIPOS) {
      const f = fecha(c[tipo]), actual = mapa.get(c.id)
      if (f < minimo || !Number.isFinite(f) || f <= fecha(actual?.[tipo])) continue
      if (actual && (actual.deporte !== c.deporte || actual.temporada !== c.temporada)) throw Error('Snapshot de otra identidad o temporada')
      const clave = c.id + '/' + tipo, previo = elegidos.get(clave)
      if (!previo || f > fecha(previo.resumen[tipo])) elegidos.set(clave, { sha, resumen: c, tipo })
    }
  }
  const descargas = new Map()
  for (const v of elegidos.values()) {
    const clave = v.sha + '/' + v.resumen.id
    const d = descargas.get(clave) || { ...v, tipos: [] }; d.tipos.push(v.tipo); descargas.set(clave, d)
  }
  const tareas = [...descargas.values()], recuperadas = new Array(tareas.length)
  let cursor = 0
  try {
    await Promise.all(Array.from({ length: Math.min(4, tareas.length) }, async () => {
      while (cursor < tareas.length) {
        const i = cursor++, t = tareas[i]
        const c = validarCompeticionDeportiva(await lee(raw(t.sha, t.resumen.id + '.json'), 8 * 1024 * 1024), ahora)
        coincideResumen(c, t.resumen); recuperadas[i] = c
      }
    }))
  } catch (error) { control.abort(); throw error }
  let nuevas = 0
  for (const [i, tarea] of tareas.entries()) {
    const c = recuperadas[i], anterior = mapa.get(c.id)
    if (!anterior) nuevas++
    mapa.set(c.id, combinaRecuperacionDeportiva(anterior, c, tarea.tipos, ahora))
  }
  const competiciones = [...mapa.values()]
  // Keep existing warnings: a snapshot recovery does not claim to recheck a source.
  const construidos = construyeIndiceDeportes(competiciones, indiceBase.incidencias, ahora)
  const indice = validarIndiceDeportes(construidos.indice, ahora)
  const agendas = Object.fromEntries(Object.entries(construidos.agendas).map(([clave, eventos]) => {
    const [zona, dia] = clave.split('/'); return [clave, validarAgendaDeportes({ eventos }, indice, dia, zona)]
  }))
  return { competiciones, indice, agendas, informe: { desde, snapshots, apartadosRecuperados: elegidos.size, competicionesNuevas: nuevas, peticiones, bytes } }
}
