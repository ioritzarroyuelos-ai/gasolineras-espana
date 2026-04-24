#!/usr/bin/env node
// v1.10 — Descarga las farmacias de guardia de la Comunidad de Madrid desde
// la API del COFM (Colegio Oficial de Farmaceuticos de Madrid).
//
// Fuente:
//   https://www.cofm.es/rest/farmacias/es?direccion=
//   Es una API REST interna que la web del COFM usa para su widget de
//   buscador de farmacias. Devuelve un array con ~2950 farmacias de toda
//   la Comunidad. Cada entrada trae el flag boolean `guardia` que indica
//   si esta de guardia HOY, ademas de horarioGuardia y horarioGuardiaDesc
//   cuando aplica.
//
//   El endpoint no exige autenticacion, no tiene rate limit visible y
//   respeta User-Agent educado. El payload pesa ~1MB raw / ~150KB gzip.
//
// Schema del output:
//   public/data/guardias-madrid.json con formato compacto array-of-arrays:
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]
//
//   ~160 farmacias por dia, ~12KB gzip. El cron semanal lo actualiza
//   cada lunes — aunque el COFM actualiza el flag guardia diariamente,
//   refrescar una vez por semana es suficiente para el caso de uso:
//   "las de guardia de esta semana" (usuario espanol tipico hace mapa
//   mental semanal, no diario). Si hace falta frequencia diaria se
//   cambia el cron sin tocar el scraper.
//
// Umbral defensivo:
//   - Si el array total tiene < 1000 farmacias (Madrid suele tener ~2950)
//     algo ha cambiado en la API — exit 1 sin sobrescribir.
//   - Si el subset con guardia=true esta vacio o > 500 (irrealista para
//     un dia normal — max teorico ~200) tambien paramos.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA_DIR = resolve(ROOT, 'public', 'data')
const OUT_FILE = resolve(DATA_DIR, 'guardias-madrid.json')

const COFM_URL = 'https://www.cofm.es/rest/farmacias/es?direccion='
const USER_AGENT = 'cercaya-guardias/1.10 (+https://webapp-3ft.pages.dev)'

async function fetchCOFM(attempts = 5) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`  intento ${i}/${attempts}`)
      const res = await fetch(COFM_URL, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': USER_AGENT,
          'Accept-Language': 'es-ES,es;q=0.9',
        },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.json()
      if (!Array.isArray(data)) {
        throw new Error('Respuesta COFM no es un array')
      }
      return data
    } catch (e) {
      lastErr = e
      console.error(`    fallo: ${e.message}`)
      if (i < attempts) await new Promise(r => setTimeout(r, i * 5000))
    }
  }
  throw lastErr
}

// La API devuelve coords como string ("40.42732577"). Las parseamos a
// numero y las redondeamos a 5 decimales (~1m precision).
function parseCoord(raw) {
  if (raw == null) return NaN
  const n = parseFloat(String(raw).replace(',', '.'))
  return isFinite(n) ? Math.round(n * 1e5) / 1e5 : NaN
}

async function main() {
  console.log('Descargando farmacias de Madrid del COFM...')
  const all = await fetchCOFM()
  console.log(`  ${all.length} farmacias recibidas de COFM`)

  if (all.length < 1000) {
    throw new Error(`Respuesta sospechosa: solo ${all.length} farmacias (Madrid suele tener ~2950). NO sobrescribimos guardias-madrid.json.`)
  }

  const guardias = []
  let skipped = 0
  for (const f of all) {
    if (!f || !f.guardia) { skipped++; continue }

    const lat = parseCoord(f.latitud)
    const lng = parseCoord(f.longitud)
    if (!isFinite(lat) || !isFinite(lng)) { skipped++; continue }
    // Bounding box generosa de la Comunidad de Madrid (grados aprox).
    // No es estricto para el borde — solo para descartar coords corruptas
    // tipo 0,0 o transposiciones lat/lng.
    if (lat < 39.8 || lat > 41.2 || lng < -4.7 || lng > -3.0) {
      skipped++; continue
    }

    const direccion = String(f.direccion || '').trim().slice(0, 120)
    const poblacion = String(f.poblacion || '').trim().slice(0, 60)
    const telefono = String(f.telefono || '').trim().slice(0, 30)
    const cp = String(f.codigoPostal || '').trim().slice(0, 10)
    const horarioGuardia = String(f.horarioGuardia || '').trim().slice(0, 80)
    const horarioGuardiaDesc = String(f.horarioGuardiaDesc || '').trim().slice(0, 120)

    guardias.push([lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc])
  }

  console.log(`  ${guardias.length} farmacias de guardia (${skipped} sin guardia o sin coords validas)`)

  if (guardias.length === 0) {
    throw new Error('Cero farmacias de guardia. Esto no es normal — el COFM siempre tiene algunas abiertas 24h. Abortamos sin sobrescribir.')
  }
  if (guardias.length > 500) {
    throw new Error(`Sospechoso: ${guardias.length} farmacias marcadas como guardia. Max razonable ~300. Abortamos sin sobrescribir.`)
  }

  const out = {
    ts: new Date().toISOString(),
    source: 'cofm.es',
    territorio: 'madrid',
    count: guardias.length,
    // Schema documentado para que el frontend no adivine orden.
    schema: ['lat', 'lng', 'direccion', 'poblacion', 'telefono', 'cp', 'horarioGuardia', 'horarioGuardiaDesc'],
    guardias,
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_FILE, JSON.stringify(out))
  console.log(`OK — ${guardias.length} guardias guardadas en ${OUT_FILE}`)
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
