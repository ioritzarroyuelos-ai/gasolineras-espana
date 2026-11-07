import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { RUTAS_CON_VEDA } from './scripts/lib/politica-catalogo.mjs'

// Pages da prioridad a exclude. Una exclusión general /data/* también
// excluiría las elecciones cuyo JSON debe comprobar la veda en cada petición.
function exclusionesEstaticas(directorio: string, prefijo = ''): string[] {
  const exclusiones = new Set<string>()
  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    const ruta = prefijo + '/' + entrada.name
    if (RUTAS_CON_VEDA.some(e => e.datos === ruta)) continue
    if (entrada.isDirectory() && RUTAS_CON_VEDA.some(e => e.datos.startsWith(ruta + '/'))) {
      for (const hija of exclusionesEstaticas(join(directorio, entrada.name), ruta)) exclusiones.add(hija)
    } else if (prefijo === '/data' && entrada.name.startsWith('guardias-')) {
      exclusiones.add('/data/guardias-*')
    } else {
      exclusiones.add(entrada.isDirectory() ? ruta + '/*' : ruta)
    }
  }
  return [...exclusiones].sort()
}

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  plugins: [
    build(),
    {
      name: 'rutas-de-sondeos-con-veda',
      apply: 'build',
      generateBundle() {
        // El código de deportes precede a su primera publicación automática de datos.
        const exclude = [...new Set([...exclusionesEstaticas('public'), '/data/deportes/*'])].sort()
        this.emitFile({
          type: 'asset', fileName: '_routes.json',
          source: JSON.stringify({ version: 1, include: ['/*'], exclude }),
        })
      },
    },
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ]
})
