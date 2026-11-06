import { z } from 'zod'
import { instanteLocal } from '../../scripts/lib/fechas.mjs'

const AEMET = 'https://www.aemet.es'
const MUNICIPIOS = AEMET + '/es/eltiempo/prediccion/municipios/'
const MAPA = AEMET + '/es/eltiempo/prediccion/avisos'
const API = AEMET + '/es/api-eltiempo/'
const CINCO_MINUTOS = 300_000

export interface AvisoTiempo {
  fenomeno: string
  nivel: 'amarillo' | 'naranja' | 'rojo'
  inicio: string
  fin: string
}
export interface AvisosTiempo {
  estado: 'verificado' | 'no_disponible' | 'desactualizado'
  zona: string | null
  url: string
  consultado: string
  hasta: string | null
  avisos: AvisoTiempo[]
}
interface Opciones {
  slug?: string
  cache?: Cache
  origenCache?: string
  fetcher?: typeof fetch
  ahora?: number
}
interface Zona { codigo: string; nombre: string }
type Leer = (url: string) => Promise<Response>

// Núcleos de municipios segregados cuya ficha de AEMET todavía puede carecer de zona.
// Coordenadas oficiales de tiempo-municipios.ts contrastadas con la cartografía de
// https://www.aemet.es/es/eltiempo/prediccion/avisos/ayuda/ y la ficha de su municipio
// de origen (BOE-A-2019-9366 y BOE-A-2023-1953). Para Torrenueva, AEMET identifica
// directamente la zona en /es/eltiempo/prediccion/playas/torrenueva-1814004.
// Parte de algunos términos bordea otra zona. El nombre delimita el alcance al núcleo.
const zonasDeNucleos: Record<string, Zona | undefined> = {
  '11903': { codigo: '611101', nombre: 'Grazalema' },
  '14901': { codigo: '611402', nombre: 'Campiña cordobesa' },
  '14902': { codigo: '611402', nombre: 'Campiña cordobesa' },
  '18077': { codigo: '611801', nombre: 'Cuenca del Genil' },
  '18916': { codigo: '611804', nombre: 'Costa granadina' },
  '21902': { codigo: '612102', nombre: 'Andévalo y Condado' },
  '41904': { codigo: '614102', nombre: 'Campiña sevillana' },
  '48916': { codigo: '754802', nombre: 'Bizkaia interior' },
}

// Mismo origen y código INE incluso si AEMET redirige un nombre bilingüe a su URL canónica.
async function zonaMunicipal(ine: string, slug: string | undefined, leer: Leer): Promise<Zona> {
  const nombre = slug && /^[a-z0-9-]+$/.test(slug) ? slug : 'municipio'
  let url = MUNICIPIOS + nombre + '-id' + ine
  for (let paso = 0; paso < 2; paso++) {
    const respuesta = await leer(url)
    const utf8 = /charset=["']?utf-8/i.test(respuesta.headers.get('Content-Type') || '')
    const html = new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(await respuesta.arrayBuffer())
    const canonica = /<link\s+rel="canonical"\s+href="([^"]+)"/i.exec(html)?.[1]
    if (!canonica?.startsWith(MUNICIPIOS) || !canonica.endsWith('-id' + ine)) break
    const codigo = /\/es\/eltiempo\/prediccion\/avisos\?w=(?:hoy|mna|pmna)(?:&amp;|&)l=(\d{6})"/.exec(html)?.[1]
    const nombreZona = /<span[^>]*>Zona de avisos<\/span>\s*:\s*(?:&nbsp;)?\s*([^<>]+?)\s*<br\s*\/?>/i.exec(html)?.[1]
    if (codigo && nombreZona) return { codigo, nombre: nombreZona.trim().replaceAll('&amp;', '&') }
    if (canonica === url) break
    url = canonica
  }
  throw new Error('El municipio carece de una zona oficial identificable')
}

const hora = z.object({
  validez_ini: z.string(),
  validez_ini_utc: z.string(),
  fenomenos: z.array(z.object({ id: z.string(), tipo: z.string().min(1) })).min(1),
})
const mapa = z.object({
  elaborado: z.string(), validez_ini_pen: z.string(), validez_fin_pen: z.string(),
  validez_ini_can: z.string(), validez_fin_can: z.string(),
  f_hoy: z.string(), f_can_hoy: z.string(),
  f_hoy_disp: z.string(), f_mna_disp: z.string(), f_pmna_disp: z.string(),
  f_can_hoy_disp: z.string(), f_can_mna_disp: z.string(), f_can_pmna_disp: z.string(),
  areas: z.record(z.string(), z.object({ horas: z.array(hora).min(1) })),
})
const detalle = z.object({ orden_avisos: z.array(z.tuple([z.string(), z.object({
  Codigo: z.string(), FemParam: z.string(), Onset: z.string(), Expire: z.string(),
  Severity: z.enum(['Amarillo', 'Naranja', 'Rojo']),
})])) })
const niveles = { Amarillo: 'amarillo', Naranja: 'naranja', Rojo: 'rojo' } as const

// Los extremos del boletín tienen offset. Las fechas del mapa se expresan en hora local.
// instanteLocal trabaja a precisión de minuto, por lo que aquí se conservan también los segundos.
function fechaOficial(valor: string, zona: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:[0-5]\d$/.test(valor)) return NaN
  return instanteLocal(valor, zona) + Number(valor.slice(-2)) * 1000
}
function fechaConZona(valor: string) {
  return /(?:Z|[+-]\d\d:\d\d)$/.test(valor) ? Date.parse(valor) : NaN
}

async function consultaZona(ine: string, zona: Zona, leer: Leer, ahora: number): Promise<AvisosTiempo> {
  const provincia = ine.slice(0, 2)
  const canarias = provincia === '35' || provincia === '38'
  const huso = canarias ? 'Atlantic/Canary' : 'Europe/Madrid'
  const ambito = canarias ? 'CAN' : provincia === '51' ? 'CEU' : provincia === '52' ? 'MEL' : 'PB'
  const parte = mapa.parse(await (await leer(API + 'avisos-horas/' + ambito + '/9/' + zona.codigo)).json())
  const elaboracion = fechaOficial(parte.elaborado, 'Europe/Madrid')
  const inicio = fechaOficial(canarias ? parte.validez_ini_can : parte.validez_ini_pen, huso)
  const fin = fechaOficial(canarias ? parte.validez_fin_can : parte.validez_fin_pen, huso)
  const resultado: AvisosTiempo = { estado: 'verificado', zona: zona.nombre, url: MAPA + '?l=' + zona.codigo,
    consultado: new Date(ahora).toISOString(), hasta: null, avisos: [] }
  if (![elaboracion, inicio, fin].every(Number.isFinite)) throw new Error('Fechas de avisos incompletas')
  if (ahora - elaboracion > 2 * 3_600_000 || elaboracion > ahora + CINCO_MINUTOS || ahora < inicio || ahora > fin) {
    return { ...resultado, estado: 'desactualizado' }
  }

  const disponibles = canarias ? [parte.f_can_hoy_disp, parte.f_can_mna_disp, parte.f_can_pmna_disp] : [parte.f_hoy_disp, parte.f_mna_disp, parte.f_pmna_disp]
  const primerDia = (canarias ? parte.f_can_hoy : parte.f_hoy).slice(0, 10)
  const civil = Date.parse(primerDia + 'T00:00:00Z')
  const dias = disponibles.map((_, i) => new Date(civil + i * 86400000).toISOString().slice(0, 10))
  const primerHueco = disponibles.findIndex(v => v !== 's')
  const publicados = dias.slice(0, primerHueco < 0 ? dias.length : primerHueco)
  if (!publicados.length) throw new Error('Mapa sin resumen vigente')
  const hasta = Math.min(fin, fechaOficial(publicados[publicados.length - 1] + 'T23:59:59', huso))
  if (!Number.isFinite(hasta) || hasta < ahora) return { ...resultado, estado: 'desactualizado' }
  resultado.hasta = new Date(hasta).toISOString()

  // El propio mapa devuelve también la subzona costera (sufijo C) si corresponde.
  // Los bloques horarios sólo sirven para localizar los boletines pertinentes. El
  // principio y el fin de cada aviso se toman de Onset y Expire del detalle oficial.
  const fenomenos = new Map<string, string>()
  const diasConAviso = new Set<string>()
  for (const [codigo, area] of Object.entries(parte.areas)) {
    if (codigo !== zona.codigo && codigo !== zona.codigo + 'C') throw new Error('El mapa devolvió otra zona')
    for (const h of area.horas) {
      const desde = fechaConZona(h.validez_ini_utc + 'Z')
      if (!Number.isFinite(desde)) throw new Error('Hora de aviso no válida')
      for (const f of h.fenomenos) fenomenos.set(f.id, f.tipo)
      if (desde + 3_600_000 > ahora && desde <= hasta) diasConAviso.add(h.validez_ini.slice(0, 10))
    }
  }
  const grupos = await Promise.all([...diasConAviso].map(async dia => {
    const i = publicados.indexOf(dia)
    if (i < 0) throw new Error('Día fuera del resumen publicado')
    const local = dia + 'T12:00:00'
    const offset = (Date.parse(local + 'Z') - fechaOficial(local, huso)) / 3_600_000
    const marca = local + '+' + String(offset).padStart(2, '0') + ':00'
    const url = API + 'resumen-lista-avisos/' + ambito + '/' + marca + '/D+' + i + '/' + zona.codigo
    const lista = detalle.parse(await (await leer(url)).json()).orden_avisos
    if (!lista.length) throw new Error('Falta el detalle del aviso indicado por el mapa')
    return lista.map(([clave, aviso]) => {
      const codigo = clave.split('-').at(-1)
      const fenomeno = fenomenos.get(aviso.FemParam.slice(0, 2))
      const desde = fechaConZona(aviso.Onset), hastaAviso = fechaConZona(aviso.Expire)
      if (aviso.Codigo !== clave || (codigo !== zona.codigo && codigo !== zona.codigo + 'C') ||
        !fenomeno || !Number.isFinite(desde) || !Number.isFinite(hastaAviso) || desde > hastaAviso) {
        throw new Error('Boletín incompleto o de otra zona')
      }
      return { fenomeno, nivel: niveles[aviso.Severity], inicio: new Date(desde).toISOString(), fin: new Date(hastaAviso).toISOString() }
    })
  }))
  // Varios umbrales del mismo fenómeno pueden compartir zona, nivel y vigencia.
  const unicos = new Map<string, AvisoTiempo>()
  for (const aviso of grupos.flat()) if (Date.parse(aviso.fin) >= ahora) unicos.set(JSON.stringify(aviso), aviso)
  resultado.avisos = [...unicos.values()].sort((a, b) => a.inicio.localeCompare(b.inicio))
  return resultado
}

export async function consultaAvisos(ine: string, opciones: Opciones = {}): Promise<AvisosTiempo> {
  const ahora = opciones.ahora ?? Date.now()
  const fallo: AvisosTiempo = { estado: 'no_disponible', zona: null, url: MAPA,
    consultado: new Date(ahora).toISOString(), hasta: null, avisos: [] }
  if (!/^\d{5}$/.test(ine)) return fallo
  const signal = AbortSignal.timeout(6500)
  const leer: Leer = async url => {
    const res = await (opciones.fetcher ?? fetch)(url, { signal, headers: { 'Accept-Language': 'es' } })
    if (!res.ok) throw new Error('AEMET no disponible')
    return res
  }
  const clave = (ruta: string) => new Request(new URL('/_cache/tiempo/avisos/v1/' + ruta, opciones.origenCache || AEMET))
  const cache = opciones.cache
  async function leeCache<T>(ruta: string): Promise<T | undefined> {
    try { return await (await cache?.match(clave(ruta)))?.json() as T | undefined } catch { return undefined }
  }
  async function guardaCache(ruta: string, datos: unknown, segundos: number) {
    try {
      if (cache) await cache.put(clave(ruta), Response.json(datos, { headers: { 'Cache-Control': 'public, max-age=' + segundos } }))
    } catch { /* la respuesta oficial también se puede usar sin caché */ }
  }
  try {
    let zona = await leeCache<Zona>('municipio/' + ine)
    if (!zona) {
      try {
        zona = await zonaMunicipal(ine, opciones.slug, leer)
      } catch (error) {
        const nucleo = zonasDeNucleos[ine]
        if (!nucleo) throw error
        zona = { codigo: nucleo.codigo, nombre: nucleo.nombre + ' (núcleo urbano)' }
      }
      await guardaCache('municipio/' + ine, zona, 7 * 24 * 3600)
    }
    fallo.zona = zona.nombre
    fallo.url = MAPA + '?l=' + zona.codigo
    const ruta = 'zona/' + zona.codigo
    const copia = await leeCache<AvisosTiempo>(ruta)
    if (copia?.estado === 'verificado' && ahora - Date.parse(copia.consultado) < CINCO_MINUTOS && Date.parse(copia.hasta || '') >= ahora) {
      return { ...copia, zona: zona.nombre, avisos: copia.avisos.filter(a => Date.parse(a.fin) >= ahora) }
    }
    const actual = await consultaZona(ine, zona, leer, ahora)
    if (actual.estado === 'verificado') await guardaCache(ruta, actual, CINCO_MINUTOS / 1000)
    return actual
  } catch { return fallo }
}
