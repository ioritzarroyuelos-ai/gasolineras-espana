// Observatorio de precios — agregados nacionales, por provincia y por marca.
//
// Para que sirva de material citable hay que dar lo que el Geoportal oficial NO
// da: comparativas y variacion. El dato de hoy lo tiene cualquiera (todos los
// agregadores descargan el mismo fichero del Ministerio); lo que aqui se
// construye es el ranking y la diferencia entre extremos, que es lo que un
// medio puede citar y enlazar.
//
// Se usa la MEDIANA, no la media: cuatro gasolineras de autopista muy caras
// desplazan la media de una provincia y darian un titular falso.

import { median } from './pure'
import { PROVINCIAS } from './provincias'

export const FUEL_FIELD = {
  g95: 'Precio Gasolina 95 E5',
  diesel: 'Precio Gasoleo A',
} as const

export type FuelKey = keyof typeof FUEL_FIELD

export interface ProvinciaPrecio {
  id: string
  slug: string
  name: string
  precio: number      // euros/litro (mediana)
  estaciones: number
}

export interface MarcaPrecio {
  marca: string
  precio: number
  estaciones: number
}

export interface ObservatorioFuel {
  nacional: number | null
  provincias: ProvinciaPrecio[]   // ordenadas de mas barata a mas cara
  marcas: MarcaPrecio[]           // ordenadas de mas barata a mas cara
}

export interface Observatorio {
  fechaMinisterio?: string
  totalEstaciones: number
  g95: ObservatorioFuel
  diesel: ObservatorioFuel
}

function parsePrecio(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const n = parseFloat(v.replace(',', '.'))
  return isFinite(n) && n > 0 ? n : null
}

// Los rotulos del Ministerio vienen sucios: mayusculas, minusculas, y muchas
// estaciones independientes usan un numero de registro como rotulo ("Nº 10.935").
// Esos no son marca y ensuciarian el ranking, asi que se descartan.
function normalizaMarca(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  if (/^n[ºo°.\s]*[\d.]+$/i.test(s)) return null   // "Nº 10.935"
  if (/^[\d.\s-]+$/.test(s)) return null            // solo numeros
  const up = s.toUpperCase()
  // Unificamos variantes conocidas para que no salgan duplicadas en el ranking.
  if (up.includes('REPSOL')) return 'Repsol'
  if (up.includes('CEPSA')) return 'Cepsa'
  if (up.includes('GALP')) return 'Galp'
  if (up.includes('SHELL')) return 'Shell'
  if (up.includes('BP')) return 'BP'
  if (up.includes('CARREFOUR')) return 'Carrefour'
  if (up.includes('ALCAMPO')) return 'Alcampo'
  if (up.includes('MERCADONA')) return 'Mercadona'
  if (up.includes('BALLENOIL')) return 'Ballenoil'
  if (up.includes('PETROPRIX')) return 'Petroprix'
  if (up.includes('PLENOIL')) return 'Plenoil'
  if (up.includes('EASYGAS')) return 'EasyGas'
  if (up.includes('AVIA')) return 'Avia'
  if (up.includes('MEROIL')) return 'Meroil'
  if (up.includes('DISA')) return 'Disa'
  if (up.includes('PETRONOR')) return 'Petronor'
  if (up.includes('BONAREA') || up.includes('BONÀREA')) return 'BonArea'
  if (up.includes('EROSKI')) return 'Eroski'
  // Resto: formato titulo, para que no salga todo en mayusculas.
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

const MIN_ESTACIONES_MARCA = 40   // por debajo, el dato no es representativo

interface StationRaw { [k: string]: unknown }

function aggregate(stations: StationRaw[], field: string): ObservatorioFuel {
  const porProvincia = new Map<string, number[]>()
  const porMarca = new Map<string, number[]>()
  const todos: number[] = []

  for (const s of stations) {
    const p = parsePrecio(s[field])
    if (p == null) continue
    todos.push(p)

    const provId = String(s['IDProvincia'] || '').padStart(2, '0')
    if (provId) {
      const arr = porProvincia.get(provId)
      if (arr) arr.push(p); else porProvincia.set(provId, [p])
    }
    const marca = normalizaMarca(s['Rótulo'] ?? s['Rotulo'])
    if (marca) {
      const arr = porMarca.get(marca)
      if (arr) arr.push(p); else porMarca.set(marca, [p])
    }
  }

  const provincias: ProvinciaPrecio[] = []
  for (const p of PROVINCIAS) {
    const vals = porProvincia.get(p.id)
    if (!vals || vals.length < 3) continue
    provincias.push({
      id: p.id, slug: p.slug, name: p.name,
      precio: median(vals), estaciones: vals.length,
    })
  }
  provincias.sort((a, b) => a.precio - b.precio)

  const marcas: MarcaPrecio[] = []
  for (const [marca, vals] of porMarca) {
    if (vals.length < MIN_ESTACIONES_MARCA) continue
    marcas.push({ marca, precio: median(vals), estaciones: vals.length })
  }
  marcas.sort((a, b) => a.precio - b.precio)

  return {
    nacional: todos.length ? median(todos) : null,
    provincias,
    marcas,
  }
}

export function buildObservatorio(snap: { Fecha?: string; ListaEESSPrecio?: StationRaw[] } | null): Observatorio | null {
  if (!snap || !Array.isArray(snap.ListaEESSPrecio) || !snap.ListaEESSPrecio.length) return null
  const stations = snap.ListaEESSPrecio
  return {
    fechaMinisterio: typeof snap.Fecha === 'string' ? snap.Fecha : undefined,
    totalEstaciones: stations.length,
    g95: aggregate(stations, FUEL_FIELD.g95),
    diesel: aggregate(stations, FUEL_FIELD.diesel),
  }
}

// Variacion porcentual entre dos precios, redondeada a 1 decimal.
export function variacionPct(actual: number | null, previo: number | null): number | null {
  if (actual == null || previo == null || previo === 0) return null
  return Math.round(((actual - previo) / previo) * 1000) / 10
}

// ---- Variaciones a 7/30/90 dias ----
//
// El dato son SEIS numeros, pero obtenerlos costaba 11,9 s medidos en produccion
// (cabecera X-Diag: d1=11902 sobre un total de 11911). La consulta agregaba unos
// 95 dias x 2 combustibles x 11.460 estaciones ~ 2,2 millones de filas, y como
// price_cents no esta en idx_fuel_date, cada fila obligaba a saltar a la tabla.
// D1 resuelve una PK en 106 ms y se hunde en agregaciones de ese tamano.
//
// Por eso ya no se calcula al servir la pagina: lo hace el cron de ingesta, que
// recorre lo mismo una vez al dia, y deja el resultado en KV. Si falta, la
// pagina sale sin variaciones — que es la degradacion que el codigo ya preveia
// cuando D1 no respondia.

export interface VariacionCalc {
  dias: number
  pct: number | null
}

export interface VariacionesObservatorio {
  generatedAt: string
  g95: VariacionCalc[]
  diesel: VariacionCalc[]
}

export const VENTANAS_DIAS = [7, 30, 90] as const

export interface FilaHistorico {
  date: string
  fuel_code: string
  avg_cents: number
  n?: number
}

// Para cada ventana compara el ultimo dato con el punto mas cercano a
// "ultimo - N dias": no siempre hay dato exacto de ese dia.
function variacionesDeSerie(arr: Array<{ date: string; v: number }>): VariacionCalc[] {
  return VENTANAS_DIAS.map(dias => {
    if (arr.length < 2) return { dias, pct: null }
    const ultimo = arr[arr.length - 1]
    const objetivo = new Date(ultimo.date)
    objetivo.setUTCDate(objetivo.getUTCDate() - dias)
    const target = objetivo.toISOString().slice(0, 10)
    let previo: { date: string; v: number } | null = null
    for (const p of arr) { if (p.date <= target) previo = p; else break }
    return { dias, pct: previo ? variacionPct(ultimo.v, previo.v) : null }
  })
}

// rows debe venir ordenado por fecha ascendente.
export function calculaVariaciones(rows: FilaHistorico[], ahora: Date = new Date()): VariacionesObservatorio {
  const series = new Map<string, Array<{ date: string; v: number }>>([['95', []], ['diesel', []]])
  for (const r of rows) series.get(r.fuel_code)?.push({ date: r.date, v: r.avg_cents })
  return {
    generatedAt: ahora.toISOString(),
    g95: variacionesDeSerie(series.get('95') || []),
    diesel: variacionesDeSerie(series.get('diesel') || []),
  }
}

// Clave en KV donde el cron deja el resultado.
export const KV_VARIACIONES = 'observatorio:variaciones'

// Serie diaria (95 dias) del precio medio nacional, dejada por el cron para que
// /api/stats/national (home) no reagregue D1 en cada visita.
export const KV_STATS_NACIONAL = 'stats:national:series'

// ---- Camino rapido: observatorio pre-calculado ----
//
// buildObservatorio() cuesta 9,4 s en produccion porque obliga a parsear los
// 11,9 MB de stations.json y recorrer 12.000 estaciones dos veces. Para evitarlo,
// scripts/fetch-prices.mjs deja los agregados ya resueltos en
// public/data/observatorio.json cada vez que baja el snapshot.
//
// Ese fichero guarda las provincias por ID y sin nombre: el join con PROVINCIAS
// se hace aqui, para que la tabla de slugs siga viviendo en un unico sitio.
//
// buildObservatorio() se mantiene como respaldo: si el fichero falta (deploy
// anterior al primer cron) o no valida, la pagina sale igual, solo que lenta.

export interface ProvinciaPre {
  id: string
  precio: number
  estaciones: number
}

export interface ObservatorioPreFuel {
  nacional: number | null
  provincias: ProvinciaPre[]
  marcas: MarcaPrecio[]
}

export interface ObservatorioPre {
  v?: number
  fechaMinisterio?: string
  totalEstaciones?: number
  g95?: ObservatorioPreFuel
  diesel?: ObservatorioPreFuel
}

const PROVINCIA_BY_ID: ReadonlyMap<string, { slug: string; name: string }> =
  new Map(PROVINCIAS.map(p => [p.id, { slug: p.slug, name: p.name }]))

function hidrataFuel(pre: ObservatorioPreFuel): ObservatorioFuel {
  const provincias: ProvinciaPrecio[] = []
  // El script ya las deja ordenadas de mas barata a mas cara; aqui solo se
  // resuelve el nombre. Un ID que no este en PROVINCIAS (p.ej. "00" de una
  // estacion sin provincia) simplemente se cae.
  for (const p of pre.provincias) {
    const hit = PROVINCIA_BY_ID.get(p.id)
    if (!hit) continue
    provincias.push({ id: p.id, slug: hit.slug, name: hit.name, precio: p.precio, estaciones: p.estaciones })
  }
  return { nacional: pre.nacional, provincias, marcas: pre.marcas }
}

function fuelValido(f: unknown): f is ObservatorioPreFuel {
  if (!f || typeof f !== 'object') return false
  const x = f as ObservatorioPreFuel
  return Array.isArray(x.provincias) && Array.isArray(x.marcas)
    && (x.nacional === null || typeof x.nacional === 'number')
}

// Devuelve null si el fichero no encaja con lo esperado, para que el llamante
// pueda caer al calculo completo en lugar de servir una pagina rota.
export function observatorioFromPre(pre: ObservatorioPre | null): Observatorio | null {
  if (!pre || pre.v !== 1) return null
  if (!fuelValido(pre.g95) || !fuelValido(pre.diesel)) return null
  const g95 = hidrataFuel(pre.g95)
  const diesel = hidrataFuel(pre.diesel)
  if (!g95.provincias.length && !diesel.provincias.length) return null
  return {
    fechaMinisterio: pre.fechaMinisterio,
    totalEstaciones: typeof pre.totalEstaciones === 'number' ? pre.totalEstaciones : 0,
    g95,
    diesel,
  }
}
