#!/usr/bin/env node
// Consulta pública del nuevo buscador COF Almería; el nonce procede de su propia página.
import { descargar, descargarJSON, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseAlmeria } from './lib/guardias-fuentes.mjs'
const URL = 'https://www.cofalmeria.com/buscador-de-farmacias/?activo_guardias=on'
async function main() {
  const fecha = fechaMadrid()
  const html = await (await descargar(URL)).text()
  const config = html.match(/var vbf_vars = (\{[^\n]+\});/)
  if (!config) throw new Error('Almería: no se encuentra la configuración pública')
  const vars = JSON.parse(config[1])
  if (vars.ajax_url !== 'https://www.cofalmeria.com/wp-admin/admin-ajax.php' || !vars.nonce) throw new Error('Almería: origen de consulta inesperado')
  const body = new URLSearchParams({ action: 'bearer_authentication_with_params', nonce: vars.nonce,
    vbf_req_endpoint: '/farmacias-abiertas', vbf_req_fecha: fecha, vbf_req_cp: '', vbf_req_municipio: '',
    vbf_req_es_listado_geo: 'false', vbf_req_solo_guardias: 'true', vbf_req_aplica_filtro_fecha: 'true', vbf_req_lang: 'es-ES' })
  const data = await descargarJSON(vars.ajax_url, { method: 'POST', body })
  const { rows, omitidas } = parseAlmeria(data, fecha)
  const incidencias = omitidas ? [`${omitidas} fichas de la fuente sin dirección o municipio; no se muestran`] : []
  if (omitidas) console.warn(incidencias[0])
  guardarGuardias('almeria', 'cofalmeria.com', rows, { fecha, min: 30, max: 600, sourceUrl: URL, incidencias })
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
