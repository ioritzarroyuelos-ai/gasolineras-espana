// Historico estatico de precios: anadir un dia a los ficheros de public/data/history.
//
// POR QUE EXISTE ESTE FICHERO
// Las graficas del popup, la portada y el observatorio necesitan la serie diaria
// de precios. Servirla desde D1 costaba millones de filas leidas al dia (el plan
// gratuito corta a 5 millones) y el 3 de septiembre de 2026 dejo la base de
// datos sin cupo y bloqueo los despliegues. Los ficheros de public/data/history/
// ya existian (un ano generado en abril de 2026 por backfill-static-history.mjs)
// y el Worker ya los prefiere a D1, pidiendo a la base de datos solo los dias
// posteriores a `to`. El problema era que nadie los actualizaba desde el 25 de
// abril. Este modulo es el "anadir hoy" que faltaba: lo ejecuta
// scripts/actualiza-historico-estatico.mjs desde el bot de GitHub Actions, justo
// despues de bajar la foto de precios. Con `to` = hoy, D1 no recibe lecturas.
//
// Es JS puro sin node:fs a proposito: asi tests/historico-estatico.test.ts lo
// puede ejecutar contra src/lib/history.ts (hydrateDedupe, snapshotToRows) y
// exigir que ambos lados cuenten la misma historia.
//
// FORMATOS (los mismos que escribe backfill-static-history.mjs y lee src/index.tsx;
// si cambia uno, cambia el otro):
//   history/{prov}.json         stations[id][fuel] = [[fecha, cents], ...]   solo cambios de precio
//   history/median/{prov}.json  median[fuel]       = [[fecha, cents], ...]   un punto por dia
//   history/national.json       series[fuel]       = [[fecha, media_cents, n], ...]  un punto por dia
//
// REGLAS
// - Nunca se borra nada: `from` no avanza y ningun punto antiguo se descarta
//   (decision del 4 de septiembre de 2026). Los ficheros crecen ~6 MB/ano en
//   Madrid; Cloudflare Pages no admite ficheros de mas de 25 MiB, asi que hacia
//   2029 habra que partirlos por anos.
// - Un mismo dia puede aplicarse varias veces (foto de la manana y de la tarde):
//   la segunda sustituye a la primera, igual que INSERT OR REPLACE en D1.
// - No se admite un dia anterior al ultimo guardado: recortaria lo posterior.
// - Serie por estacion: solo cambios. hydrateDedupe() en el Worker propaga el
//   ultimo precio conocido hasta `to`, asi que no hace falta el "marcador final"
//   que anadia dedupeConsecutive(); si lo encuentra, lo retira.
// - Mediana provincial: valor en la posicion floor(n/2) de la lista ordenada,
//   igual que el camino D1 de /api/history/province/:id y que buildMedianFile().
// - Media nacional: media aritmetica de los centimos sobre las mismas filas que
//   genera snapshotToRows() (IDEESS valido y precio parseable, con o sin
//   provincia), igual que AVG(price_cents) en D1.

export const FUEL_MAP = {
  'Precio Gasolina 95 E5':  '95',
  'Precio Gasolina 98 E5':  '98',
  'Precio Gasoleo A':       'diesel',
  'Precio Gasoleo Premium': 'diesel_plus',
}
export const FUEL_CODES = Object.values(FUEL_MAP)

// Mismo parseo que src/lib/history.ts: coma o punto decimal, rango (0, 10].
export function parsePriceString(raw) {
  if (!raw) return null
  const s = String(raw).trim().replace(',', '.')
  if (!s) return null
  const n = parseFloat(s)
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null
  return n
}

export function eurosToCents(euros) {
  return Math.round(euros * 1000)
}

const RE_ID = /^\d{1,10}$/
const RE_PROV = /^\d{1,2}$/
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

// Filas validas del snapshot del Ministerio. Mismo filtro que snapshotToRows()
// para que la media nacional coincida con la que D1 calculaba sobre sus filas.
// `provincia` puede ser null: la fila cuenta para la media nacional pero no
// entra en ningun fichero provincial.
export function filasSnapshot(snapshot) {
  const list = snapshot && typeof snapshot === 'object' ? snapshot.ListaEESSPrecio : null
  if (!Array.isArray(list)) return []
  const out = []
  for (const s of list) {
    if (!s || typeof s !== 'object') continue
    const id = s['IDEESS']
    if (!id || !RE_ID.test(String(id))) continue
    const provRaw = s['IDProvincia']
    const provincia = provRaw != null && RE_PROV.test(String(provRaw)) ? String(provRaw).padStart(2, '0') : null
    for (const key of Object.keys(FUEL_MAP)) {
      const precio = parsePriceString(s[key])
      if (precio == null) continue
      out.push({ station_id: String(id), provincia, fuel_code: FUEL_MAP[key], cents: eurosToCents(precio) })
    }
  }
  return out
}

// Anade o sustituye el punto de `fecha` en una serie dedupeada [[fecha, cents]].
// No muta la serie de entrada.
export function anadePunto(serie, fecha, cents) {
  const out = serie.slice()
  // Re-ejecucion del mismo dia: fuera el punto anterior de hoy.
  while (out.length && out[out.length - 1][0] >= fecha) out.pop()
  // Marcador final heredado de dedupeConsecutive() (ultimo punto igual al
  // penultimo): ya no hace falta y dejaria un punto sin cambio en medio.
  if (out.length >= 2 && out[out.length - 1][1] === out[out.length - 2][1]) out.pop()
  if (!out.length || out[out.length - 1][1] !== cents) out.push([fecha, cents])
  return out
}

// Mediana "inferior": elemento central por indice, no media de los dos
// centrales. Es lo que hace el endpoint provincial sobre D1, y aqui se copia
// para que la grafica no de un salto el dia que la fuente cambia de D1 a fichero.
export function medianaInferior(valores) {
  if (!valores.length) return null
  const xs = valores.slice().sort((a, b) => a - b)
  return xs[Math.floor(xs.length / 2)]
}

function diasEntre(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1
}

function compruebaFecha(fichero, fecha, nombre) {
  if (!RE_FECHA.test(fecha)) throw new Error(nombre + ': fecha invalida "' + fecha + '"')
  if (fichero && fecha < fichero.to) {
    throw new Error(nombre + ': ' + fecha + ' es anterior al ultimo dia guardado (' + fichero.to + '); no se recorta el historico')
  }
}

// Cabecera comun. `from` es el del fichero existente: nunca avanza.
function cabecera(fichero, fecha, ahora) {
  const from = fichero ? fichero.from : fecha
  return { from, to: fecha, days: diasEntre(from, fecha), generated_at: ahora.toISOString() }
}

export function anadeDiaProvincia(fichero, provKey, filas, fecha, ahora = new Date()) {
  compruebaFecha(fichero, fecha, 'history/' + provKey + '.json')
  const stations = {}
  if (fichero) {
    for (const id of Object.keys(fichero.stations)) stations[id] = { ...fichero.stations[id] }
  }
  for (const f of filas) {
    let st = stations[f.station_id]
    if (!st) { st = {}; stations[f.station_id] = st }
    st[f.fuel_code] = anadePunto(st[f.fuel_code] || [], fecha, f.cents)
  }
  return { v: 1, provincia_id: provKey, ...cabecera(fichero, fecha, ahora), stations }
}

export function anadeDiaMediana(fichero, provKey, filas, fecha, ahora = new Date()) {
  compruebaFecha(fichero, fecha, 'history/median/' + provKey + '.json')
  const porFuel = new Map()
  for (const f of filas) {
    let arr = porFuel.get(f.fuel_code)
    if (!arr) { arr = []; porFuel.set(f.fuel_code, arr) }
    arr.push(f.cents)
  }
  const median = {}
  if (fichero) for (const fuel of Object.keys(fichero.median)) median[fuel] = fichero.median[fuel]
  for (const fuel of FUEL_CODES) {
    const vals = porFuel.get(fuel)
    if (!vals || !vals.length) continue
    const serie = (median[fuel] || []).filter(p => p[0] < fecha)
    serie.push([fecha, medianaInferior(vals)])
    median[fuel] = serie
  }
  return { v: 1, provincia_id: provKey, ...cabecera(fichero, fecha, ahora), median }
}

export function anadeDiaNacional(fichero, filas, fecha, ahora = new Date()) {
  compruebaFecha(fichero, fecha, 'history/national.json')
  const acc = new Map()
  for (const f of filas) {
    let a = acc.get(f.fuel_code)
    if (!a) { a = { sum: 0, n: 0 }; acc.set(f.fuel_code, a) }
    a.sum += f.cents
    a.n += 1
  }
  const series = {}
  if (fichero) for (const fuel of Object.keys(fichero.series)) series[fuel] = fichero.series[fuel]
  for (const fuel of FUEL_CODES) {
    const a = acc.get(fuel)
    if (!a || !a.n) continue
    const serie = (series[fuel] || []).filter(p => p[0] < fecha)
    // Tres decimales de centimo: AVG() en D1 devuelve un flotante; con esto la
    // diferencia queda por debajo de lo que computeNationalStats() redondea.
    serie.push([fecha, Math.round((a.sum / a.n) * 1000) / 1000, a.n])
    series[fuel] = serie
  }
  return { v: 1, ...cabecera(fichero, fecha, ahora), series }
}

// Aplica la foto de un dia a todo el estado en memoria.
//   estado = { provincias: Map<prov, fichero>, medianas: Map<prov, fichero>, nacional: fichero | null }
// Devuelve un estado nuevo (no muta) y un resumen para el log. Las provincias
// sin ninguna estacion en la foto se dejan como estaban: su `to` no avanza y el
// Worker pedira ese dia a D1, que es la degradacion honesta.
export function aplicaSnapshot(estado, snapshot, fecha, ahora = new Date()) {
  const filas = filasSnapshot(snapshot)
  if (!filas.length) throw new Error('la foto de ' + fecha + ' no trae ningun precio valido')
  const porProv = new Map()
  for (const f of filas) {
    if (!f.provincia) continue
    let arr = porProv.get(f.provincia)
    if (!arr) { arr = []; porProv.set(f.provincia, arr) }
    arr.push(f)
  }
  const provincias = new Map(estado.provincias)
  const medianas = new Map(estado.medianas)
  for (const [prov, fs] of porProv) {
    provincias.set(prov, anadeDiaProvincia(estado.provincias.get(prov) || null, prov, fs, fecha, ahora))
    medianas.set(prov, anadeDiaMediana(estado.medianas.get(prov) || null, prov, fs, fecha, ahora))
  }
  const nacional = anadeDiaNacional(estado.nacional || null, filas, fecha, ahora)
  return {
    estado: { provincias, medianas, nacional },
    resumen: { fecha, filas: filas.length, provincias: porProv.size },
  }
}

// history/index.json: solo informativo (el Worker no lo lee). `to` es el menor
// de todas las provincias, para que un vistazo diga hasta cuando esta TODO.
export function construyeIndex(estado, ahora = new Date()) {
  const provinces = Array.from(estado.provincias.keys()).sort()
  let from = null
  let to = null
  for (const p of provinces) {
    const f = estado.provincias.get(p)
    if (from == null || f.from < from) from = f.from
    if (to == null || f.to < to) to = f.to
  }
  return {
    v: 1,
    from,
    to,
    days: from && to ? diasEntre(from, to) : 0,
    generated_at: ahora.toISOString(),
    provinces,
    nacional: estado.nacional ? { from: estado.nacional.from, to: estado.nacional.to } : null,
  }
}
