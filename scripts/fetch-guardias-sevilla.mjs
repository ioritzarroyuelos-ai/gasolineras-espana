#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { consultaBuscadorGuardias } from './lib/guardias-vcomm.mjs'
import { completarSevilla } from './lib/guardias-sevilla-buscador.mjs'
import { descargar, descargarJSON, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { paginasConPosicion } from './lib/guardias-pdf-posicion.mjs'
import { guardiasMunicipioSevilla, guardiasCapitalSevilla, guardiasZonaSevilla } from './lib/guardias-sevilla.mjs'

const fecha = fechaMadrid()
const trimestre = Math.ceil(Number(fecha.slice(5,7))/3)
const base = 'https://servicios.farmaceuticosdesevilla.es/images/farmaciasguardia/T' + trimestre + '/'
const sourceUrl = 'https://www.farmaceuticosdesevilla.es/ciudadanos/utilidades/localizador-de-farmacias/'
const fuentes = { Sevilla: guardiasCapitalSevilla, Aljarafe: guardiasZonaSevilla, 'moron-osuna-estepa': guardiasZonaSevilla, sierranorte: guardiasZonaSevilla }
const locales = { alcaladeguadaira:'Alcalá de Guadaíra', alcaladelrio:'Alcalá del Río', brenes:'Brenes', burguillos:'Burguillos', cantillana:'Cantillana', carmona:'Carmona' }
for (const [zona, municipio] of Object.entries(locales)) fuentes[zona] = (paginas, fecha) => guardiasMunicipioSevilla(paginas, fecha, municipio)
const incidencias = []
const guardias = new Map()
for (const [zona, leer] of Object.entries(fuentes)) {
  const url = base + zona + '.pdf'
  try {
    const paginas = await paginasConPosicion(await (await descargar(url)).arrayBuffer())
    const turnos = leer(paginas, fecha)
    if (!turnos.length) incidencias.push('El calendario de ' + zona + ' no ha permitido identificar los turnos de hoy.')
    for (const fila of turnos) guardias.set(JSON.stringify(fila), fila)
  } catch { incidencias.push('No se ha podido comprobar el calendario de ' + zona + '.') }
}
try {
  const buscador = await consultaBuscadorGuardias('https://www.farmaceuticosdesevilla.es/buscador-de-farmacias/', fecha, {
    html: async url => (await descargar(url)).text(), json: descargarJSON,
  })
  const { municipios } = JSON.parse(readFileSync(new URL('../public/data/tiempo/municipios.json', import.meta.url), 'utf8'))
  for (const fila of completarSevilla(buscador, fecha, [...guardias.values()], municipios)) guardias.set(JSON.stringify(fila), fila)
} catch { incidencias.push('No se han podido contrastar las guardias adicionales del buscador del colegio.') }
guardarGuardias('sevilla', 'farmaceuticosdesevilla.es', [...guardias.values()], { fecha, sourceUrl, guardiasVerificadas: true, incidencias })
