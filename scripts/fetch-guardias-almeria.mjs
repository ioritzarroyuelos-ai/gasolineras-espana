#!/usr/bin/env node
// Consulta pública del nuevo buscador COF Almería; el nonce procede de su propia página.
import { descargar, descargarJSON, descargarRespaldo, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseAlmeria } from './lib/guardias-fuentes.mjs'
import { ALMERIA_SOURCE, consultaAlmeria } from './lib/guardias-almeria.mjs'
async function main() {
  const fecha = fechaMadrid()
  let data
  try { data = await consultaAlmeria(fecha, { html: async url => (await descargar(url)).text(), json: descargarJSON }) }
  catch {
    console.warn('Almería: la consulta directa falla; comprobamos el respaldo regional')
    const respaldo = await descargarRespaldo('almeria', ALMERIA_SOURCE)
    if (respaldo.fecha !== fecha || !respaldo.data) throw new Error('Almería: respaldo sin datos de la fecha solicitada')
    data = respaldo.data
  }
  const { rows, omitidas } = parseAlmeria(data, fecha)
  const incidencias = omitidas ? [`${omitidas} fichas de la fuente sin dirección o municipio; no se muestran`] : []
  if (omitidas) console.warn(incidencias[0])
  guardarGuardias('almeria', 'cofalmeria.com', rows, { fecha, min: 30, max: 600, sourceUrl: ALMERIA_SOURCE, incidencias })
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
