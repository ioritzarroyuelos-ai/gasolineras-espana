// Descarga y verifica (SRI sha384) los JS/CSS/imagenes de las librerias del
// mapa desde unpkg y los deposita en public/static/vendor/map/*. A partir
// de ese momento el HTML los sirve desde nuestro propio dominio:
//   - Adblockers / listas publicas no conocen las rutas locales.
//   - Redes corporativas que bloquean unpkg.com ya no nos afectan.
//   - Si unpkg esta caido la app sigue arrancando igual.
//
// Idempotente: si el archivo ya existe y su sha384 coincide, no lo re-baja ni
// toca mtime (preserva caches de CDN). Al terminar regenera manifest.json con
// la tabla de versiones + hashes — el cron de GitHub Actions
// (.github/workflows/vendor-check.yml) lee ese manifest para saber que pedir
// al registry de npm y avisar por Telegram cuando haya version nueva.
//
// Uso: node scripts/fetch-map-vendor.mjs
// (no va en prebuild — corre solo cuando actualizamos versiones).

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const VENDOR_ROOT = resolve(ROOT, 'public', 'static', 'vendor', 'map')

// Versiones + SRI sha384 esperado — los mismos que usabamos en shell.ts
// cuando cargabamos desde unpkg. Si alguna vez hay que actualizar, se
// actualizan aqui (nueva version + nuevo hash descargado de
// https://www.srihash.org/ o generado localmente y pegado aqui).
const PACKAGES = {
  'leaflet': '1.9.4',
  'leaflet.markercluster': '1.4.1',
  'leaflet.heat': '0.2.0',
  'maplibre-gl': '4.7.1',
  '@maplibre/maplibre-gl-leaflet': '0.0.22',
}

// files: cada entrada es un asset que bajamos. 'sri' puede ser null para
// ficheros sin hash conocido (p.ej. PNGs que no cargabamos con <link integrity>
// — van dentro del CSS y Leaflet los pide en runtime). Verificamos que
// existen y guardamos su sha384 en el manifest igualmente para trazabilidad.
const FILES = [
  // ---- Leaflet core ----
  { pkg: 'leaflet', path: 'leaflet.js',       src: 'dist/leaflet.js',       sri: 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH' },
  { pkg: 'leaflet', path: 'leaflet.css',      src: 'dist/leaflet.css',      sri: 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H' },
  // El CSS referencia url(images/*.png) — mismo path relativo, asi que
  // replicamos la jerarquia dist/images/ aqui y Leaflet las pide en runtime
  // desde /static/vendor/map/leaflet/images/*.png.
  { pkg: 'leaflet', path: 'images/layers.png',        src: 'dist/images/layers.png',        sri: null },
  { pkg: 'leaflet', path: 'images/layers-2x.png',     src: 'dist/images/layers-2x.png',     sri: null },
  { pkg: 'leaflet', path: 'images/marker-icon.png',   src: 'dist/images/marker-icon.png',   sri: null },
  { pkg: 'leaflet', path: 'images/marker-icon-2x.png',src: 'dist/images/marker-icon-2x.png',sri: null },
  { pkg: 'leaflet', path: 'images/marker-shadow.png', src: 'dist/images/marker-shadow.png', sri: null },
  // ---- MarkerCluster ----
  { pkg: 'leaflet.markercluster', path: 'leaflet.markercluster.js', src: 'dist/leaflet.markercluster.js', sri: 'sha384-RLIyj5q1b5XJTn0tqUhucRZe40nFTocRP91R/NkRJHwAe4XxnTV77FXy/vGLiec2' },
  { pkg: 'leaflet.markercluster', path: 'MarkerCluster.css',         src: 'dist/MarkerCluster.css',         sri: 'sha384-lPzjPsFQL6te2x+VxmV6q1DpRxpRk0tmnl2cpwAO5y04ESyc752tnEWPKDfl1olr' },
  { pkg: 'leaflet.markercluster', path: 'MarkerCluster.Default.css', src: 'dist/MarkerCluster.Default.css', sri: 'sha384-5kMSQJ6S4Qj5i09mtMNrWpSi8iXw230pKU76xTmrpezGnNJQzj0NzXjQLLg+jE7k' },
  // ---- leaflet.heat ----
  { pkg: 'leaflet.heat', path: 'leaflet-heat.js', src: 'dist/leaflet-heat.js', sri: 'sha384-mFKkGiGvT5vo1fEyGCD3hshDdKmW3wzXW/x+fWriYJArD0R3gawT6lMvLboM22c0' },
  // ---- MapLibre GL ----
  { pkg: 'maplibre-gl', path: 'maplibre-gl.js',  src: 'dist/maplibre-gl.js',  sri: 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj' },
  { pkg: 'maplibre-gl', path: 'maplibre-gl.css', src: 'dist/maplibre-gl.css', sri: 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V' },
  // ---- MapLibre GL Leaflet bridge ----
  { pkg: '@maplibre/maplibre-gl-leaflet', path: 'leaflet-maplibre-gl.js', src: 'leaflet-maplibre-gl.js', sri: 'sha384-4CB9Vtol9LN6lGgBCvmPLbUEZwilrqIvPieSRurgAXAB7FVJaLS9n8WyAIA5wjQ+' },
]

// Convierte '@maplibre/maplibre-gl-leaflet' -> 'maplibre-gl-leaflet' para el
// path local. Para packages sin scope usa el nombre tal cual.
function localDir(pkg) {
  if (pkg.startsWith('@')) return pkg.split('/')[1]
  return pkg
}

function sha384Base64(buf) {
  return createHash('sha384').update(buf).digest('base64')
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

async function fetchAsset(pkg, version, src) {
  const url = 'https://unpkg.com/' + pkg + '@' + version + '/' + src
  const res = await fetch(url)
  if (!res.ok) throw new Error('fetch ' + url + ' -> ' + res.status)
  const buf = Buffer.from(await res.arrayBuffer())
  return { buf, url }
}

function existingSriMatches(path, expectedSri) {
  if (!existingFileSync(path)) return null
  const buf = readFileSync(path)
  const sri = 'sha384-' + sha384Base64(buf)
  if (expectedSri && sri !== expectedSri) return { match: false, actualSri: sri }
  return { match: true, actualSri: sri }
}

function existingFileSync(p) {
  try { return statSync(p).isFile() } catch { return false }
}

async function main() {
  ensureDir(VENDOR_ROOT)
  const manifest = { packages: PACKAGES, files: {}, updated_at: new Date().toISOString() }
  let downloaded = 0
  let reused = 0
  for (const f of FILES) {
    const version = PACKAGES[f.pkg]
    if (!version) throw new Error('fetch-map-vendor: paquete sin version: ' + f.pkg)
    const destRel = join(localDir(f.pkg), f.path)
    const destAbs = join(VENDOR_ROOT, destRel)
    ensureDir(dirname(destAbs))

    // Si existe y sha384 coincide con expected, skip.
    const existing = existingSriMatches(destAbs, f.sri)
    if (existing && existing.match && f.sri) {
      manifest.files[destRel.replace(/\\/g, '/')] = existing.actualSri
      reused++
      continue
    }

    const { buf, url } = await fetchAsset(f.pkg, version, f.src)
    const actualSri = 'sha384-' + sha384Base64(buf)
    if (f.sri && actualSri !== f.sri) {
      throw new Error(
        'SRI mismatch para ' + url + '\n' +
        '  esperado: ' + f.sri + '\n' +
        '  recibido: ' + actualSri + '\n' +
        '  (si cambiaste de version, actualiza el hash en FILES[])'
      )
    }
    writeFileSync(destAbs, buf)
    manifest.files[destRel.replace(/\\/g, '/')] = actualSri
    downloaded++
    process.stdout.write('fetch-map-vendor: ' + destRel + ' (' + buf.length + ' bytes)\n')
  }

  // Reescribe manifest.json ordenado para que el diff en git sea estable.
  const sortedFiles = Object.keys(manifest.files).sort().reduce((acc, k) => {
    acc[k] = manifest.files[k]
    return acc
  }, {})
  const out = JSON.stringify({
    packages: manifest.packages,
    files: sortedFiles,
    updated_at: manifest.updated_at,
  }, null, 2) + '\n'
  writeFileSync(join(VENDOR_ROOT, 'manifest.json'), out, 'utf8')

  process.stdout.write('fetch-map-vendor: ' + downloaded + ' descargados, ' + reused + ' reusados, manifest OK\n')
}

main().catch(err => {
  process.stderr.write('fetch-map-vendor FAILED: ' + err.message + '\n')
  process.exit(1)
})
