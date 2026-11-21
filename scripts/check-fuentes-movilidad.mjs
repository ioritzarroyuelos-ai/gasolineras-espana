// Cada fuente se comprueba por separado. El informe de fallo se publica aunque
// una fuente falle; no transforma una consulta fallida en una actualización.
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compruebaFuentesMovilidad } from './lib/fuentes-movilidad.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(process.env.TRANSPORTE_DIR || resolve(root, 'public/data/transporte'))
const compiled = await build({ stdin: { contents: `export {cargaBicisZaragoza} from './src/lib/bicis-gbfs';export {cargaTraficoSct} from './src/lib/trafico-sct';export {cargaCamarasSct} from './src/lib/camaras-sct';export {cargaMetroBilbao} from './src/lib/metro-bilbao';`, resolveDir: root, loader: 'js' },
  bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })
const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const assets = { fetch: async request => {
  if (new URL(request.url).pathname !== '/data/transporte/metro-bilbao.json') return new Response(null, { status: 404 })
  try { return new Response(await readFile(resolve(dataDir, 'metro-bilbao.json'), 'utf8')) } catch { return new Response(null, { status: 404 }) }
} }
const report = await compruebaFuentesMovilidad({ 'bizi-zaragoza': () => api.cargaBicisZaragoza(), 'trafico-cataluna': () => api.cargaTraficoSct(), 'camaras-cataluna': () => api.cargaCamarasSct(), 'metro-bilbao': () => api.cargaMetroBilbao(assets) })
if (!process.argv.includes('--check')) {
  await mkdir(dataDir, { recursive: true })
  const target = resolve(dataDir, 'fuentes.json'), temporary = target + '.tmp'
  await writeFile(temporary, JSON.stringify(report) + '\n', 'utf8')
  await rename(temporary, target)
}
console.log(JSON.stringify(report))
if (!report.correcto) process.exitCode = 1
