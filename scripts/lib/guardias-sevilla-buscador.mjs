import { desplazaFecha } from './guardias-fetch.mjs'

const clave = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[(),]/g,' ').split(/\s+/).filter(p => p && !['de','del','la','las','los','el'].includes(p)).join(' ')

// El mapa publica también las farmacias ordinarias. Solo se aceptan turnos cuya
// fecha completa y horario corto coinciden, en municipios ausentes de los carteles.
export function completarSevilla(respuesta, fecha, carteles, municipios) {
  const data = respuesta?.data?.data
  if (!respuesta?.success || data?.metadatos?.paginacion?.totalPaginas !== 1 || !Array.isArray(data.informacion)) throw new Error('Buscador municipal incompleto')
  const nombres = new Map(municipios.filter(m => m.provinciaId === '41').map(m => [clave(m.nombre), m.nombre]))
  const anteriores = new Set(carteles.map(r=>clave(r[3])))
  const telefonos = new Set(carteles.map(r=>r[4]).filter(Boolean))
  const adicionales = []
  for (const f of data.informacion.flatMap(g=>g.contenido || [])) {
    const mun = clave(String(f.municipio || ''))
    if (!nombres.has(mun) || anteriores.has(mun) || telefonos.has(f.telefono) || !f.direccion || !/^41\d{3}$/.test(f.codigo_postal)) continue
    for (const g of Array.isArray(f.guardias) ? f.guardias : []) {
      const ini = String(g.guardia_horario_fecha_inicio || '').slice(0,16)
      const fin = String(g.guardia_horario_fecha_fin || '').slice(0,16)
      const hm = /^(?:[01]\d|2[0-3]):[0-5]\d$/
      const sig = fin.slice(0,10) === desplazaFecha(fecha,1)
      if (!['presencial','localizada'].includes(g.tipo_guardia) || !ini.startsWith(fecha+' ') || !(fin.startsWith(fecha+' ') || sig) ||
          !hm.test(ini.slice(11)) || !hm.test(fin.slice(11)) || fin <= ini ||
          g.guardia_hora_inicio !== ini.slice(11) || g.guardia_hora_fin !== fin.slice(11)+(sig ? ' (+1)' : '')) continue
      const nombre = nombres.get(mun).replace(/^(.+), (El|La|Los|Las)$/,'$2 $1')
      adicionales.push([0,0,[f.nombre,f.direccion].filter(Boolean).join(' · '),nombre,f.telefono || '',f.codigo_postal,
        ini+'-'+fin, g.tipo_guardia === 'localizada' ? 'Guardia localizada. Llama antes de acudir.' : ''])
    }
  }
  return adicionales
}
