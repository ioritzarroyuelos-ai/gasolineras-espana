// Esquemas zod para validar payloads externos en la frontera del servidor.
// Si el Ministerio cambia silenciosamente un campo (ha pasado), el parseo falla
// y logueamos 'ministry.schema_drift' en vez de propagar datos basura al UI.
//
// La estrategia es .safeParse + log + fallback a snapshot — nunca fail-closed
// con 500 al usuario, pero tampoco fail-open con datos sospechosos.

import { z } from 'zod'

// El Ministerio mezcla mayusculas raras y comas decimales en los precios.
// Usamos strings permisivos (recortando longitud maxima para evitar DoS de memoria
// por campos gigantes inyectados) y validadores laxos.

const str = (maxLen = 200) => z.string().max(maxLen)

// M2: versión del esquema/forma de los datos. Se usa para versionar las claves de
// caché PERSISTENTE (Cloudflare Cache API, que sobrevive entre deploys dentro de un
// colo). Bumpear SOLO cuando cambie la forma de un dato cacheado (Prediccion del
// tiempo, geocode). NO se ata a APP_VERSION para no invalidar la CF cache en cada
// release. Las cachés en memoria (LRU) no lo necesitan: se vacían en cada cold start.
export const DATA_SCHEMA_VER = 1

// Un registro de estacion viene con ~30 campos. Validamos los que usa la app.
// El resto pasa por .passthrough() para no fallar si anaden metadatos nuevos.
export const StationSchema = z.object({
  IDEESS:        str(10),   // M2: identidad requerida (la app la necesita); sin ella = registro corrupto
  IDProvincia:   str(5).optional(),
  IDMunicipio:   str(6).optional(),
  Provincia:     str(80).optional(),
  Municipio:     str(120).optional(),
  Localidad:     str(120).optional(),
  'Código Postal': str(10).optional(),
  Direccion:     str(200).optional(),
  Horario:       str(200).optional(),
  Rotulo:        str(120).optional(),
  Margen:        str(8).optional(),
  Latitud:       str(32).optional(),
  'Longitud (WGS84)': str(32).optional(),
  Longitud:      str(32).optional(),
  // Precios: todos opcionales. El Ministerio los envia como string "1,549" o
  // vacio. Los parseamos en cliente con Number(s.replace(',', '.')).
  'Precio Gasolina 95 E5':    str(12).optional(),
  'Precio Gasolina 98 E5':    str(12).optional(),
  'Precio Gasoleo A':         str(12).optional(),
  'Precio Gasoleo Premium':   str(12).optional(),
  'Precio Gases licuados del petroleo': str(12).optional(),
  'Precio Gas Natural Comprimido':      str(12).optional(),
  'Precio Gas Natural Licuado':         str(12).optional(),
  'Precio Hidrogeno':         str(12).optional(),
  'Precio Diesel Renovable':  str(12).optional(),
}).passthrough()

export const MinistryResponseSchema = z.object({
  Fecha: str(40).optional(),
  ListaEESSPrecio: z.array(StationSchema).min(1).max(20000),  // cap defensivo; min(1): 0 estaciones = drift → fallback
}).passthrough()

export const MunicipioSchema = z.object({
  IDMunicipio: str(6),
  Municipio:   str(120),
  IDProvincia: str(5),
}).passthrough()

export const MunicipioListSchema = z.array(MunicipioSchema).min(1).max(1500)  // min(1): lista vacía = respuesta corrupta

export const ProvinciaSchema = z.object({
  IDPovincia:  str(5).optional(),   // typo historico del Ministerio
  IDProvincia: str(5).optional(),
  Provincia:   str(80),
}).passthrough()

export const ProvinciaListSchema = z.array(ProvinciaSchema).min(1).max(80)  // min(1): 0 provincias = respuesta corrupta

// Resultado de safeParse encapsulado con telemetria
export type ParseResult<T> =
  | { ok: true; data: T; issues?: undefined }
  | { ok: false; data?: undefined; issues: string[] }

// Usamos z.ZodTypeAny en lugar de z.ZodType<T> porque el call-site mezcla
// esquemas heterogeneos (schemaFor devuelve una union) y la inferencia de T
// colapsa a una interseccion vacia. Aqui no necesitamos el tipo del output:
// el caller usa solo el flag .ok para decidir fail-open vs fallback.
export function safeValidate<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
): ParseResult<z.infer<S>> {
  const r = schema.safeParse(raw)
  if (r.success) return { ok: true, data: r.data as z.infer<S> }
  const issues = r.error.issues.slice(0, 5).map(i =>
    i.path.join('.') + ': ' + i.message
  )
  return { ok: false, issues }
}
