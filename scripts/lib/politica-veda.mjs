// La fecha civil en estos dos husos determina cuándo empieza el primer día
// en España y cuándo termina el último, también con horario de verano.
const diaPeninsula = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' })
const diaCanarias = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Atlantic/Canary' })

export function enVeda(ahoraISO, fecha) {
  if (!fecha.confirmada || !fecha.valor || !/^\d{4}-\d{2}-\d{2}$/.test(fecha.valor)) return false
  const votacion = new Date(fecha.valor + 'T00:00:00Z')
  const ahora = new Date(ahoraISO)
  if (!Number.isFinite(votacion.getTime()) || !Number.isFinite(ahora.getTime())) return false
  if (votacion.toISOString().slice(0, 10) !== fecha.valor) return false

  // Cinco días naturales previos (LOREG 69.7). Además, la web mantiene los
  // sondeos ocultos hasta que termina la jornada electoral en toda España.
  const inicio = new Date(votacion)
  inicio.setUTCDate(inicio.getUTCDate() - 5)
  return diaPeninsula.format(ahora) >= inicio.toISOString().slice(0, 10)
    && diaCanarias.format(ahora) <= fecha.valor
}
