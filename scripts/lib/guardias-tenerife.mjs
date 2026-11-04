// El cliente oficial trata 204 de /open/now como una consulta sin resultados.
// Un cuerpo vacío con HTTP 200 o un error siguen siendo fallos de la fuente.
export async function leerListadoTenerife(response, permitirSinResultados = false) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (response.status === 204 && permitirSinResultados) return []
  const data = await response.json()
  if (!Array.isArray(data)) throw new Error('Respuesta de listado inválida')
  return data
}
