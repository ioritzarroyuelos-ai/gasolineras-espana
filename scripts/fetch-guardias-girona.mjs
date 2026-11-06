#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { descargar, fechaMadrid, guardarGuardias, rangoGuardia, texto } from './lib/guardias-fetch.mjs'

const url = 'https://www.cofgi.org/farmacies/farmacies-de-guardia'
const fecha = fechaMadrid()
const doc = parse(await (await descargar(url)).text())
const fechaES = fecha.split('-').reverse().join('/')
if (!texto(doc.querySelector('.pharmacies-of-guard-title')?.text).endsWith('DIA ' + fechaES)) {
  throw new Error('COFGI: la tabla pertenece a otra fecha')
}

const turnos = doc.querySelectorAll('#pharmacies-of-guard-data-table tr.pharmacy-detail').map(fila => {
  // El navegador cierra automáticamente la celda de horario antes del icono de teléfono.
  const [nombre, poblacion, horas, modalidad, direccion, telefono] = fila.querySelectorAll('td')
  if (!nombre || !poblacion || !horas || !modalidad || !direccion || !telefono) throw new Error('COFGI: ficha incompleta')
  const tramos = horas.structuredText.trim().split(/\n+/).map(linea => {
    const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})(\s*\(dia seg\.\))?$/.exec(linea.trim())
    if (!m || (m[2] <= m[1]) !== Boolean(m[3])) throw new Error('COFGI: turno no reconocido')
    return rangoGuardia(fecha, m[1], m[2])
  })
  const localizada = modalidad.querySelectorAll('img').some(img => /no presencial/i.test(img.getAttribute('alt') || ''))
  return [0, 0, texto(nombre.text) + ' · ' + texto(direccion.text), texto(poblacion.text), texto(telefono.text), '',
    tramos.join(' / '), localizada ? 'Guardia localizada: llama antes de acudir' : '']
})
guardarGuardias('girona', 'cofgi.org', turnos, { fecha, sourceUrl: url, guardiasVerificadas: true, min: 5, max: 300 })
