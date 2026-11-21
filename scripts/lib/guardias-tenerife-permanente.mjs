import { desplazaFecha, rangoGuardia } from './guardias-fetch.mjs'

const canon = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim()
const nombre = s => canon(s).replace(/^LCD[OA]\.:\s*/, '').replace(/[^A-Z0-9]+/g, ' ').trim()
const calle = s => nombre(s).replace(/^(?:C|CALLE) /, '').replace(/\b(?:N|Nº|NUMERO)\b/g, '').replace(/\s+/g, ' ').trim()
const telefono = s => String(s ?? '').replace(/\D/g, '')
const orden = (a, b) => Math.abs(a.y - b.y) < .001 ? a.x - b.x : a.y - b.y

// El cartel mezcla guardias y aperturas. Sólo esta etiqueta explícita permite
// buscar una guardia; «hasta las 24 h» o una apertura de 24 h nunca bastan.
// La imagen del encabezado no se interpreta: el día completo se corrobora con
// las fechas y horas del directorio oficial que el robot ya descarga a diario.
export function guardiaPermanenteSantaCruz(paginas, fecha, directorio = []) {
  if (paginas.length !== 1 || !Array.isArray(directorio) || !/^\d{4}-\d\d-\d\d$/.test(fecha)) return []
  const dia = new Date(fecha + 'T12:00:00Z')
  if (!Number.isFinite(dia.getTime()) || dia.toISOString().slice(0, 10) !== fecha) return []
  const pagina = paginas[0]
  const titulo = canon(pagina.filter(c => c.y < .09).sort(orden).map(c => c.texto).join(' '))
  if (titulo !== 'TURNOS DE FARMACIAS DE GUARDIA Y HORARIOS AMPLIADOS SANTA CRUZ DE TENERIFE') return []
  const marcas = pagina.filter(c => canon(c.texto) === 'HORARIO DE GUARDIA: 24H')
  if (marcas.length !== 1) return []
  const marca = marcas[0]
  // Plantilla conocida: cuatro líneas dentro de la misma columna. Una quinta
  // línea/condición o un desplazamiento incompatible exige revisar el cartel.
  if (marca.x < .10 || marca.x > .15 || marca.y < .15 || marca.y > .20) return []
  const bloque = pagina.filter(c => c.x >= marca.x - .005 && c.x < marca.x + .265 && c.y > marca.y - .045 && c.y < marca.y + .040).sort(orden)
  const lineas = []
  for (const c of bloque) {
    const ultima = lineas.at(-1)
    if (ultima && Math.abs(ultima.y - c.y) < .001) ultima.texto += ' ' + c.texto
    else lineas.push({ y: c.y, texto: c.texto })
  }
  if (lineas.length !== 4 || !/^CALLE\s/.test(canon(lineas[0].texto)) ||
      !/^TELEFONO: [\d ]+$/.test(canon(lineas[1].texto)) || !/^LCD[OA]\.:\s/.test(canon(lineas[2].texto)) ||
      canon(lineas[3].texto) !== 'HORARIO DE GUARDIA: 24H') return []
  const tel = telefono(lineas[1].texto)
  if (!/^\d{9}$/.test(tel)) return []
  const titular = nombre(lineas[2].texto)
  const porTelefono = directorio.filter(f => telefono(f?.telefono) === tel)
  const porTitular = directorio.filter(f => Array.isArray(f?.infoTitulares) && f.infoTitulares.some(t => nombre(t?.nombreCompleto) === titular))
  if (porTelefono.length !== 1 || porTitular.length !== 1 || porTelefono[0] !== porTitular[0]) return []
  const oficina = porTelefono[0]
  if (!/^\d+$/.test(String(oficina.idFarmacia)) || canon(oficina.municipio) !== 'SANTA CRUZ DE TENERIFE' ||
      calle(oficina.direccion) !== calle(lineas[0].texto) || !Array.isArray(oficina.infoHorario)) return []
  const fin = desplazaFecha(fecha, 1)
  // Son fechas y horas locales de Canarias, no UTC ni Europe/Madrid. No se
  // reutilizan las horas de otro día ni se suman intervalos parciales.
  const desde = fecha + 'T00:00:00', hasta = fin + 'T00:00:00'
  if (oficina.infoHorario.some(h => !h || !/^\d{4}-\d\d-\d\dT00:00:00$/.test(h.fecha) ||
      !/^\d{4}-\d\d-\d\dT00:00:00$/.test(h.fechaFin) || typeof h.horaIni !== 'string' || typeof h.horaFin !== 'string')) return []
  const pertinentes = oficina.infoHorario.filter(h => h.fecha < hasta && h.fechaFin > desde)
  if (pertinentes.length !== 1 || pertinentes[0].fecha !== desde || pertinentes[0].fechaFin !== hasta ||
      pertinentes[0].horaIni !== '0001-01-01T00:00:00' || pertinentes[0].horaFin !== '0001-01-01T00:00:00') return []
  return [{ nombre: lineas[2].texto, direccion: lineas[0].texto, telefono: tel,
    horario: rangoGuardia(fecha, '00:00', '00:00'), nota: 'Guardia de 24 horas del cartel, corroborada para este día en el directorio del colegio' }]
}
