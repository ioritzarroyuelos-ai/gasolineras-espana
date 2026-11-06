import { coordenadas, desplazaFecha, texto } from './guardias-fetch.mjs'

export function parseOurense(data, fecha, soloArrastre = false) {
  const farmacias = data.informacion
  const paginacion = data.metadatos?.paginacion
  if (!Array.isArray(farmacias) || !farmacias.length || Number(paginacion?.totalElementos) !== farmacias.length ||
      farmacias.some(f => f.fecha !== fecha)) throw new Error('Guardias de Ourense incompletas o de otra fecha')
  const filas = []
  for (const f of farmacias) {
    const c = f.contactos_profesionales?.[0]
    if (!c?.municipio || !c?.direccion || !f.horarios?.length) throw new Error('Turno sin identificar en Ourense')
    let coord
    try { coord = JSON.parse(c.coordenadas) } catch { /* La dirección sigue siendo útil sin coordenadas. */ }
    const punto = coordenadas(coord?.[0], coord?.[1], [41.85,42.65,-8.4,-6.8])
    for (const h of f.horarios) {
      const inicio = /^((?:[01]\d|2[0-3]):[0-5]\d):00$/.exec(h.hora_apertura)?.[1]
      const fin = /^((?:[01]\d|2[0-3]):[0-5]\d):00$/.exec(h.hora_cierre)?.[1]
      const siguiente = h.cierre_dia_siguiente === true
      const exacto = inicio && fin && typeof h.cierre_dia_siguiente === 'boolean' && (siguiente || fin > inicio)
      if (soloArrastre && (!siguiente || !exacto)) continue
      const horas = exacto ? fecha + ' ' + inicio + '-' + (siguiente ? desplazaFecha(fecha,1) : fecha) + ' ' + fin : 'Horario por confirmar'
      // El colegio puede matizar «Permanente - Localizada» en la misma ficha.
      // Las horas semanales de apertura no acreditan la modalidad de hoy ni sus excepciones.
      const condicion = texto(f.localizacion)
      const tipo = /localizada fuera de horario de apertura/i.test(condicion)
        ? texto(h.tipo).replace(/\s*-\s*localizada$/i,'') : texto(h.tipo)
      filas.push([...punto, [f.nombre,c.direccion].map(texto).join(' · '), texto(c.municipio),
        texto(f.localizacion_telefono || c.telefono), texto(c.codigo_postal), horas,
        [tipo,condicion,f.zona_guardia].map(texto).filter(Boolean).join(' · ')])
    }
  }
  return filas
}

export function parsePontevedra(data, fecha) {
  if (!Array.isArray(data) || data.length > 500) throw new Error('Respuesta inesperada del colegio de Pontevedra')
  const farmacias = new Map()
  for (const f of data) {
    if (f.fecha !== fecha) continue
    if (!f.id || !f.municipio || !f.direccion || !['Diurno','Nocturno'].includes(f.tipo)) throw new Error('Turno desconocido en Pontevedra')
    if (!farmacias.has(f.id)) farmacias.set(f.id, { f, tipos: new Set(), notas: new Set() })
    const grupo = farmacias.get(f.id)
    grupo.tipos.add(f.tipo.toLowerCase())
    if (texto(f.observaciones)) grupo.notas.add(texto(f.observaciones))
  }
  return Array.from(farmacias.values(), ({f,tipos,notas}) => [
    ...coordenadas(f.latitud,f.longitud,[41.8,43.1,-9.1,-7.8]), texto(f.nombre) + ' · ' + texto(f.direccion),
    texto(f.municipio), texto(f.telefono), '', 'Turno ' + [...tipos].sort().join(' y '), [...notas].join(' · ')
  ])
}

export function parseCoruna(html, fecha) {
  const dia = fecha.split('-').reverse().join('/')
  if (!html.match(/<input\b[^>]*id="FechaBusqueda"[^>]*>/i)?.[0].includes('value="' + dia + '"')) throw new Error('El colegio de A Coruña muestra otra fecha')
  const match = html.match(/mapaBuscadorFarmacias\.addMarkers\((\[[^\r\n]+?\])\s*[,)]/)
  const total = html.match(/<strong>\s*(\d+)\s*<\/strong>\s+farmacias?\s+de\s+guardia/i)
  const markers = match && JSON.parse(match[1])
  if (!Array.isArray(markers) || !total || markers.length !== Number(total[1])) throw new Error('Listado incompleto de A Coruña')
  return markers.map(m => {
    if (!m.nombreGuardiaTipoTurno || !m.nombrePoblacion || !m.direccion) throw new Error('Guardia sin identificar en A Coruña')
    // El colegio muestra el servicio de guardia en la lista. El horario del mapa puede ser el habitual.
    return [...coordenadas(m.latitud,m.longitud,[42.3,43.8,-9.5,-7.7]), texto(m.nombre) + ' · ' + texto(m.direccion),
      texto(m.nombrePoblacion), texto(m.telefono), '', 'Turno ' + texto(m.nombreGuardiaTipoTurno).toLowerCase(), '']
  })
}
