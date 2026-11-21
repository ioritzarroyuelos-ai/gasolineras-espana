import { parse } from 'node-html-parser'
import { texto, coordenadas } from './guardias-fetch.mjs'
import { instanteLocal } from './fechas.mjs'

export const ALMERIA_LOCALIZADOR = 'https://guardias.cofalmeria.com/'
const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
const fail = () => { throw Error('Almería: localizador sin fecha o fichas verificables') }
export function parseLocalizadorAlmeria(html, fecha, now = Date.now()) {
  if (typeof html !== 'string' || html.length > 2000000) return fail()
  const doc = parse(html), main = doc.querySelector('main')
  if (texto(main?.querySelector('h1')?.text) !== 'Farmacias de guardia en Almería') return fail()
  const dates = main.querySelectorAll('p').map(node => texto(node.text)).filter(value => value.startsWith('Datos consultados el '))
  if (dates.length !== 1) return fail()
  const match = /^Datos consultados el (domingo|lunes|martes|miércoles|jueves|viernes|sábado) (\d{1,2}) de ([a-z]+) de (20\d{2}), ((?:[01]\d|2[0-3]):[0-5]\d)$/.exec(dates[0])
  if (!match || !months.includes(match[3])) return fail()
  const date = `${match[4]}-${String(months.indexOf(match[3]) + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`
  const stamp = instanteLocal(date + ' ' + match[5])
  if (date !== fecha || new Date(date + 'T12:00Z').toISOString().slice(0, 10) !== date || days[new Date(date + 'T12:00Z').getUTCDay()] !== match[1] || !Number.isFinite(stamp) || stamp > now || now - stamp > 15 * 60000) return fail()
  const footer = doc.querySelector('footer')
  if (!texto(footer?.text).includes('Turnos facilitados por el Colegio Oficial de Farmacéuticos de Almería.') || !footer?.querySelector('a[href="https://www.cofalmeria.com"]')) return fail()
  const cards = main.querySelectorAll('article.tarjeta')
  if (cards.length < 5 || cards.length > 600) return fail()
  const rows = cards.map(card => {
    const name = texto(card.querySelector('h2')?.text), address = card.querySelector('address')?.structuredText.trim().split(/\n/).map(texto).filter(Boolean)
    if (!name || name.length > 200 || !address || address.length !== 2 || !/^04\d{3} .+/.test(address[1]) || address[0].length > 200) return fail()
    const location = /^(04\d{3}) (.+)$/.exec(address[1]), phone = card.querySelector('a[href^="tel:"]')?.getAttribute('href').slice(4) || ''
    if (phone && !/^(?:\+34)?[6789]\d{8}$/.test(phone)) return fail()
    const mapLink = card.querySelector('a[href^="https://www.google.com/maps/dir/"]')?.getAttribute('href')
    const destination = mapLink ? new URL(mapLink).searchParams.get('destination') : null
    const point = destination && /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(destination) ? destination.split(',').map(Number) : [0, 0]
    const coords = coordenadas(point[0], point[1], [36.6, 37.95, -3.2, -1.5])
    if (!card.querySelectorAll('p').some(p => /^Turno de (?:[01]\d|2[0-3]):[0-5]\d a (?:[01]\d|2[0-3]):[0-5]\d$/.test(texto(p.text)))) return fail()
    // La web da horas relativas y omite la modalidad. Ni su etiqueta «Abierta»
    // ni un turno 21–21 prueban presencialidad o una guardia de 24 horas.
    return [...coords, `${name} · ${address[0]}`, location[2], phone, location[1], '', 'Horario por confirmar: llama antes de acudir. La fuente no precisa la modalidad de atención.']
  })
  return { rows: [...new Map(rows.map(row => [JSON.stringify(row), row])).values()], consultadoFuente: new Date(stamp).toISOString() }
}
