#!/usr/bin/env node
// El listado diario de guardias de COFBi agrupa las farmacias por franja.
// El directorio general de horarios de apertura es una fuente distinta.
import { desplazaFecha, guardarGuardias } from './lib/guardias-fetch.mjs'
import { fechaHoraLocal } from './lib/fechas.mjs'
import { recogerGuardiasBizkaia } from './lib/guardias-bizkaia.mjs'

async function main() {
  const ahora = fechaHoraLocal(new Date()), fecha = ahora.slice(0, 10)
  const hoy = await recogerGuardiasBizkaia(fecha)
  const ayer = await recogerGuardiasBizkaia(desplazaFecha(fecha, -1))
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
    fecha, sourceUrl: hoy.url, guardiasVerificadas: true, avisosMunicipales,
    cobertura: 'Consultadas las ' + hoy.municipios + ' opciones municipales del colegio. Las farmacias se muestran en el municipio donde están situadas.',
    incidencias: hoy.sinResultados.map(m => 'El colegio no devuelve resultados para ' + m.nombre + ' el ' + fecha + '. Consulta la fuente oficial antes de desplazarte.')
  })
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
