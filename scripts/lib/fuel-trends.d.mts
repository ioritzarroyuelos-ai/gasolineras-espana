export interface FuelCapture {
  ts: string
  sourceAt: string
  ministryDate: string
  medians: Record<string, number | null>
  ccaa: Record<string, { count: number; fuel: Record<string, number | null> }>
}
export function buildFuelTrends(snapshot: unknown, opts?: {
  now?: Date
  previous?: unknown
  previousSnapshot?: unknown
  previousMeta?: unknown
}): { generatedAt: string; ministryDate: string; current: FuelCapture; previous: FuelCapture | null }
