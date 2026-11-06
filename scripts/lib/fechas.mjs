// Fechas oficiales sin zona: interpretarlas explícitamente, nunca en la zona del servidor.
const relojes = new Map()
export function fechaHoraLocal(date, zona = 'Europe/Madrid') {
  let reloj = relojes.get(zona)
  if (!reloj) {
    reloj = new Intl.DateTimeFormat('sv-SE', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    relojes.set(zona, reloj)
  }
  return reloj.format(date).replace('T', ' ')
}
export function instanteLocal(value, zona = 'Europe/Madrid') {
  if (typeof value !== 'string') return NaN
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) return Date.parse(value)
  const local = value.replace('T', ' ').slice(0, 16)
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(local)) return NaN
  const utc = Date.parse(local.replace(' ', 'T') + ':00Z')
  if (!Number.isFinite(utc)) return NaN
  let guess = utc
  for (let i = 0; i < 3; i++) {
    const wall = Date.parse(fechaHoraLocal(new Date(guess), zona).replace(' ', 'T') + ':00Z')
    guess += utc - wall
  }
  return fechaHoraLocal(new Date(guess), zona) === local ? guess : NaN
}
