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
