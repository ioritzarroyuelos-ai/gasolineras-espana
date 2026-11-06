export function parseAlicante(response: unknown, fecha: string): unknown[][]
export function parseCLM(response: unknown, fecha: string): unknown[][]
export function parseCantabria(calendario: unknown, listado: unknown, fecha: string): unknown[][]
export function parseAlmeria(response: unknown, fecha: string): { rows: unknown[][]; omitidas: number }

export function turnosLasPalmas(guardias: unknown): Array<{ horario: string; nota: string }>
