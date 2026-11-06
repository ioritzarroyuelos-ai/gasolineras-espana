#!/usr/bin/env node
// El listado diario de guardias de COFBi agrupa las farmacias por franja.
// El directorio general de horarios de apertura es una fuente distinta.
import { descargar, desplazaFecha, guardarGuardias } from './lib/guardias-fetch.mjs'
import { fechaHoraLocal } from './lib/fechas.mjs'
import { parseGuardiasBizkaia } from './lib/guardias-bizkaia.mjs'

const directorio = 'https://www.cofbizkaia.eus/farmacia_de_guardia/'

async function consultar(fecha) {
  const url = new URL(directorio)
  url.searchParams.set('fecha_guardia', fecha.split('-').reverse().join('/'))
  url.searchParams.set('submitForm', '1')
  url.searchParams.set('pagetype', 'farmacias_de_guardia')
  const respuesta = await descargar(url, { headers: { Accept: 'text/html' } })
  return { filas: parseGuardiasBizkaia(await respuesta.text(), fecha), url: url.href }
}

async function main() {
  const ahora = fechaHoraLocal(new Date()), fecha = ahora.slice(0, 10)
  const hoy = await consultar(fecha)
  const ayer = await consultar(desplazaFecha(fecha, -1))
  const guardias = [...ayer.filas.filter(fila => fila[6].slice(17) > ahora), ...hoy.filas]
  guardarGuardias('bizkaia', 'cofbizkaia.eus', guardias, { fecha, sourceUrl: hoy.url })
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
