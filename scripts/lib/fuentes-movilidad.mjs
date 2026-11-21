const labels = { 'bizi-zaragoza': 'Bizi Zaragoza', 'trafico-cataluna': 'Tráfico SCT', 'camaras-cataluna': 'Cámaras SCT', 'metro-bilbao': 'Metro Bilbao' }
export async function compruebaFuentesMovilidad(loaders, now = Date.now()) {
  const started = Date.now()
  const checkedNow = () => new Date(now + Math.max(0, Date.now() - started)).toISOString()
  const fuentes = await Promise.all(Object.entries(labels).map(async ([id, nombre]) => {
    try {
      const data = await loaders[id]()
      const consultado = checkedNow()
      const estado = ['actual', 'parcial', 'sin_actualizar'].includes(data.estado) ? data.estado : 'error'
      const rawDate = id === 'camaras-cataluna' ? data.fechaDirectorio : data.fechaDatos
      const stamp = Date.parse(rawDate)
      if (!Number.isFinite(stamp) || stamp > Date.parse(consultado) || !Number.isInteger(data.total) || data.total < 0 || data.total > 2000) throw Error('No comprobable')
      return { id, nombre, consultado, fechaDatos: rawDate, estado, total: data.total,
        ...(estado === 'actual' ? {} : { error: estado === 'parcial' ? 'Parte de los datos no se ha podido comprobar.' : 'La fuente no ofrece datos vigentes comprobables.' }) }
    } catch {
      return { id, nombre, consultado: checkedNow(), fechaDatos: null, estado: 'error', total: null, error: 'No se pudo comprobar la fuente oficial.' }
    }
  }))
  return { schema: 1, consultado: checkedNow(), correcto: fuentes.every(f => f.estado === 'actual'), fuentes }
}
