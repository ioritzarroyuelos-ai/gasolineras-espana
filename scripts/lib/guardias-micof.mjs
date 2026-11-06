import { parse } from 'node-html-parser'
import { texto } from './guardias-fetch.mjs'

export function urgenciasMICOF(html, fecha) {
  const doc = parse(html)
  const dia = new Date(fecha + 'T12:00:00Z')
  const nombreDia = new Intl.DateTimeFormat('es', { weekday: 'long', timeZone: 'Europe/Madrid' }).format(dia)
  const calendario = doc.querySelector('.farmacias-horario')
  if (Number(calendario?.querySelector('select option[selected]')?.getAttribute('value')) !== dia.getUTCMonth() + 1) return false
  const etiqueta = nombreDia + ' ' + fecha.slice(-2)
  return calendario.querySelectorAll('.farmacias-horario--wrapper li').some(fila =>
    texto(fila.querySelector('strong')?.text).toLowerCase() === etiqueta &&
    texto(fila.querySelector('.label--urgencia')?.text).toUpperCase() === 'HORARIO DE URGENCIAS'
  )
}
