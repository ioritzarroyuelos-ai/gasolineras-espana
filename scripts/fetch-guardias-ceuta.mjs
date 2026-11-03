#!/usr/bin/env node
// Fuente oficial con fecha comprobada. No dependemos de geocodificación externa.
import { descargarGuardiaHTML, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseCeuta as parseFuente } from './lib/guardias-html.mjs'
const URL = 'https://ipsi.ceuta.es:8443/sanidad/farmacia/controlfarmacia?cmd=guardias-nuevo'
async function main() {
  const fecha = fechaMadrid()
  const html = await descargarGuardiaHTML('ceuta', URL, 'windows-1252')
  guardarGuardias('ceuta', 'ceuta.es', parseFuente(html, fecha), { fecha, min: 3, max: 10, sourceUrl: URL,
    cobertura: fecha.endsWith('-01') ? 'El calendario actual no permite confirmar la noche del último día del mes anterior. Antes de las 09:00 consulta la fuente oficial y llama antes de acudir.' : undefined })
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
