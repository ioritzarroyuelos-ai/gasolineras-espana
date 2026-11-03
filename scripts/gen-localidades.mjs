// Índices derivados durante el build; nunca cambia la fecha de los datos originales.
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
await build({ entryPoints: [resolve(root, 'src/client/municipio.js')], outfile: resolve(root, 'public/static/municipio.js'), minify: true, target: 'es2020' })
const compiled = await build({ entryPoints: [resolve(root, 'src/lib/localidades.ts')], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22' })
const { construyeLocalidades } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const dir = resolve(root, 'public/data')
const read = file => JSON.parse(readFileSync(resolve(dir, file), 'utf8'))
const guardias = Object.fromEntries(readdirSync(dir).filter(f => /^guardias-[a-z]+\.json$/.test(f)).map(f => [f.slice(9, -5), read(f)]))
const predicciones = Object.assign({}, ...readdirSync(resolve(dir, 'tiempo/snapshot')).filter(f => f.endsWith('.json')).map(f => read('tiempo/snapshot/' + f).predicciones))
const all = construyeLocalidades(read('tiempo/municipios.json').municipios, read('stations.json').ListaEESSPrecio, read('snapshot-meta.json').fetchedAt, guardias, read('itv.json'), predicciones)
mkdirSync(resolve(dir, 'localidades'), { recursive: true })
writeFileSync(resolve(dir, 'localidades-index.json'), JSON.stringify(all.map(({ ine, nombre, provinciaNombre }) => ({ ine, nombre, provinciaNombre }))))
for (const prov of new Set(all.map(m => m.ine.slice(0, 2)))) writeFileSync(resolve(dir, 'localidades', prov + '.json'), JSON.stringify(all.filter(m => m.ine.startsWith(prov))))
console.log(`Municipios: ${all.length}; resultados repartidos por provincia`)
