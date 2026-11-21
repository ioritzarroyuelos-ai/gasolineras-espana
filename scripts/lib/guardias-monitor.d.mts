export const GUARDIAS_MONITOR_HORAS: number
export function evaluaGuardiaMonitor(data: unknown, now?: number): { ts: string | null; fecha: string | null; dias: number | null; stale: boolean; parcial: boolean; incidencias: string[] }
