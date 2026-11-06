#!/usr/bin/env node
// Fuente oficial con fecha comprobada. No dependemos de geocodificación externa.
import { descargarGuardiaHTML, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseAsturias as parseFuente } from './lib/guardias-html.mjs'
const URL = 'https://www.farmasturias.org/GESCOF/cms/Guardias/FarmaciaBuscar.asp?IdMenu=355'
async function main() {
  const fecha = fechaMadrid()
  const html = await descargarGuardiaHTML('asturias', URL)
  guardarGuardias('asturias', 'farmasturias.org', parseFuente(html, fecha), { fecha, min: 20, max: 250, sourceUrl: URL, guardiasVerificadas: true })
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
