import { parse } from 'node-html-parser'
import { desplazaFecha, rangoGuardia, texto } from './guardias-fetch.mjs'

export const GIRONA_SOURCE = 'https://www.cofgi.org/farmacies/farmacies-de-guardia'
export function parseGirona(html, fecha) {
  const doc = parse(html)
  const fechaES = fecha.split('-').reverse().join('/')
  if (!texto(doc.querySelector('.pharmacies-of-guard-title')?.text).endsWith('DIA ' + fechaES)) throw Error('COFGI: la tabla pertenece a otra fecha')
  return doc.querySelectorAll('#pharmacies-of-guard-data-table tr.pharmacy-detail').map(fila => {
    const [nombre, poblacion, horas, modalidad, direccion, telefono] = fila.querySelectorAll('td')
    if (!nombre || !poblacion || !horas || !modalidad || !direccion || !telefono) throw Error('COFGI: ficha incompleta')
    const tramos = horas.structuredText.trim().split(/\n+/).map(linea => {
      const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})(\s*\(dia seg\.\))?$/.exec(linea.trim())
      if (!m || (m[2] <= m[1]) !== Boolean(m[3])) throw Error('COFGI: turno no reconocido')
      return rangoGuardia(fecha, m[1], m[2])
    })
    const localizada = modalidad.querySelectorAll('img').some(img => /no presencial/i.test(img.getAttribute('alt') || ''))
    return [0, 0, texto(nombre.text) + ' · ' + texto(direccion.text), texto(poblacion.text), texto(telefono.text), '', tramos.join(' / '), localizada ? 'Guardia localizada: llama antes de acudir' : '']
  })
}
export async function consultaGirona(fecha, html) {
  const query = async date => parseGirona(await html(GIRONA_SOURCE, { method: 'POST', body: new URLSearchParams({ 'city-group': '0', city: '0', date }) }), date)
  // La portada puede seguir mostrando el día de guardia anterior de madrugada.
  // Pedimos la fecha concreta y mantenemos sólo el tramo de ayer que aún llega a hoy.
  const today = await query(fecha)
  if (today.length < 5 || today.length > 300) throw Error('COFGI: listado del día incompleto')
  const yesterday = await query(desplazaFecha(fecha, -1))
  if (yesterday.length < 5 || yesterday.length > 300) throw Error('COFGI: listado nocturno anterior incompleto')
  const start = fecha + ' 00:00'
  const overnight = yesterday.flatMap(row => {
    const ranges = row[6].split(' / ').filter(range => range.slice(0, 16) < start && range.slice(17) > start)
    return ranges.length ? [[...row.slice(0, 6), ranges.join(' / '), row[7]]] : []
  })
  return [...new Map([...overnight, ...today].map(row => [JSON.stringify(row), row])).values()]
}
