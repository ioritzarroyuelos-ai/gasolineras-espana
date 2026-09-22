// Empaqueta el JS de cliente (B2). Concatena src/client/{core,map,list,ui,features}.js
// en un unico bloque y lo escribe en public/static/app.js, que shell.ts sirve como
// <script defer src="/static/app.js?v=APP_VERSION"> (mismo origen -> CSP 'self').
//
// Orden CRITICO: core -> map -> list -> ui -> features. Muchas funciones se declaran
// en un modulo y se consumen desde otro (globales del script clasico); mantener el
// orden preserva las referencias hoisted. features va AL FINAL (antes iba como
// fichero defer aparte; ahora entra en el mismo bundle: mismas globales, mismo scope).
//
// PRIMER PASE B2: concatenacion PURA (sin IIFE ni minify) = byte-semanticamente
// identico a lo que getClientScript inyectaba inline. La minificacion es un
// follow-up trivial una vez verificado en preview.
//
// APP_VER: se inyecta como var global (igual que antes) leyendo APP_VERSION de
// src/lib/version.ts. Uso: prebuild (package.json) y el script `dev`.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SRC = resolve(ROOT, 'src', 'client')
const DEST_DIR = resolve(ROOT, 'public', 'static')
const DEST = resolve(DEST_DIR, 'app.js')

// APP_VERSION desde version.ts (misma fuente que /api/health y gen-sw).
const versionTs = readFileSync(resolve(ROOT, 'src', 'lib', 'version.ts'), 'utf8')
const vm = versionTs.match(/APP_VERSION\s*=\s*'([^']+)'/)
if (!vm) throw new Error('gen-client-bundle: no se pudo leer APP_VERSION de version.ts')
const APP_VERSION = vm[1]

// BRAND para el console.info (mismo texto que el orquestador viejo).
const brandTs = readFileSync(resolve(ROOT, 'src', 'lib', 'brand.ts'), 'utf8')
const bm = brandTs.match(/BRAND\s*=\s*'([^']+)'/)
const BRAND = bm ? bm[1] : 'CercaYa'

const ORDER = ['core.js', 'map.js', 'list.js', 'ui.js', 'features.js']
const parts = ORDER.map(f => {
  const p = resolve(SRC, f)
  if (!existsSync(p)) throw new Error('gen-client-bundle: falta ' + p)
  return readFileSync(p, 'utf8')
})

const prelude = 'var APP_VER = ' + JSON.stringify(APP_VERSION) + ';\n'
const footer = "\n// ---- VERSION visible en consola ----\n" +
  "try { console.info('%c" + BRAND + " v' + APP_VER, 'color:#16a34a;font-weight:bold'); } catch(_) {}\n"
const raw = prelude + parts.join('\n') + footer
// B2 fase B: minificar con esbuild en modo SCRIPT (sin format:iife, sin bundle) →
// preserva las funciones/globales top-level por nombre (se referencian entre módulos
// y no hay onclick inline). target es2019 ⊇ ES2018 (object-spread + async/await del
// código) → NO transpila, solo minifica. Verificado: ~306 KB → ~130 KB, mantiene el
// prelude `var APP_VER` y el console.info. legalComments:none (bundle 100% propio).
const out = esbuild.transformSync(raw, {
  loader: 'js',
  minify: true,
  target: 'es2019',
  legalComments: 'none',
}).code

mkdirSync(DEST_DIR, { recursive: true })
const existing = existsSync(DEST) ? readFileSync(DEST, 'utf8') : null
if (existing === out) {
  process.stdout.write('gen-client-bundle: sin cambios\n')
} else {
  writeFileSync(DEST, out, 'utf8')
  process.stdout.write('gen-client-bundle: ' + DEST + ' (' + Buffer.byteLength(out, 'utf8') + ' bytes, v' + APP_VERSION + ')\n')
}
