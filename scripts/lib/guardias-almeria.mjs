// Consulta pública compartida por el robot y su respaldo regional.
export const ALMERIA_SOURCE = 'https://www.cofalmeria.com/buscador-de-farmacias/?activo_guardias=on'
const AJAX_URL = 'https://www.cofalmeria.com/wp-admin/admin-ajax.php'
export async function consultaAlmeria(fecha, readers) {
  const html = await readers.html(ALMERIA_SOURCE)
  const config = html.match(/var vbf_vars = (\{[^\n]+\});/)
  if (!config) throw new Error('Almería: no se encuentra la configuración pública')
  const vars = JSON.parse(config[1])
  if (vars.ajax_url !== AJAX_URL || !vars.nonce) throw new Error('Almería: origen de consulta inesperado')
  const body = new URLSearchParams({ action: 'bearer_authentication_with_params', nonce: vars.nonce,
    vbf_req_endpoint: '/farmacias-abiertas', vbf_req_fecha: fecha, vbf_req_cp: '', vbf_req_municipio: '',
    vbf_req_es_listado_geo: 'false', vbf_req_solo_guardias: 'true', vbf_req_aplica_filtro_fecha: 'true', vbf_req_lang: 'es-ES' })
  return readers.json(AJAX_URL, { method: 'POST', body })
}
