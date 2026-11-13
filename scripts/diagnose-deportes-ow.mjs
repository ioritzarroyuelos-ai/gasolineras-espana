import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { FUENTES_DIAGNOSTICO_OW, diagnosticaFuenteOW } from './lib/deportes-ow-diagnostico.mjs'

let grupoFbcyl
try {
  const estado = JSON.parse(readFileSync(new URL('../public/data/deportes/fuentes/novanet-basket-fbcyl.json', import.meta.url), 'utf8'))
  grupoFbcyl = estado.catalogo?.categorias[estado.categoria]?.grupos?.[estado.grupo]?.codigo
} catch { /* La página inicial sigue siendo comprobable aunque falte el cursor. */ }
const resultados = []
for (const fuente of FUENTES_DIAGNOSTICO_OW) {
  const resultado = await diagnosticaFuenteOW(fuente.id, { grupoFbcyl })
  resultados.push(resultado)
  console.log(JSON.stringify(resultado))
  // Las ocho webs usan un proveedor común: también espaciamos los portales.
  await new Promise(resolve => setTimeout(resolve, 1000))
}
mkdirSync('.tmp', { recursive: true })
writeFileSync('.tmp/deportes-ow-diagnostico.json', JSON.stringify({ comprobadoEn: new Date().toISOString(), node: process.version, plataforma: process.platform, resultados }, null, 2))
if (resultados.some(r => !r.correcto)) process.exitCode = 1
