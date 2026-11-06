import { coordenadas, desplazaFecha, rangoGuardia, texto } from './guardias-fetch.mjs'

// COFA v2 devuelve también el turno que comenzó ayer. Conservamos su fecha real.
export function parseAlicante(response, fecha) {
  const lista = response?.data?.pharmacies
  if (!Array.isArray(lista)) throw new Error('COFA: respuesta v2 sin pharmacies')
  return lista.map(f => {
    if (!['today', 'yesterday'].includes(f.open) || !f.code || !f.address || !f.location) throw new Error('COFA: turno incompleto')
    const dia = f.open === 'yesterday' ? desplazaFecha(fecha, -1) : fecha
    return [0, 0, `${texto(f.name)} · ${texto(f.address)}`, texto(f.location), texto(f.phone || f.alternative_phone), texto(f.pc),
      rangoGuardia(dia, f.from, f.until), f.is_delegated ? 'Guardia localizada: llama antes de acudir' : '']
  })
}

const PROVINCIAS_CLM = { 'albacete': '02', 'ciudad real': '13', 'cuenca': '16', 'guadalajara': '19', 'toledo': '45' }
export function parseCLM(response, fecha) {
  if (response?.success !== true || response.fecha !== fecha || !Array.isArray(response.data) || response.total !== response.data.length) {
    throw new Error('COFCAM: respuesta incompleta o de otra fecha')
  }
  return response.data.map(f => {
    const provinciaId = PROVINCIAS_CLM[texto(f.provincia).toLowerCase()]
    if (!provinciaId || !f.domicilio || !f.localidad || !/^\d{4}-\d{2}-\d{2}$/.test(f.fecha_inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(f.fecha_fin)) throw new Error('COFCAM: turno incompleto')
    // Validación horaria compartida; las fechas explícitas del colegio prevalecen.
    rangoGuardia(f.fecha_inicio, f.hora_inicio, f.hora_fin)
    const inicio = `${f.fecha_inicio} ${f.hora_inicio}`, fin = `${f.fecha_fin} ${f.hora_fin}`
    if (fin <= inicio) throw new Error('COFCAM: intervalo no válido')
    return [...coordenadas(f.lat, f.lng, [37.9, 41.4, -5.4, -1]), `${texto(f.nombre)} · ${texto(f.domicilio)}`,
      texto(f.localidad), texto(f.telefono || f.telefono2), '', `${inicio}-${fin}`,
      f.guardia_localizada ? 'Guardia localizada: llama antes de acudir' : '', provinciaId]
  })
}

export function parseCantabria(calendario, listado, fecha) {
  if (!Array.isArray(calendario?.zones) || !Array.isArray(listado?.farmacias)) throw new Error('Cantabria: formato desconocido')
  const farmacias = new Map(listado.farmacias.map(f => [String(f.n), f]))
  const rows = new Map()
  let zonasHoy = 0
  for (const z of calendario.zones) {
    if (!Array.isArray(z.schedule?.[fecha])) throw new Error(`Cantabria: falta el calendario de ${z.name} para ${fecha}`)
    zonasHoy++
    // Incluimos la noche anterior con su fecha para poder filtrar la madrugada.
    for (const dia of [desplazaFecha(fecha, -1), fecha]) {
      if (!Array.isArray(z.schedule?.[dia])) continue
      for (const g of [...z.schedule[dia], ...(calendario.annualFixedDuties?.[z.id] || [])]) {
        const f = farmacias.get(String(g.n))
        const h = texto(g.hours).match(/^(\d{2}:\d{2})\s*[—–-]\s*(\d{2}:\d{2})$/)
        if (!f || !h || !f.direccion || !f.localidad) throw new Error(`Cantabria: farmacia u horario sin identificar en ${z.name}`)
        const rango = rangoGuardia(dia, h[1], h[2])
        rows.set(`${f.n}|${rango}`, [...coordenadas(f.lat, f.lng, [42.8, 43.6, -5, -2.9]), `${texto(f.nombre)} · ${texto(f.direccion)}`,
          texto(f.localidad), texto(f.telefono || g.phone), texto(f.cp), rango, ''])
      }
    }
  }
  if (!zonasHoy) throw new Error('Cantabria: calendario sin zonas')
  return [...rows.values()]
}

export function parseAlmeria(response, fecha) {
  const data = response?.data?.data
  if (response?.success !== true || !Array.isArray(data?.informacion)) throw new Error('Almería: respuesta inválida')
  const farmacias = data.informacion.flatMap(g => g.contenido || [])
  const pagination = data.metadatos?.paginacion
  if (pagination?.totalPaginas !== 1 || pagination.totalElementos !== farmacias.length) throw new Error('Almería: listado incompleto')
  const rows = []
  let omitidas = 0
  for (const f of farmacias) {
    if (!f.nombre || !f.direccion || !f.municipio) { omitidas++; continue }
    if (!Array.isArray(f.guardias) || !f.guardias.length) throw new Error('Almería: farmacia sin turno')
    for (const g of f.guardias) {
      const inicio = texto(g.guardia_horario_fecha_inicio).slice(0, 16)
      const fin = texto(g.guardia_horario_fecha_fin).slice(0, 16)
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(inicio) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(fin)
        || fin < inicio || inicio.slice(0, 10) > fecha || fin.slice(0, 10) < fecha) throw new Error('Almería: fechas incompatibles con la consulta')
      // La fuente contiene intervalos de duración cero: no suponemos que sean de 24 horas.
      const porConfirmar = fin === inicio
      rows.push([0, 0, `${texto(f.nombre)} · ${texto(f.direccion)}`, texto(f.municipio), texto(f.guardias_telefono || f.telefono), texto(f.codigo_postal),
        porConfirmar ? '' : `${inicio}-${fin}`, porConfirmar ? 'Horario por confirmar: llama antes de acudir' : g.tipo_guardia === 'presencial' ? '' : 'Guardia localizada: llama antes de acudir'])
    }
  }
  if (omitidas > farmacias.length * 0.1) throw new Error('Almería: demasiadas fichas sin dirección o municipio')
  return { rows, omitidas }
}


export function turnosLasPalmas(guardias) {
  const salida = []
  const fecha = s => /^(\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d)(?::00)?$/.exec(String(s))?.[1]
  for (const g of Array.isArray(guardias) ? guardias : []) {
    const a = fecha(g.guardia_horario_fecha_inicio), b = fecha(g.guardia_horario_fecha_fin)
    const horario = a && b && b > a ? a + '-' + b : ''
    const tipo = String(g.tipo_guardia || '').trim().toLowerCase()
    const nota = tipo === 'localizada' ? 'Guardia localizada: llama antes de acudir' : tipo === 'presencial' ? 'Guardia presencial' : 'Tipo de guardia por confirmar'
    salida.push({ horario, nota: horario ? nota : nota + ' · Horario por confirmar' })
  }
  return salida.length ? salida : [{ horario: '', nota: 'Horario por confirmar' }]
}
