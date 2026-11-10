import { texto } from './guardias-fetch.mjs'

// El colegio a veces omite el paréntesis final del enlace. La semana sigue
// teniendo que coincidir exactamente; el lector del PDF valida además la fila.
export function seleccionarSemanaPalencia(enlaces, fecha) {
  const hoy = new Date(fecha + 'T12:00:00Z')
  const lunes = new Date(hoy)
  lunes.setUTCDate(hoy.getUTCDate() - ((hoy.getUTCDay() + 6) % 7))
  const domingo = new Date(lunes)
  domingo.setUTCDate(lunes.getUTCDate() + 6)
  const normalizar = s => texto(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
  const mes = d => normalizar(d.toLocaleString('es', { month: 'long', timeZone: 'UTC' }))
  const candidatos = enlaces.filter(({ nombre }) => {
    const m = /^PALENCIA\s*\(\s*(?:DEL\s+)?(\d{1,2})(?:\s+DE\s+([A-Z]+))?\s+AL\s+(\d{1,2})\s+DE\s+([A-Z]+)\s*\)?$/.exec(normalizar(nombre))
    return m && Number(m[1]) === lunes.getUTCDate() && (m[2] || m[4]) === mes(lunes) &&
      Number(m[3]) === domingo.getUTCDate() && m[4] === mes(domingo)
  })
  if (candidatos.length !== 1) throw new Error('Falta un enlace único del colegio a la semana actual')
  return { enlace: candidatos[0], lunes, domingo }
}
