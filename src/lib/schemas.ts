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

// Un registro de estacion viene con ~30 campos. Validamos los que usa la app.
// El resto pasa por .passthrough() para no fallar si anaden metadatos nuevos.
export const StationSchema = z.object({
  IDEESS:        str(10).optional(),
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
  ListaEESSPrecio: z.array(StationSchema).max(20000),  // cap defensivo
}).passthrough()

export const MunicipioSchema = z.object({
  IDMunicipio: str(6),
  Municipio:   str(120),
  IDProvincia: str(5),
}).passthrough()

export const MunicipioListSchema = z.array(MunicipioSchema).max(1500)

export const ProvinciaSchema = z.object({
  IDPovincia:  str(5).optional(),   // typo historico del Ministerio
  IDProvincia: str(5).optional(),
  Provincia:   str(80),
}).passthrough()

export const ProvinciaListSchema = z.array(ProvinciaSchema).max(80)

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
