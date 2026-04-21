// Extrae el contenido JS de src/html/client/features.ts y lo escribe en
// public/static/features.js para que Cloudflare Pages lo sirva como asset
// estatico con cache largo (Etag + Cache-Control: public, max-age=31536000
// si lo servimos via wrangler/pages.toml). Asi el navegador:
//   - Lo descarga una vez y lo cachea agresivamente.
//   - El SW tambien puede cachearlo para offline (lista STATIC_ASSETS).
//   - No se re-bajan ~55 KB en cada navegacion aunque cambie el HTML.
//
// Uso: se invoca en el prebuild (package.json). Es idempotente — si el
// contenido extraido coincide con el existente no toca el archivo (preserva
// mtime para caches de CDN).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC  = resolve(__dirname, '..', 'src', 'html', 'client', 'features.ts')
const DEST = resolve(__dirname, '..', 'public', 'static', 'features.js')

function extract(ts) {
  // El fichero es: export const clientFeaturesScript = `<JS>`
  // No contiene ${...} (verificado). Extraemos el contenido entre el primer
  // backtick y el ultimo para obtener el JS puro.
  const first = ts.indexOf('`')
  const last  = ts.lastIndexOf('`')
  if (first === -1 || last === -1 || first === last) {
    throw new Error('gen-features-js: no se pudo localizar los backticks en features.ts')
  }
  return ts.slice(first + 1, last)
}

function main() {
  const ts = readFileSync(SRC, 'utf8')
  const js = extract(ts)
  // Cabecera defensiva: aisla el codigo en un bloque e imprime version si
  // falla el parse (ayuda a correlacionar con APP_VER en consola). Wrapper
  // IIFE no es necesario — features.ts ya contiene IIFEs internos.
  const banner = '// Gasolineras Espana — features.js (generado automaticamente, no editar)\n'
                 + '// Fuente: src/html/client/features.ts\n'
                 + '// Este bundle contiene todas las features no-criticas: trend strip, telemetria,\n'
                 + '// ruta optima, diario de repostajes, comparador modal wiring.\n\n'
  const out = banner + js
  const existing = existsSync(DEST) ? readFileSync(DEST, 'utf8') : null
  if (existing === out) {
    // Sin cambios — preserva mtime para que el CDN no invalide el asset.
    return
  }
  writeFileSync(DEST, out, 'utf8')
  const bytes = Buffer.byteLength(out, 'utf8')
  process.stdout.write('gen-features-js: ' + DEST + ' (' + bytes + ' bytes)\n')
}

main()
