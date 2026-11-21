export type FuentePublicaId = 'refugios-cataluna' | 'salas-estudio-madrid'
export interface DefinicionFuentePublica { id: FuentePublicaId; nombre: string; categoria: 'refugios-climaticos' | 'salas-estudio'; fuenteUrl: string; datosUrl: string; metaUrl: string; licenciaUrl: string; atribucion: string; min: number; max: number; maxBytes: number }
export interface ServicioPublico {
  id: string; nombre: string; categoria: 'refugios-climaticos' | 'salas-estudio'; lat: number | null; lon: number | null;
  direccion: string | null; municipio: string; cp: string | null; web: string | null; horarioTexto: string | null;
  /** Fecha literal sin zona horaria de la ficha, o null cuando no se publica. */
  fechaFicha: string | null; accesibilidad: 'si' | 'no' | 'limitado' | 'desconocido'; accesibilidadTexto: string | null;
  tipo: string | null; aguaPotable: boolean | null; lavabos: boolean | null; climatizacion: boolean | null; descanso: boolean | null;
}
export interface FuentePublica { schema: 1; id: FuentePublicaId; nombre: string; consultado: string; fechaDatos: string; fuenteUrl: string; datosUrl: string; licenciaUrl: string; atribucion: string; total: number; conCoordenadas: number; sinCoordenadas: number; avisos: string[]; items: ServicioPublico[] }
export interface EstadoFuentePublica { id: FuentePublicaId; nombre: string; estado: 'actual' | 'conservada' | 'error'; ultimoExito: string | null; fechaDatos: string | null; total: number; bytes: number; sha256: string | null; manifestBytes: number; manifestSha256: string | null; error?: string }
export interface DescriptorPublico { archivo: string; total: number; bytes: number; sha256: string }
export interface DescriptorIdentidadesPublicas extends DescriptorPublico { desde: string; hasta: string }
export type ReferenciaPublica = [id: string, pagina: number, posicion: number]
export interface ManifestPublicos extends Omit<FuentePublica, 'items'> { version: string; listas: DescriptorPublico[]; mapa: Record<string, DescriptorPublico[]>; busqueda: DescriptorPublico; identidades?: DescriptorIdentidadesPublicas[] }
/** Texto normalizado. Su posición corresponde al listado concatenado usando descriptor.total de cada página. */
export type FilaBusquedaPublica = string
export interface IndicePublicos { schema: 1; consultado: string; fuentes: EstadoFuentePublica[] }
export const SERVICIOS_PUBLICOS_FUENTES: readonly Readonly<DefinicionFuentePublica>[]
export const SERVICIOS_PUBLICOS_MAX_SNAPSHOT_BYTES: number
export const SERVICIOS_PUBLICOS_MAX_MANIFEST_BYTES: number
export const SERVICIOS_PUBLICOS_MAX_SHARD_BYTES: number
export const SERVICIOS_PUBLICOS_MAX_BUSQUEDA_BYTES: number
export const SERVICIOS_PUBLICOS_LISTA_FILAS: number
export const SERVICIOS_PUBLICOS_MAPA_FILAS: number
export const SERVICIOS_PUBLICOS_IDENTIDADES_FILAS: number
export const SERVICIOS_PUBLICOS_MAX_IDENTIDADES_BYTES: number
export function identidadPublicaValida(id: unknown, fuenteId: FuentePublicaId): boolean
export function validaIdentidadesPublicas(rows: unknown, manifest: ManifestPublicos, descriptor: DescriptorIdentidadesPublicas): ReferenciaPublica[]
export function coordenadasPublicas(id: string, lat: unknown, lon: unknown): boolean
export function normalizaRefugios(rows: unknown, fechaDatos: string, now?: number): Promise<FuentePublica>
export function normalizaSalasMadrid(data: unknown, fechaDatos: string, now?: number): FuentePublica
export function validaServicioPublico(item: unknown, fuenteId: FuentePublicaId, now?: number): ServicioPublico
export function validaFuentePublica(data: unknown, now?: number): FuentePublica
export function validaIndicePublicos(data: unknown, now?: number): IndicePublicos
export function validaManifestPublicos(data: unknown, now?: number): ManifestPublicos
export function validaBusquedaPublicos(data: unknown, manifest: ManifestPublicos): FilaBusquedaPublica[]
export function normalizaBusquedaPublica(value: string): string
export function leeJsonPublico(raw: string): unknown
