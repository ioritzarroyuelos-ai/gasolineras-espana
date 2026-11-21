#!/usr/bin/env node
// Consulta pública del nuevo buscador COF Almería; el nonce procede de su propia página.
import { descargar, descargarJSON, descargarRespaldo, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseAlmeria } from './lib/guardias-fuentes.mjs'
import { ALMERIA_SOURCE, consultaAlmeria } from './lib/guardias-almeria.mjs'
import { ALMERIA_LOCALIZADOR, parseLocalizadorAlmeria } from './lib/guardias-almeria-respaldo.mjs'
async function main() {
  const fecha = fechaMadrid()
  let parsed, sourceUrl = ALMERIA_SOURCE, consultadoFuente, parcial = false
  try { parsed = parseAlmeria(await consultaAlmeria(fecha, { html: async url => (await descargar(url)).text(), json: descargarJSON }), fecha) }
  catch {
    console.warn('Almería: la consulta directa falla; comprobamos el respaldo regional')
    try {
      const respaldo = await descargarRespaldo('almeria', ALMERIA_SOURCE)
      if (respaldo.fecha !== fecha || !respaldo.data) throw new Error('Almería: respaldo sin datos de la fecha solicitada')
      parsed = parseAlmeria(respaldo.data, fecha)
    } catch {
      const response = await descargar(ALMERIA_LOCALIZADOR, { redirect: 'manual' })
      const raw = await response.text()
      const data = parseLocalizadorAlmeria(raw, fecha)
      parsed = { rows: data.rows, omitidas: 0 }; consultadoFuente = data.consultadoFuente
      sourceUrl = ALMERIA_LOCALIZADOR; parcial = true
    }
  }
  const { rows, omitidas } = parsed
  const incidencias = omitidas ? [`${omitidas} fichas de la fuente sin dirección o municipio; no se muestran`] : []
  if (omitidas) console.warn(incidencias[0])
  if (parcial) incidencias.push('El calendario completo no está disponible. El localizador oficial sólo publica las fichas de esta consulta; todos los horarios y la modalidad quedan por confirmar.')
  guardarGuardias('almeria', 'cofalmeria.com', rows, { fecha, min: parcial ? 5 : 30, max: 600, sourceUrl, incidencias, consultadoFuente, coordenadasOficiales: parcial,
    cobertura: parcial ? 'Cobertura parcial del localizador oficial consultado el ' + consultadoFuente + '. No acredita todas las guardias de la jornada ni apertura actual. Llama antes de acudir.' : undefined })
  if (parcial) process.exitCode = 1 // Publicar lo verificable no convierte el calendario pendiente en éxito.
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
