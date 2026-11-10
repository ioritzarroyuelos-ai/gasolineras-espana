export interface EstadoTarifasItv {
  v: number
  checkedAt: string
  estado: 'verificada' | 'pendiente'
  fuentes: Array<{id: string; url: string; checkedAt: string; estado: 'verificada' | 'cambiada' | 'no_disponible'; error?: string}>
  tarifas: Array<{slug: string; estado: 'verificada' | 'pendiente'; fuentes: string[]}>
}

export function comprobacionItvReciente(fecha: string | undefined, ahora = Date.now()): boolean {
  const instante = Date.parse(fecha || '')
  return Number.isFinite(instante) && instante <= ahora + 300000 && ahora - instante <= 30 * 3600000
}

export function tarifaComprobadaHoy(slug: string, estado: EstadoTarifasItv | null | undefined, ahora = Date.now()): boolean {
  if (estado?.v !== 1 || !comprobacionItvReciente(estado.checkedAt, ahora)
    || !Array.isArray(estado.tarifas) || !Array.isArray(estado.fuentes)) return false
  const tarifa = estado.tarifas?.find(t => t.slug === slug)
  return tarifa?.estado === 'verificada' && Array.isArray(tarifa.fuentes) && tarifa.fuentes.length >= 2 && tarifa.fuentes.includes(slug)
    && tarifa.fuentes.includes('tasa-dgt') && tarifa.fuentes.every(id => estado.fuentes?.some(f => f.id === id
      && f.estado === 'verificada' && comprobacionItvReciente(f.checkedAt, ahora)))
}
