type Guardia = [number, number, string, string, string, string, string, string, string?, string?]
export function parseGuardiasBizkaia(html: string, fecha: string, municipio?: string): Guardia[]
export function urlGuardiasBizkaia(fecha: string, municipio?: string): string
export function municipiosGuardiasBizkaia(html: string): Array<{ id: string; nombre: string }>
export function recogerGuardiasBizkaia(fecha: string, opciones?: { descargarHtml?: (url: string) => Promise<string>; esperar?: (ms: number) => Promise<void> }): Promise<{
  filas: Guardia[]; url: string; municipios: number; sinResultados: Array<{ id: string; nombre: string }>
}>
