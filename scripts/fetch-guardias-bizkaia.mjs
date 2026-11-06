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
  const avisosMunicipales = {}
  for (const fila of guardias.filter(f => f[8] && f[9])) {
    const zona = fila[9].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    const momento = s => s.slice(8,10) + '/' + s.slice(5,7) + ' a las ' + s.slice(11,16)
    const poblacion = s => s.charAt(0) + s.slice(1).toLocaleLowerCase('es')
    const telefono = fila[4].replace(/\s/g,'').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')
    const aviso = 'La guardia de ' + poblacion(fila[9]) + ' se atiende en ' + poblacion(fila[3]) + ', en la farmacia ' + fila[2] +
      '. Del ' + momento(fila[6].slice(0,16)) + ' al ' + momento(fila[6].slice(17)) + '. Teléfono ' + telefono + '.'
    if (!avisosMunicipales[zona]) avisosMunicipales[zona] = []
    avisosMunicipales[zona].push(aviso)
  }
  guardarGuardias('bizkaia', 'cofbizkaia.eus', guardias.filter(f => !f[8]), {
    fecha, sourceUrl: hoy.url, guardiasVerificadas: true, avisosMunicipales
  })
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
