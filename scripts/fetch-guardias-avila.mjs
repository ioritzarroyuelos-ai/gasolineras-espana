#!/usr/bin/env node
// Fuente oficial con fecha comprobada. No dependemos de geocodificación externa.
import { descargar, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseAvila as parseFuente } from './lib/guardias-html.mjs'
const URL = 'https://www.cofavila.com/index.php/servicio-de-guardia-nocturno/'
async function main() {
  const fecha = fechaMadrid()
  const html = await (await descargar(URL)).text()
  guardarGuardias('avila', 'cofavila.com', parseFuente(html, fecha), { fecha, min: 1, max: 100, sourceUrl: URL, cobertura: 'Guardias nocturnas publicadas por el colegio. Para otros municipios y turnos, consulta los calendarios oficiales.' })
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
