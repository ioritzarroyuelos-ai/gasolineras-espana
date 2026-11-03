#!/usr/bin/env node
// Calendario y directorio públicos usados por el nuevo buscador del COF Cantabria.
import { descargarJSON, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseCantabria } from './lib/guardias-fuentes.mjs'
async function main() {
  const fecha = fechaMadrid()
  const [calendario, listado] = await Promise.all([
    descargarJSON('https://cofcantabria.org/datos/guardias.json'),
    descargarJSON('https://cofcantabria.org/datos/farmacias.json'),
  ])
  guardarGuardias('cantabria', 'cofcantabria.org', parseCantabria(calendario, listado, fecha), { fecha, coordenadasOficiales: true, min: 10, max: 500, sourceUrl: 'https://cofcantabria.org/abiertas/' })
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
