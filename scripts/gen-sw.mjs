// Genera public/sw.js a partir de public/sw.js.tpl substituyendo __BUILD_ID__
// por un identificador unico por build: APP_VERSION + short SHA de git. Si
// no estamos en un repo git (CI con tarball, Cloudflare Pages en algunos
// casos), cae a APP_VERSION + epoch-ms como fallback.
//
// Motivo: antes CACHE_NAME era 'gasolineras-vXX' hardcoded y habia que
// subirlo a mano en cada release. Si se olvidaba, los clientes seguian
// sirviendo HTML/JS viejos desde la cache hasta borrar cookies. Ahora el
// build id cambia en cada commit -> el listener 'activate' purga la cache
// vieja automaticamente y el usuario recibe la pagina fresca en el
// proximo navigate sin intervencion.
//
// Uso: prebuild en package.json (corre antes de vite build). Idempotente:
// si el contenido generado coincide con el existente no toca el archivo
// (preserva mtime).

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const TPL  = resolve(ROOT, 'scripts', 'sw.js.tpl')
const DEST = resolve(ROOT, 'public', 'sw.js')
const VERSION_TS = resolve(ROOT, 'src', 'lib', 'version.ts')

function readAppVersion() {
  const src = readFileSync(VERSION_TS, 'utf8')
  const m = src.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)
  if (!m) throw new Error('gen-sw: no se encontro APP_VERSION en ' + VERSION_TS)
  return m[1]
}

function readShortSha() {
  try {
    const sha = execSync('git rev-parse --short=8 HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
    if (!/^[0-9a-f]{7,}$/.test(sha)) throw new Error('sha invalido: ' + sha)
    // Si hay cambios locales sin commitear anadimos sufijo '-dirty' para que
    // dos builds sobre el mismo HEAD pero con ediciones distintas tambien
    // generen CACHE_NAME distinto (evita "funcionaba en mi maquina" con SW
    // pegado de un preview anterior).
    try {
      const dirty = execSync('git status --porcelain', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim()
      if (dirty) return sha + '-dirty'
    } catch (_) { /* ignoramos */ }
    return sha
  } catch (_) {
    // Fallback: sin git (CI con tarball, etc.) — usamos epoch-ms para que
    // siga siendo unico por build.
    return 't' + Date.now()
  }
}

// Lee un fichero si existe; devuelve null si no. Hacemos la comprobacion de
// existencia con try/catch en vez de existsSync+readFileSync para evitar la
// race condition TOCTOU (el fichero puede desaparecer entre comprobar y leer).
function tryRead(path) {
  try { return readFileSync(path, 'utf8') }
  catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
}

function main() {
  const tpl = tryRead(TPL)
  if (tpl === null) throw new Error('gen-sw: no existe ' + TPL)
  if (tpl.indexOf('__BUILD_ID__') === -1) {
    throw new Error('gen-sw: la plantilla no contiene __BUILD_ID__; algo se ha cambiado mal')
  }
  const version = readAppVersion()
  const sha = readShortSha()
  const buildId = version + '-' + sha
  const out = tpl.replaceAll('__BUILD_ID__', buildId)

  const existing = tryRead(DEST)
  if (existing === out) {
    // Sin cambios — preserva mtime.
    return
  }
  writeFileSync(DEST, out, 'utf8')
  process.stdout.write('gen-sw: ' + DEST + ' (CACHE_NAME=gasolineras-' + buildId + ')\n')
}

main()
