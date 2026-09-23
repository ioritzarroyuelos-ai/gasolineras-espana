// Esquemas zod del modelo de la vertical de política (elecciones + sondeos).
// Fuente de verdad de tipos: se infieren de estos esquemas con z.infer.
// Se validan (a) los JSON que escribe el robot antes de servirlos y (b) el
// candidato nuevo antes de pisar el último JSON bueno (validación multinivel
// en scripts/lib/politica-validacion.mjs).

import { z } from 'zod'

// Versión del esquema/forma de los datos. Bumpear solo si cambia la forma de un
// JSON ya publicado (para poder migrar/validar). No se ata a APP_VERSION.
export const POLITICA_SCHEMA_VER = 1

const iso = z.string().max(40) // fecha ISO permisiva (validación fina en el robot)

export const CandidaturaSchema = z.object({
  id: z.string().min(1).max(40),
  nombre: z.string().min(1).max(120),
  siglas: z.string().min(1).max(24),
  // El color lo asigna el render desde el catálogo (colorPartido); opcional aquí.
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color hex #rrggbb').optional(),
})

// Escaños estimados por un sondeo para una candidatura:
//  - número exacto (p.ej. 137)
//  - rango { min, max } (p.ej. 30-33)
//  - null = el sondeo no da escaños para esa candidatura ("—"), que NO es 0
export const EscanosEstimSchema = z.union([
  z.number().int().min(0).max(1000),
  z
    .object({ min: z.number().int().min(0).max(1000), max: z.number().int().min(0).max(1000) })
    .refine((r) => r.min <= r.max, { message: 'min>max' }),
  z.null(),
])

export const SondeoDatoSchema = z.object({
  candidaturaId: z.string().min(1).max(40),
  pct: z.number().min(0).max(100).nullable(), // null = no publica %
  escanos: EscanosEstimSchema,
})

export const SondeoSchema = z.object({
  empresa: z.string().min(1).max(120),
  comitente: z.string().max(120).optional(),
  campoInicio: iso.optional(),
  campoFin: iso.optional(),
  publicacion: iso.optional(),
  fechaTexto: z.string().max(60).optional(), // texto original de la fecha de campo (Wikipedia)
  muestra: z.number().int().positive().max(10_000_000).nullable().optional(),
  datos: z.array(SondeoDatoSchema).max(80),
  fuenteUrl: z.string().max(400).optional(),
})

export const ReferenciaSchema = z.object({
  fecha: iso, // ISO de la última elección celebrada
  escanos: z
    .array(z.object({ candidaturaId: z.string().min(1).max(40), escanos: z.number().int().min(0).max(1000) }))
    .max(80),
  fuente: z.string().max(200),
})

export const CamaraSchema = z.object({
  nombre: z.string().min(1).max(120),
  escanos: z.number().int().positive().max(1000),
  mayoria: z.number().int().positive().max(1000),
})

export const ProcedenciaSchema = z.object({
  wiki: z.string().max(20), // 'es' | 'en'
  articulo: z.string().max(300),
  url: z.string().max(400),
  pageid: z.number().int().optional(),
  revid: z.number().int().optional(),
  licencia: z.string().max(80),
  obtenido: iso,
})

export const TipoEleccionSchema = z.enum(['generales', 'europeas', 'autonomica'])

export const EleccionFileSchema = z.object({
  schemaVer: z.number().int(),
  id: z.string().min(1).max(40),
  tipo: TipoEleccionSchema,
  ciclo: z.string().max(40),
  camara: CamaraSchema,
  candidaturas: z.array(CandidaturaSchema).max(100),
  referencia: ReferenciaSchema,
  sondeos: z.array(SondeoSchema).max(2000), // vacío es legítimo (aún no hay sondeos)
  procedencia: ProcedenciaSchema,
})

export const EstadoEleccionSchema = z.enum(['ok', 'sin_sondeos', 'desactualizado', 'no_disponible'])

export const IndexEntrySchema = z.object({
  id: z.string().min(1).max(40),
  tipo: TipoEleccionSchema,
  nombre: z.string().min(1).max(160),
  comunidad: z.string().max(80).optional(),
  ciudadAutonoma: z.boolean().optional(),
  fecha: z.object({
    valor: iso.nullable(),
    confirmada: z.boolean(),
    fuente: z.string().max(200).optional(),
  }),
  estado: EstadoEleccionSchema,
  ultimaComprobacionOk: iso.optional(),
  ultimoContenidoModificado: iso.optional(),
  fechaUltimoSondeo: iso.nullable().optional(),
  ruta: z.string().max(120),
})

export const IndexFileSchema = z.object({
  schemaVer: z.number().int(),
  generado: iso,
  elecciones: z.array(IndexEntrySchema).min(1).max(60),
})

export type Candidatura = z.infer<typeof CandidaturaSchema>
export type EscanosEstim = z.infer<typeof EscanosEstimSchema>
export type SondeoDato = z.infer<typeof SondeoDatoSchema>
export type Sondeo = z.infer<typeof SondeoSchema>
export type Referencia = z.infer<typeof ReferenciaSchema>
export type Camara = z.infer<typeof CamaraSchema>
export type TipoEleccion = z.infer<typeof TipoEleccionSchema>
export type EleccionFile = z.infer<typeof EleccionFileSchema>
export type EstadoEleccion = z.infer<typeof EstadoEleccionSchema>
export type IndexEntry = z.infer<typeof IndexEntrySchema>
export type IndexFile = z.infer<typeof IndexFileSchema>
