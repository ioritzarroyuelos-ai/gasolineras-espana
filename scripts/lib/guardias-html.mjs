import { parse } from 'node-html-parser'
import { desplazaFecha, rangoGuardia, texto } from './guardias-fetch.mjs'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function parseAvila(html, fecha) {
  const [year, month, day] = fecha.split('-').map(Number)
  const doc = parse(html)
  const table = doc.querySelectorAll('table').find(t => /Farmacia de Guardia nocturna/.test(t.text))
  if (!table || !new RegExp(`\\b${day} de ${MESES[month - 1]} de ${year}\\b`, 'i').test(texto(table.text))) throw new Error('Ávila: el colegio no ha publicado la guardia de la fecha solicitada')
  const rows = []
  for (const tr of table.querySelectorAll('tr').slice(2)) {
    const cells = tr.querySelectorAll('td').map(c => texto(c.text))
    if (cells.length !== 3 || !cells[0] || !cells[1]) throw new Error('Ávila: fila incompleta')
    rows.push([0, 0, cells[1], cells[0] === 'Ávila Capital' ? 'Ávila' : cells[0], cells[2], '', '', 'Guardia nocturna: confirmar horario con la farmacia'])
  }
  return rows
}

export function parseCeuta(html, fecha) {
  const [year, month, day] = fecha.split('-').map(Number)
  const doc = parse(html)
  if (!new RegExp(`${MESES[month - 1]}\\s+${year}`, 'i').test(texto(doc.text))) throw new Error('Ceuta: calendario de otro mes')
  const rows = []
  for (const date of [desplazaFecha(fecha, -1), fecha]) {
    if (date.slice(0, 7) !== fecha.slice(0, 7)) continue
    const numero = Number(date.slice(8))
    const dayNode = doc.querySelectorAll('.txt_dia').find(n => texto(n.text) === String(numero))
    if (!dayNode) throw new Error('Ceuta: día ausente en el calendario')
    const entries = dayNode.parentNode.querySelectorAll('td[onMouseOver]')
    if (entries.length !== 3) throw new Error('Ceuta: faltan turnos en el calendario')
    for (const cell of entries) {
      const label = texto(cell.querySelector('em')?.text)
      const noche = label === 'Turno de Noche:'
      if (date !== fecha && !noche) continue
      const tooltip = cell.getAttribute('onMouseOver')?.match(/ddrivetip\('([\s\S]*?)'\);/)
      if (!tooltip) throw new Error('Ceuta: falta ficha de farmacia')
      // Solo analizamos texto HTML; jamás ejecutamos el JavaScript de la fuente.
      const fields = parse(tooltip[1].replace(/\\'/g, "'")).querySelectorAll('td').map(x => texto(x.text))
      if (fields.length !== 3 || !fields[0] || !fields[1]) throw new Error('Ceuta: ficha incompleta')
      rows.push([0, 0, `${fields[0]} · ${fields[1]}`, 'Ceuta', fields[2], '', noche ? rangoGuardia(date, '23:00', '09:00') : '',
        noche ? 'Turno de noche' : 'Turno de día: 09:00 a 23:00; festivos de 10:00 a 23:00. Confirma antes de acudir.'])
    }
  }
  return rows
}

export function parseAsturias(html, fecha) {
  const doc = parse(html)
  const expected = fecha.split('-').reverse().join('/')
  if (doc.querySelector('input[name="Fecha"]')?.getAttribute('value') !== expected) throw new Error('Asturias: listado de otra fecha')
  const rows = []
  let municipio = '', horario = '', desc = ''
  for (const node of doc.querySelectorAll('.MunicipioGuardias, .HorarioGuardias, a.VerMapa')) {
    if (node.classList.contains('MunicipioGuardias')) municipio = texto(node.text)
    else if (node.classList.contains('HorarioGuardias')) {
      horario = texto(node.querySelector('a')?.getAttribute('name'))
      desc = texto(node.text)
    } else {
      const args = node.getAttribute('href')?.match(/VerMapa\('([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)'\)/)
      if (!args || !municipio) throw new Error('Asturias: ficha sin identificar')
      const tel = texto(node.parentNode.querySelector('.ico-telefono')?.text).match(/\d[\d\s]{7,}/)?.[0]?.replace(/\s/g, '') || ''
      const h = horario.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/)
      rows.push([0, 0, `${texto(args[2])} · ${texto(args[3])}`, texto(args[5]) || municipio, tel, texto(args[4]),
        h ? rangoGuardia(fecha, h[1], h[2]) : '', desc])
    }
  }
  return rows
}
