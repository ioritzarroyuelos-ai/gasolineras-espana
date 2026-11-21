export interface RecordatorioItv { id: string; fecha: string; nombre: string }

export function fechaItvValida(value: unknown): value is string {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}

export function recordatorioItvValido(value: unknown): value is RecordatorioItv {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).every(key => ['id', 'fecha', 'nombre'].includes(key)) &&
    typeof item.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id) &&
    fechaItvValida(item.fecha) && typeof item.nombre === 'string' && item.nombre.trim().length > 0 && item.nombre.length <= 60 && !/[\u0000-\u001f\u007f]/.test(item.nombre)
}

/** Fecha que indicó la persona; no calcula el plazo legal ni una cita oficial. */
export function calendarioItv(recordatorio: RecordatorioItv, ahora = new Date()): string {
  if (!recordatorioItvValido(recordatorio) || !Number.isFinite(ahora.getTime())) throw new Error('Recordatorio no válido')
  const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
  const date = recordatorio.fecha.replace(/-/g, '')
  const end = new Date(Date.parse(recordatorio.fecha + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10).replace(/-/g, '')
  const stamp = ahora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Espana Util//Recordatorio ITV//ES', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', 'UID:itv-' + recordatorio.id + '@webapp-3ft.pages.dev', 'DTSTAMP:' + stamp,
    'DTSTART;VALUE=DATE:' + date, 'DTEND;VALUE=DATE:' + end, 'SUMMARY:' + escape('ITV: ' + recordatorio.nombre),
    'DESCRIPTION:' + escape('Fecha indicada por ti en España Útil. Revisa la fecha de tu documentación y pide cita en tu estación. No es una cita confirmada ni un cálculo del plazo legal.'),
    'URL:https://webapp-3ft.pages.dev/itv/', 'TRANSP:TRANSPARENT',
    ...[7, 1].flatMap(days => ['BEGIN:VALARM', 'TRIGGER:-P' + days + 'D', 'ACTION:DISPLAY', 'DESCRIPTION:' + escape('Recordatorio ITV: ' + recordatorio.nombre), 'END:VALARM']),
    'END:VEVENT', 'END:VCALENDAR']
  // RFC 5545: CRLF y líneas de hasta 75 octetos, sin partir caracteres UTF-8.
  const encoder = new TextEncoder()
  return lines.map(line => {
    let folded = '', length = 0
    for (const character of line) {
      const bytes = encoder.encode(character).length
      if (length + bytes > 75) { folded += '\r\n '; length = 1 }
      folded += character; length += bytes
    }
    return folded
  }).join('\r\n') + '\r\n'
}
