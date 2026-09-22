// Validador edge del precomputo de gasolineras (M5). Mismo patron que
// observatorioFromPre(): gasolineras-resumen.json es un asset externo que puede
// llegar corrupto/desactualizado; validamos version, estructura y numeros
// finitos, y si algo no cuadra devolvemos null para que el handler CAIGA al
// calculo completo sobre stations.json (nunca servir precios rotos).
//
// La forma de `nacionalStats` es la que produce statsNacional() en
// src/lib/municipios.ts y scripts/lib/gasolineras-precalculo.mjs (test de
// equivalencia: tests/gasolineras-precalculo.test.ts).

export interface FuelStat { min: number; max: number; avg: number; count: number }

export interface GasolinerasResumen {
  fechaMinisterio?: string
  nacionalStats: { stats: Record<string, FuelStat>; stationCount: number }
  provinciaCounts: Record<string, number>
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function fuelStatValido(s: unknown): s is FuelStat {
  if (!s || typeof s !== 'object') return false
  const o = s as Record<string, unknown>
  return finite(o.min) && finite(o.max) && finite(o.avg) && finite(o.count)
}

export function resumenFromPre(pre: unknown): GasolinerasResumen | null {
  if (!pre || typeof pre !== 'object') return null
  const p = pre as Record<string, unknown>
  if (p.v !== 1) return null

  const ns = p.nacionalStats as Record<string, unknown> | undefined
  if (!ns || typeof ns !== 'object' || !finite(ns.stationCount)) return null
  if (!ns.stats || typeof ns.stats !== 'object') return null
  const stats: Record<string, FuelStat> = {}
  for (const k of Object.keys(ns.stats as object)) {
    const v = (ns.stats as Record<string, unknown>)[k]
    if (!fuelStatValido(v)) return null   // un stat corrupto -> fallback completo
    stats[k] = v
  }

  if (!p.provinciaCounts || typeof p.provinciaCounts !== 'object') return null
  const provinciaCounts: Record<string, number> = {}
  for (const k of Object.keys(p.provinciaCounts as object)) {
    const v = (p.provinciaCounts as Record<string, unknown>)[k]
    if (!finite(v)) return null
    provinciaCounts[k] = v
  }

  return {
    fechaMinisterio: typeof p.fechaMinisterio === 'string' ? p.fechaMinisterio : undefined,
    nacionalStats: { stats, stationCount: ns.stationCount },
    provinciaCounts,
  }
}
