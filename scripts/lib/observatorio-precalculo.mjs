// Agregacion del observatorio de precios, pre-calculada fuera del Worker.
//
// POR QUE EXISTE ESTE FICHERO
// /precios-carburantes tardaba 9,4 s medidos en produccion: el Worker parseaba
// stations.json (11,9 MB) y recorria 12.000 estaciones en CADA visita. La cache
// en memoria no salva, porque Cloudflare no garantiza reutilizar el isolate.
// Aqui ese trabajo se hace una vez por ciclo, al bajar el snapshot, y queda un
// fichero de pocos KB que el Worker sirve casi instantaneamente.
//
// RELACION CON src/lib/observatorio.ts
// La logica esta duplicada a proposito: aquel modulo vive en el runtime edge y
// este en Node, y no comparten sistema de tipos. buildObservatorio() sigue
// siendo el camino de respaldo si este fichero falta.
// tests/observatorio-precalculo.test.ts compara AMBAS salidas sobre el snapshot
// real y falla si divergen, asi que la duplicacion no puede pudrirse en silencio.
//
// El resultado guarda las provincias por ID, sin slug ni nombre: ese join lo
// hace el Worker con PROVINCIAS, para que la tabla de slugs siga en un solo sitio.

export const OBS_FUEL = {
  g95: 'Precio Gasolina 95 E5',
  diesel: 'Precio Gasoleo A',
}

// Por debajo de estos umbrales el dato no es representativo. Mismos valores que
// src/lib/observatorio.ts.
export const MIN_ESTACIONES_MARCA = 40
const MIN_ESTACIONES_PROVINCIA = 3

export function parsePrecio(v) {
  if (typeof v !== 'string' || !v.trim()) return null
  const n = parseFloat(v.replace(',', '.'))
  return isFinite(n) && n > 0 ? n : null
}

export function median(values) {
  const xs = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  if (!xs.length) return NaN
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

// Los rotulos del Ministerio vienen sucios: mayusculas, minusculas, y muchas
// estaciones independientes usan un numero de registro como rotulo ("Nº 10.935").
// Esos no son marca y ensuciarian el ranking, asi que se descartan.
export function normalizaMarca(raw) {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  if (/^n[ºo°.\s]*[\d.]+$/i.test(s)) return null
  if (/^[\d.\s-]+$/.test(s)) return null
  const up = s.toUpperCase()
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
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function agrega(stations, field) {
  const porProvincia = new Map()
  const porMarca = new Map()
  const todos = []

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

  const provincias = []
  for (const [id, vals] of porProvincia) {
    if (vals.length < MIN_ESTACIONES_PROVINCIA) continue
    provincias.push({ id, precio: median(vals), estaciones: vals.length })
  }
  // El desempate por ID no es cosmetico: buildObservatorio() recorre PROVINCIAS
  // (ordenada por ID) antes de ordenar por precio, asi que dos provincias con la
  // misma mediana quedan alli en orden de ID. Sin este criterio, las dos
  // implementaciones divergirian en los empates y el test de equivalencia
  // fallaria de forma intermitente, solo los dias que hubiera empate.
  provincias.sort((a, b) => a.precio - b.precio || a.id.localeCompare(b.id))

  const marcas = []
  for (const [marca, vals] of porMarca) {
    if (vals.length < MIN_ESTACIONES_MARCA) continue
    marcas.push({ marca, precio: median(vals), estaciones: vals.length })
  }
  marcas.sort((a, b) => a.precio - b.precio)

  return { nacional: todos.length ? median(todos) : null, provincias, marcas }
}

// snap es la respuesta cruda del Ministerio: { Fecha, ListaEESSPrecio: [...] }.
// Devuelve null si no hay estaciones, para no escribir un fichero vacio que
// dejaria la pagina sin datos.
export function construyeObservatorio(snap) {
  const stations = snap?.ListaEESSPrecio
  if (!Array.isArray(stations) || !stations.length) return null
  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    fechaMinisterio: typeof snap.Fecha === 'string' ? snap.Fecha : undefined,
    totalEstaciones: stations.length,
    g95: agrega(stations, OBS_FUEL.g95),
    diesel: agrega(stations, OBS_FUEL.diesel),
  }
}
