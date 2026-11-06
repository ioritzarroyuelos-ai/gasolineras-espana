// Consulta pública que realiza el propio buscador cuando se eligen fecha y «solo guardias».
export async function consultaBuscadorGuardias(source, fecha, readers) {
  const html = await readers.html(source)
  const config = html.match(/var vbf_vars = (\{[^\n]+\});/)
  if (!config) throw new Error('No se encuentra la configuración pública del colegio')
  const vars = JSON.parse(config[1])
  const ajax = new URL('/wp-admin/admin-ajax.php', source).href
  if (vars.ajax_url !== ajax || !vars.nonce) throw new Error('El colegio devuelve un origen de consulta inesperado')
  const body = new URLSearchParams({ action:'bearer_authentication_with_params', nonce:vars.nonce,
    vbf_req_endpoint:'/farmacias-abiertas', vbf_req_fecha:fecha, vbf_req_cp:'', vbf_req_municipio:'',
    vbf_req_es_listado_geo:'false', vbf_req_solo_guardias:'true', vbf_req_aplica_filtro_fecha:'true', vbf_req_lang:'es-ES' })
  return readers.json(ajax, { method:'POST', body })
}
