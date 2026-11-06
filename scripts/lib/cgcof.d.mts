export function fechaCgcof(date?: Date): string
export function extraerFarmaciasDelHtml(html: string, fecha: string): Array<{ id: string; tipo: string }>
export function obtenerSesionYZonas(provinciaId: string, userAgent: string): Promise<{
  cookies: string; zonas: Array<{ id: string; nombre: string }>; referer: string
}>
export function fetchHtmlGuardias(provinciaId: string, zonaId: string, fecha: string, cookies: string, referer: string, userAgent: string): Promise<string>
export function fetchDatosFarmacia(provinciaId: string, farmaciaId: string, cookies: string, referer: string, userAgent: string): Promise<{
  titular: string; direccion: string; municipio: string; cp: string; telefono: string
} | null>
export function geocodeNominatim(direccion: string, municipio: string, provincia: string, bbox: {
  minLat: number; maxLat: number; minLng: number; maxLng: number
}, userAgent: string): Promise<[number, number] | null>
