import { parse } from 'node-html-parser'
import { rangoGuardia, texto, desplazaFecha } from './guardias-fetch.mjs'
const MONTHS = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
const plain = value => texto(value).normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
const fail = () => { throw Error('COFCO: calendario mensual de capital no verificable') }
export function calendarioCapitalUrl(html, periodo) {
  if (!/^20\d\d-(?:0[1-9]|1[0-2])$/.test(periodo)) return fail()
  const [year, month] = periodo.split('-'), name = MONTHS[Number(month) - 1]
  const candidates = parse(html).querySelectorAll('a[href]').filter(a => plain(a.text) === name).map(a => new URL(a.getAttribute('href'), 'https://www.cofco.org'))
    .filter(url => url.origin === 'https://www.cofco.org' && /^\/wp-content\/uploads\/\d{4}\/\d{2}\//.test(url.pathname) && new RegExp('^' + name + '[-_ ]' + year + '(?:-\\d+)?\\.PDF$').test(plain(decodeURIComponent(url.pathname.split('/').at(-1)))) && !url.search && !url.hash)
  const unique = [...new Set(candidates.map(url => url.href))]
  if (unique.length !== 1) return fail()
  return unique[0]
}
export function parseCapitalCordoba(pages, fecha, periodo) {
  if (!/^20\d\d-(?:0[1-9]|1[0-2])-\d{2}$/.test(fecha) || fecha.slice(0, 7) !== periodo || new Date(fecha + 'T12:00Z').toISOString().slice(0, 10) !== fecha || !Array.isArray(pages) || pages.length < 3 || pages.length > 20) return fail()
  const templates = new Map(), exceptions = new Map()
  for (const page of pages) {
    if (!Array.isArray(page) || page.length > 1000 || page.some(item => typeof item.texto !== 'string' || !Number.isFinite(item.x) || !Number.isFinite(item.y))) return fail()
    if (!page.some(item => plain(item.texto) === 'CORDOBA CAPITAL - FARMACIAS DE GUARDIA') || !page.some(item => plain(item.texto) === 'WWW.COFCO.ORG')) return fail()
    const headings = page.filter(item => item.y > .06 && item.y < .09)
    if (headings.length !== 1) return fail()
    const heading = plain(headings[0].texto)
    if (['LUNES A VIERNES', 'SABADOS', 'DOMINGOS'].includes(heading)) {
      if (templates.has(heading)) return fail()
      templates.set(heading, page)
    } else {
      const special = /^(\d{1,2}) DE ([A-Z]+) \(FESTIVO\)$/.exec(heading)
      if (!special || special[2] !== MONTHS[Number(periodo.slice(5)) - 1]) return fail()
      const day = periodo + '-' + special[1].padStart(2, '0')
      if (new Date(day + 'T12:00Z').toISOString().slice(0, 10) !== day || exceptions.has(day)) return fail()
      exceptions.set(day, page)
    }
  }
  if (templates.size !== 3) return fail()
  const week = new Date(fecha + 'T12:00Z').getUTCDay()
  const page = exceptions.get(fecha) || templates.get(week === 0 ? 'DOMINGOS' : week === 6 ? 'SABADOS' : 'LUNES A VIERNES')
  const dayHeaders = page.filter(item => /^DIA - DE /.test(plain(item.texto))), nightHeaders = page.filter(item => /^NOCHE - DE /.test(plain(item.texto)))
  if (dayHeaders.length !== 1 || nightHeaders.length !== 1 || dayHeaders[0].y >= nightHeaders[0].y) return fail()
  // El PDF actual sólo añade referencias de ubicación entre las columnas.
  // Si incorpora condiciones de atención, no las perdemos al crear intervalos.
  const condiciones = /\b(?:LOCALIZAD[AO]|PREVIO AVISO|PREVIA LLAMADA|NO PRESENCIAL|PUERTA CERRADA|EXCEPTO|SALVO|HORARIO ESPECIAL|CERRAD[AO]|CAMBIOS? (?:DE )?(?:TURNO|GUARDIA|HORARIO))\b/
  if (page.some(item => item.y > dayHeaders[0].y && item.y < .95 && condiciones.test(plain(item.texto)))) return fail()
  const day = /^DIA - DE (\d{1,2}:\d{2}) DE LA MANANA A (\d{1,2}:\d{2}) DE LA NOCHE$/.exec(plain(dayHeaders[0].texto))
  const night = /^NOCHE - DE (\d{1,2}:\d{2}) DE LA NOCHE A (\d{1,2}:\d{2}) DEL DIA SIGUIENTE$/.exec(plain(nightHeaders[0].texto))
  if (!day || !night) return fail()
  const rows = []
  for (const [kind, header, until, hours] of [['día', dayHeaders[0], nightHeaders[0].y, day], ['noche', nightHeaders[0], .95, night]]) {
    const addresses = page.filter(item => item.x > .01 && item.x < .08 && item.y > header.y && item.y < until).sort((a, b) => a.y - b.y)
    if (addresses.length < (kind === 'día' ? 10 : 1) || addresses.length > (kind === 'día' ? 100 : 10)) return fail()
    const start = hours[1].padStart(5, '0'), end = hours[2].padStart(5, '0')
    if (kind === 'día' && start >= end || kind === 'noche' && end >= start) return fail()
    for (const address of addresses) {
      if (!page.some(item => item.x > .7 && Math.abs(item.y - address.y) < .004 && /^ZONA /.test(plain(item.texto))) || !texto(address.texto) || texto(address.texto).length > 200) return fail()
      rows.push([0, 0, texto(address.texto), 'Córdoba', '', '', rangoGuardia(fecha, start, end), 'Calendario mensual del colegio · Guardia de ' + kind])
    }
  }
  return rows
}
export async function consultaCapitalCordoba(fecha, { html, pdf, pages }) {
  const periods = [...new Set([fecha.slice(0, 7), desplazaFecha(fecha, -1).slice(0, 7)])], copies = new Map(), urls = []
  for (const period of periods) {
    const portal = 'https://www.cofco.org/guardias-' + period.slice(0, 4) + '/'
    const url = calendarioCapitalUrl(await html(portal), period)
    const data = await pages(await pdf(url)); copies.set(period, data); urls.push(url)
  }
  const today = parseCapitalCordoba(copies.get(fecha.slice(0, 7)), fecha, fecha.slice(0, 7)), previous = desplazaFecha(fecha, -1)
  const overnight = parseCapitalCordoba(copies.get(previous.slice(0, 7)), previous, previous.slice(0, 7)).filter(row => row[6].slice(17) > fecha + ' 00:00')
  return { rows: [...overnight, ...today], urls }
}
