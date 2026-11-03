export function monitorMessage(errors, status, timestamp, origin) {
  if (!Array.isArray(errors)) throw new Error('El servidor no devolvió la lista de errores')
  const valid = status && typeof status.ok === 'boolean' && Array.isArray(status.services) && status.services.length === 5
  const servicesOK = valid && status.ok && status.services.every(s => s.ok === true)
  const lines = [`${errors.length || !servicesOK ? '⚠️' : '✅'} ${timestamp}`,
    errors.length ? `${errors.length} errores nuevos o recurrentes pendientes de aviso.` : 'Cero errores nuevos o recurrentes pendientes de aviso.']
  for (const e of errors.slice(0, 10)) lines.push(`• ${e.count}× ${e.version || '?'}: ${String(e.message).replace(/\s+/g, ' ').slice(0, 120)}`)
  if (errors.length > 10) lines.push(`(+${errors.length - 10} más)`)
  if (!valid) lines.push('No se pudo comprobar el estado de los cinco servicios.')
  else for (const s of status.services) {
    lines.push(`${s.ok ? '✓' : '⚠'} ${s.name}: ${s.ok ? 'datos al día' : `${s.issues?.length ?? '?'} incidencias`}`)
    for (const i of (s.issues || []).slice(0, 3)) lines.push(`  ${i.name}: ${String(i.problem).slice(0, 150)}`)
  }
  lines.push(`${origin}/status`)
  return lines.join('\n').slice(0, 4000)
}
