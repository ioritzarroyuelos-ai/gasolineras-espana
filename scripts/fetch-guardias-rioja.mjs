#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { descargar, fechaMadrid, guardarGuardias, rangoGuardia, texto } from './lib/guardias-fetch.mjs'

const base = 'https://apps.riojasalud.es/farmacias_guardia/public/guardias/'
const fecha = fechaMadrid()
const poblaciones = ['Logroño','Haro','Alfaro','Nájera','Arnedo','Calahorra','Ezcaray','Cervera del Río Alhama','Santo Domingo de la Calzada']
const guardias = []
for (const [i,poblacion] of poblaciones.entries()) {
  const url = base+'?id_municipio='+(i+3)
  const html = parse(await (await descargar(url)).text())
  const hoy = html.querySelectorAll('table.table-hover').filter(t=>texto(t.querySelector('th')?.text).split(' ')[0]===fecha.split('-').reverse().join('/'))
  if (hoy.length!==1) throw new Error('Sin tabla fechada de '+poblacion)
  for (const fila of hoy[0].querySelectorAll('tr')) {
    const td = fila.querySelectorAll('td')
    if (!td.length) continue
    const nombreDireccion = texto(td[0].text)
    const horas = texto(td[1]?.text).match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/)
    if (!horas || horas[1]===horas[2] || !nombreDireccion) throw new Error('Fila de guardia dudosa en '+poblacion)
    // Conservar los paréntesis de nombre comercial, dirección y barrio tal como los publica Rioja Salud.
    guardias.push([0,0,nombreDireccion,poblacion,'','',rangoGuardia(fecha,horas[1],horas[2]),''])
  }
}
guardarGuardias('rioja','riojasalud.es',guardias,{fecha,sourceUrl:base,min:9,max:150,guardiasVerificadas:true})
