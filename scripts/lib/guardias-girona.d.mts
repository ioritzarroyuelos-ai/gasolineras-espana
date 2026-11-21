export const GIRONA_SOURCE: string
export function parseGirona(html: string, fecha: string): (string | number)[][]
export function consultaGirona(fecha: string, html: (url: string, init: { method: string; body: URLSearchParams }) => Promise<string>): Promise<(string | number)[][]>
