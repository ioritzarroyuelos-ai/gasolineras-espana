export const ALMERIA_SOURCE: string
export function consultaAlmeria(fecha: string, readers: {
  html(url: string): Promise<string>
  json(url: string, options: RequestInit): Promise<unknown>
}): Promise<unknown>
