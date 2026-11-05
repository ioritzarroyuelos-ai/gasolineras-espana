import { escapeHtml as esc } from './html'
export { esc }

const MESES_ABR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function fmtFecha(iso?: string): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return esc(iso)
  return `${Number(m[3])} ${MESES_ABR[Number(m[2]) - 1] || ''} ${m[1]}`
}
export function fmtMesAnio(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  if (!m) return esc(iso)
  return `${MESES_LARGO[Number(m[2]) - 1] || ''} de ${m[1]}`
}
