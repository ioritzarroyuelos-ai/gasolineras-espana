#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { descargar, fechaMadrid, guardarGuardias, texto } from './lib/guardias-fetch.mjs'

const sourceUrl = 'https://ciudadanos.farmaceuticosdevalladolid.es/FarmaciasGuardia.aspx'
const fecha = fechaMadrid()
const pagina = parse(await (await descargar(sourceUrl)).text())
const fechaColegio = fecha.split('-').reverse().join('/')
const fechas = [...pagina.text.matchAll(/Fecha:\s*(\d{2}\/\d{2}\/\d{4})/g)].map(m => m[1])
if (fechas.length !== 3 || fechas.some(f => f !== fechaColegio)) throw new Error('Las tres tablas del colegio deben corresponder a la fecha solicitada')
const guardias = []
for (const fila of pagina.querySelectorAll('tr[id]')) {
  const id = fila.id.match(/^PageContent_GridFarmacias(Diurnas|Provincia)?_DXDataRow\d+$/)
  if (!id) continue
  const celdas = fila.querySelectorAll('td')
  const rural = id[1] === 'Provincia'
  const cp = rural ? texto(celdas[1].text) : ''
  if (rural && !/^47\d{3}$/.test(cp)) continue
  const dir = texto(celdas[rural ? 2 : 0].text).replace(/\s*\(Zona:.*\)\s*$/i, '')
  const muni = rural ? texto(celdas[0].text) : 'Valladolid'
  const localizada = rural && /telephone-call/.test(celdas[3].getAttribute('style') || '')
  const tel = localizada ? texto(celdas[3].text).replace(/^Llamar\s*/i, '').match(/(?:\d[\s-]*){9}/)?.[0].replace(/\D/g,'').slice(0,9) || '' : ''
  const icono = celdas[rural ? 4 : 1].getAttribute('style') || ''
  const turno = icono.includes('sol_luna') ? 'Día y noche (24 horas)' : icono.includes('ico_luna') ? 'Guardia nocturna' : icono.includes('ico_sol') ? 'Guardia diurna' : ''
  if (!turno || !dir || !muni) continue
  guardias.push([0, 0, dir, muni, tel, cp, turno, localizada ? 'Guardia localizada. Llama antes de acudir.' : ''])
}
guardarGuardias('valladolid', 'farmaceuticosdevalladolid.es', guardias, {
  fecha, sourceUrl, guardiasVerificadas: true, cobertura: 'Listas de capital y provincia. Las guardias localizadas requieren llamada.'
})
