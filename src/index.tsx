import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'

import { renderAppHtml } from './server/html'
import {
  getFuelCatalog,
  getMunicipalities,
  getProvinces,
  getStationsByProvince,
  reverseGeocode
} from './server/ministry'

const app = new Hono()

app.use('/static/*', serveStatic({ root: './', manifest: {} }))
app.use('/api/*', async (c, next) => {
  const startedAt = performance.now()
  await next()
  c.header('Server-Timing', `app;dur=${(performance.now() - startedAt).toFixed(1)}`)
})

app.get('/api/health', (c) => {
  return c.json({
    ok: true,
    now: new Date().toISOString()
  })
})

app.get('/api/config', (c) => {
  return c.json({
    fuels: getFuelCatalog()
  })
})

app.get('/api/provincias', async (c) => {
  try {
    const result = await getProvinces(c)
    c.header('X-Cache-Status', result.cacheStatus)
    return c.json({ items: result.data })
  } catch (error) {
    console.error('[api/provincias]', error)
    return c.json({ error: 'No se pudieron cargar las provincias.' }, 502)
  }
})

app.get('/api/municipios/:provinceId', async (c) => {
  const provinceId = c.req.param('provinceId')

  if (!provinceId) {
    return c.json({ error: 'Falta el identificador de provincia.' }, 400)
  }

  try {
    const result = await getMunicipalities(c, provinceId)
    c.header('X-Cache-Status', result.cacheStatus)
    return c.json({ items: result.data, provinceId })
  } catch (error) {
    console.error('[api/municipios]', error)
    return c.json({ error: 'No se pudieron cargar los municipios.' }, 502)
  }
})

app.get('/api/estaciones/:provinceId', async (c) => {
  const provinceId = c.req.param('provinceId')

  if (!provinceId) {
    return c.json({ error: 'Falta el identificador de provincia.' }, 400)
  }

  try {
    const result = await getStationsByProvince(c, provinceId)
    c.header('X-Cache-Status', result.cacheStatus)
    return c.json(result.data)
  } catch (error) {
    console.error('[api/estaciones]', error)
    return c.json({ error: 'No se pudieron cargar las estaciones.' }, 502)
  }
})

app.get('/api/reverse-geocode', async (c) => {
  const lat = Number.parseFloat(c.req.query('lat') || '')
  const lng = Number.parseFloat(c.req.query('lng') || '')

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'Coordenadas inválidas.' }, 400)
  }

  try {
    const result = await reverseGeocode(c, lat, lng)
    c.header('X-Cache-Status', result.cacheStatus)
    return c.json(result.data)
  } catch (error) {
    console.error('[api/reverse-geocode]', error)
    return c.json({ error: 'No se pudo resolver la ubicación.' }, 502)
  }
})

app.get('/', (c) => {
  return c.html(renderAppHtml())
})

export default app
