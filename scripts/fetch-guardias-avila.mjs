#!/usr/bin/env node
// Fuente oficial con fecha comprobada. No dependemos de geocodificación externa.
import { descargar, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseAvila as parseFuente, fechaAvilaPublicada } from './lib/guardias-html.mjs'
const URL = 'https://www.cofavila.com/index.php/servicio-de-guardia-nocturno/'
async function main() {
  const hoy = fechaMadrid()
  const html = await (await descargar(URL)).text()
  const fecha = fechaAvilaPublicada(html, hoy)
  const incidencias = fecha === hoy ? [] : [`Esta fuente aún no incluye la noche del ${hoy.split('-').reverse().join('/')}. Último listado: ${fecha.split('-').reverse().join('/')}; confirma por teléfono antes de acudir.`]
  guardarGuardias('avila', 'cofavila.com', parseFuente(html, fecha), { fecha, min: 1, max: 100, sourceUrl: URL, incidencias, cobertura: 'Guardias nocturnas publicadas por el colegio. Para otros municipios y turnos, consulta los calendarios oficiales.' })
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
