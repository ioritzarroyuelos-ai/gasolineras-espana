// Inspección periódica de turismos particulares. Las cifras siguen el criterio de cada fuente.
// Cada entrada distingue la fecha de revisión, la vigencia y los suplementos aplicables.
// Los territorios pendientes conservan su ficha y carecen de importes comparables.

export const TASA_DGT = 4.18
export const TASA_DGT_FUENTE = 'https://sedeclave.dgt.gob.es/WEB_Tasas/jsp/tasas/catalogo.xhtml'
export const TARIFAS_REVISADAS = '2026-11-07'
// Revisión preventiva al cambiar el año, no caducidad legal de la tasa publicada.
const TASA_DGT_REVISAR_DESDE = '2027-01-01'

export type Impuesto = 'iva21' | 'igic7' | 'ipsi9' | 'ipsi4' | 'exento'

export const FACTOR_IMPUESTO: Readonly<Record<Impuesto, number>> = {
  iva21: 1.21,
  igic7: 1.07,
  ipsi9: 1.09,
  ipsi4: 1.04,
  exento: 1,      // tasas: no se les repercute impuesto indirecto
}

export const NOMBRE_IMPUESTO: Readonly<Record<Impuesto, string>> = {
  iva21: 'IVA 21%',
  igic7: 'IGIC 7%',
  ipsi9: 'IPSI 9%',
  ipsi4: 'IPSI 4%',
  exento: 'exento (es una tasa)',
}

export interface Tarifa {
  slug: string
  nombre: string
  provincias: string[]          // slugs de src/lib/provincias.ts que cubre
  regulada: boolean
  estado: 'verificada' | 'pendiente'
  revisada: string
  tipoPrecio: 'tarifa' | 'maximo'
  vigenteHasta?: string
  alcancePrecio?: string
  condiciones?: string
  suplementos?: ReadonlyArray<{ concepto: string; importe: number; fuenteUrl?: string }>
  impuesto: Impuesto
  // Conceptos ya incluidos en la cifra guardada, que desglosa conserva al céntimo.
  incluyeImpuesto: boolean
  incluyeTasaDgt: boolean
  gasolina?: number
  diesel?: number
  norma: string
  fuenteUrl?: string
  vigencia: string
}

// Una norma sin fecha de fin también necesita volver a contrastarse con la fuente.
// El día de vencimiento se interpreta en horario peninsular, como las tarifas publicadas.
export function tarifaVigente(t: Tarifa, ahora = Date.now()): boolean {
  if (t.estado !== 'verificada' || !Number.isFinite(ahora)) return false
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(ahora)
  const antiguedad = Date.parse(hoy + 'T00:00:00Z') - Date.parse(t.revisada + 'T00:00:00Z')
  return antiguedad >= 0 && antiguedad <= 120 * 24 * 60 * 60 * 1000
    && hoy < TASA_DGT_REVISAR_DESDE
    && (!t.vigenteHasta || hoy <= t.vigenteHasta)
}

// Se conservan también los territorios cuyo precio final sigue pendiente.
export const TARIFAS: ReadonlyArray<Tarifa> = [
  {
    slug: 'andalucia', nombre: 'Andalucía',
    provincias: ['almeria', 'cadiz', 'cordoba', 'granada', 'huelva', 'jaen', 'malaga', 'sevilla'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 33.28, diesel: 38.39,
    norma: 'Resolución de 19/12/2016 de la D.G. de Industria, Energía y Minas (BOJA nº 246, 27/12/2016)',
    fuenteUrl: 'https://www.veiasa.es/itv/sobre-la-itv/tarifas',
    vigencia: 'Tarifas publicadas por VEIASA, aprobadas en diciembre de 2016',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    alcancePrecio: 'Menos de 1.600 cc, sin bonificación',
    condiciones: 'Para 1.600 cc o más, 43,52 € gasolina y 48,62 € diésel. VEIASA aplica una reducción del 10 % sobre la tarifa del servicio al realizar la inspección o reservar cita dentro del plazo legal, y un recargo del 12 % con más de un mes de retraso. La tasa DGT se conserva. Híbridos y vehículos adaptados tienen reglas propias.',
  },
  {
    slug: 'aragon', nombre: 'Aragón',
    provincias: ['huesca', 'teruel', 'zaragoza'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 49.56, diesel: 60.76,
    norma: 'Orden PEJ/1853/2025 (tarifa base 37,50 € gasolina / 46,76 € diésel, sin impuesto ni tasa)',
    vigencia: '2026',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    fuenteUrl: 'https://www.boa.aragon.es/cgi-bin/EBOA/BRSCGI?CMD=VEROBJ&MLKOB=1429100330404',
    vigenteHasta: '2026-12-31',
    alcancePrecio: 'Inspección periódica con emisiones',
    condiciones: 'Gasolina matriculada desde 1967 y diésel desde 1980. Otros vehículos y trámites tienen tarifas propias.',
  },
  {
    slug: 'asturias', nombre: 'Asturias',
    provincias: ['asturias'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 45.32, diesel: 45.32,
    norma: 'Resolución de 19/12/2025 (BOPA nº 248, 26/12/2025). Operador público ITVASA',
    fuenteUrl: 'https://sede.asturias.es/bopa/2025/12/26/2025-10695.pdf',
    vigencia: '2026',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    vigenteHasta: '2026-12-31',
    condiciones: 'Turismos particulares en ITVASA. El transporte escolar tiene otra tarifa.',
  },
  {
    slug: 'canarias', nombre: 'Canarias',
    provincias: ['las-palmas', 'santa-cruz-de-tenerife'],
    regulada: true, impuesto: 'igic7', incluyeImpuesto: false, incluyeTasaDgt: false,
    gasolina: 36.77, diesel: 45.87,
    norma: 'Resolución de 23/01/2026 de la D.G. de Industria (BOC nº 23, 04/02/2026, anuncio 343)',
    fuenteUrl: 'https://sede.gobiernodecanarias.org/boc/boc-a-2026-023-343.pdf',
    vigencia: '01/02/2026 – 31/01/2027',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'maximo',
    vigenteHasta: '2027-01-31',
    condiciones: 'Gasolina con catalizador y diésel matriculado desde el 1 de enero de 1980. Incluye el control de emisiones. La estación puede cobrar menos que el máximo.',
  },
  {
    slug: 'cantabria', nombre: 'Cantabria',
    provincias: ['cantabria'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: false,
    gasolina: 51.07, diesel: 57.80,
    norma: 'Orden IND/58/2025 (BOC nº 246, 23/12/2025)',
    vigencia: '2026',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    fuenteUrl: 'https://boc.cantabria.es/boces/verAnuncioAction.do?idAnuBlob=428844',
    vigenteHasta: '2026-12-31',
    alcancePrecio: 'Sin control de ruido adicional',
    condiciones: 'Gasolina con catalizador y diésel de hasta 3.500 kg. Si el vehículo requiere control de ruido, se añaden 9,96 € más IVA (12,05 €).',
  },
  {
    slug: 'castilla-la-mancha', nombre: 'Castilla-La Mancha',
    provincias: ['albacete', 'ciudad-real', 'cuenca', 'guadalajara', 'toledo'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: false, incluyeTasaDgt: false,
    gasolina: 32.46, diesel: 42.98,
    norma: 'Resolución de 11/12/2025 de la D.G. de Transición Energética (DOCM nº 251, 30/12/2025)',
    vigencia: '01/01/2026 – 31/12/2026',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'maximo',
    fuenteUrl: 'https://docm.jccm.es/docm/descargarArchivo.do?ruta=2025/12/30/pdf/2025_9655.pdf&tipo=rutaDocm',
    vigenteHasta: '2026-12-31',
    suplementos: [{ concepto: 'Tasa autonómica', importe: 1.04, fuenteUrl: 'https://docm.jccm.es/docm/descargarArchivo.do?ruta=2026/04/30/pdf/2026_3138.pdf&tipo=rutaDocm' }],
    condiciones: 'Gasolina con catalizador matriculada después del 1 de octubre de 1994 y diésel desde 1980. Incluye emisiones, IVA, DGT y la tasa autonómica de 1,04 €. La estación puede cobrar menos.',
  },
  {
    slug: 'castilla-y-leon', nombre: 'Castilla y León',
    provincias: ['avila', 'burgos', 'leon', 'palencia', 'salamanca', 'segovia', 'soria', 'valladolid', 'zamora'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 51.18, diesel: 60.51,
    norma: 'Resolución de 12/12/2025 (BOCYL nº 245, 22/12/2025)',
    vigencia: '2026',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    fuenteUrl: 'https://bocyl.jcyl.es/boletines/2025/12/22/pdf/BOCYL-D-22122025-24.pdf',
    vigenteHasta: '2026-12-31',
    condiciones: 'Gasolina con catalizador y diésel de hasta 3.500 kg. Incluye inspección de seguridad y emisiones.',
  },
  {
    slug: 'cataluna', nombre: 'Cataluña',
    provincias: ['barcelona', 'girona', 'lleida', 'tarragona'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 40.60, diesel: 45.59,
    norma: 'Tarifario publicado por el operador Applus+ para sus estaciones de Cataluña',
    vigencia: 'Tarifario consultado el 7 de noviembre de 2026',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    fuenteUrl: 'https://www.applusiteuve.com/es-es/la-itv/precios-itv/precio-itv-cataluna/',
    alcancePrecio: 'Tarifa publicada por Applus+',
    condiciones: 'Turismos particulares, gasolina con catalizador o diésel. Precio de Applus+ con impuestos y tasa DGT. Las promociones y los precios de otros operadores pueden variar.',
  },
  {
    slug: 'ceuta', nombre: 'Ceuta',
    provincias: ['ceuta'],
    regulada: true, impuesto: 'ipsi9', incluyeImpuesto: false, incluyeTasaDgt: false,
    norma: 'Decreto de la Consejería de Medio Ambiente de 16/01/2023 (BOCCE nº 6.271, 20/01/2023)',
    vigencia: 'Vigencia e importe final pendientes de confirmar',
    estado: 'pendiente',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    condiciones: 'Falta confirmar un tarifario final vigente que detalle el IPSI y la tasa DGT. Consulta el importe completo de tu vehículo al pedir cita.',
  },
  {
    slug: 'comunitat-valenciana', nombre: 'Comunitat Valenciana',
    provincias: ['alicante', 'castellon', 'valencia'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 41.47, diesel: 56.15,
    norma: 'Acuerdo del Consell de 25/03/2011, aplicado por la empresa pública SITVAL',
    vigencia: 'Tarifario desde 01/01/2023 publicado por SITVAL',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    fuenteUrl: 'https://sitval.com/assets/pdf/tarifas.pdf',
    condiciones: 'Turismos de gasolina con catalizador o diésel. Incluye IVA, tasa DGT y las comprobaciones indicadas en el tarifario de SITVAL.',
  },
  {
    slug: 'extremadura', nombre: 'Extremadura',
    provincias: ['badajoz', 'caceres'],
    regulada: true, impuesto: 'exento', incluyeImpuesto: true, incluyeTasaDgt: false,
    gasolina: 29.25, diesel: 29.25,
    norma: 'Resolución de 23/09/2026 de la Consejería de Hacienda (DOE nº 189, 30/09/2026), tasa 16009-0, epígrafe 1.1.1',
    vigencia: 'Tasas de 2026 publicadas por la Junta de Extremadura',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    fuenteUrl: 'https://doe.juntaex.es/pdfs/doe/2026/1890o/26062437.pdf#page=67',
    alcancePrecio: 'Estaciones de la Junta',
    condiciones: 'Esta tasa corresponde a las estaciones gestionadas por la Junta de Extremadura. Las estaciones concesionarias tienen un precio diferente.',
  },
  {
    slug: 'galicia', nombre: 'Galicia',
    provincias: ['a-coruna', 'lugo', 'ourense', 'pontevedra'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 43.76, diesel: 52.30,
    norma: 'Tarifario vigente del concesionario SYC ITV',
    vigencia: 'Tarifario consultado el 7 de noviembre de 2026',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    fuenteUrl: 'https://www.sycitv.com/es/pasar-la-itv/tarifas/',
    condiciones: 'Gasolina con catalizador y diésel matriculado después de 1980. Incluye IVA y tasa DGT.',
  },
  {
    slug: 'illes-balears-mallorca', nombre: 'Mallorca',
    provincias: [],
    regulada: true, impuesto: 'exento', incluyeImpuesto: true, incluyeTasaDgt: false,
    gasolina: 17.01, diesel: 30.92,
    norma: 'Ordenança fiscal del Consell Insular de Mallorca (BOIB nº 52, 04/04/2020)',
    vigencia: 'Ordenanza de 2020, de vigencia indefinida hasta modificación expresa',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    fuenteUrl: 'https://caib.es/eboibfront/pdf/es/2020/52/1057072',
    condiciones: 'Tasa del Consell de Mallorca más la tasa DGT. El importe diésel incluye 13,91 € de control de gases. Los suplementos de unidades móviles y los trámites especiales se calculan aparte.',
  },
  {
    slug: 'illes-balears-eivissa', nombre: 'Eivissa',
    provincias: [],
    regulada: true, impuesto: 'exento', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 32.18, diesel: 32.18,
    norma: 'Ordenanza fiscal modificada del Consell d’Eivissa (BOIB nº 106, 25/08/2026)',
    fuenteUrl: 'https://itv.conselldeivissa.es/wp-content/uploads/ordenanza.pdf',
    vigencia: 'Ordenanza publicada el 25 de agosto de 2026',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    condiciones: 'Turismos particulares de gasolina o diésel. Tasa de 28 € más 4,18 € de DGT, incluidos en el total.',
  },
  {
    slug: 'la-rioja', nombre: 'La Rioja',
    provincias: ['la-rioja'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    norma: 'Tarifa regulada por el Gobierno de La Rioja',
    vigencia: 'Importe final de 2026 pendiente de confirmar',
    estado: 'pendiente',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    fuenteUrl: 'https://www.larioja.org/industria-energia/es/industria/vehiculos',
    condiciones: 'La información oficial consultada no permite confirmar aquí el precio final vigente para ambos combustibles. Solicita el total a la estación antes de reservar.',
  },
  {
    slug: 'melilla', nombre: 'Melilla',
    provincias: ['melilla'],
    regulada: true, impuesto: 'ipsi4', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 34.40, diesel: 34.40,
    norma: 'Orden nº 2992 de 17/12/2025 (BOME nº 6337, 19/12/2025)',
    fuenteUrl: 'https://bomemelilla.es/bome/descargar/BOME-B-2025-6337.pdf',
    vigencia: 'Desde 01/01/2026',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'maximo',
    vigenteHasta: '2026-12-31',
    alcancePrecio: 'Con emisiones; diagnóstico OBD aparte',
    suplementos: [{ concepto: 'Control de emisiones, IPSI incluido', importe: 8.69 }],
    condiciones: 'El total incorpora 8,69 € de control de emisiones. Si corresponde diagnóstico por ordenador (OBD), la tarifa máxima añade 5,44 €. Confirma qué pruebas necesita tu vehículo.',
  },
  {
    slug: 'pais-vasco', nombre: 'País Vasco',
    provincias: ['alava', 'guipuzcoa', 'bizkaia'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: false,
    gasolina: 55.28, diesel: 57.74,
    norma: 'Resolución de 01/12/2025 del director de Desarrollo y Administración Industrial (BOPV nº 238, 10/12/2025)',
    fuenteUrl: 'https://www.euskadi.eus/bopv2/datos/2025/12/2505258a.pdf',
    vigencia: '01/01/2026 – 31/12/2026',
    estado: 'verificada',
    revisada: TARIFAS_REVISADAS,
    tipoPrecio: 'tarifa',
    vigenteHasta: '2026-12-31',
    condiciones: 'Turismos M1. El total incluye IVA y la tasa DGT de 4,18 €.',
  },
]

// También se muestran los territorios con precios libres o pendientes de confirmar.
export interface SinTarifa {
  nombre: string
  motivo: string
}

export const LIBERALIZADAS: ReadonlyArray<SinTarifa> = [
  {
    nombre: 'Comunidad de Madrid',
    motivo: 'El sector está liberalizado desde la Ley 7/2009: no existe tarifa oficial y cada '
      + 'estación fija su precio. Aquí sí merece la pena comparar antes de ir.',
  },
  {
    nombre: 'Región de Murcia',
    motivo: 'Sector liberalizado: no hay precio regulado y cada estación pone el suyo. '
      + 'Conviene comparar entre estaciones.',
  },
]

export const SIN_DATO: ReadonlyArray<SinTarifa> = [
  {
    nombre: 'Navarra',
    motivo: 'Pendiente de comprobar el tarifario final vigente de las estaciones de Navarra. Solicita '
      + 'el precio completo al pedir cita.',
  },
  {
    nombre: 'Menorca y Formentera',
    motivo: 'Pendiente de verificar las tarifas actuales de cada Consell. Consulta el total de tu vehículo '
      + 'antes de reservar.',
  },
]

export interface Desglose {
  base: number
  impuesto: number
  tasaDgt: number
  suplementos: ReadonlyArray<{ concepto: string; importe: number; fuenteUrl?: string }>
  total: number
}

function redondea(n: number): number {
  return Math.round(n * 100) / 100
}

// Los precios publicados con impuesto se conservan al céntimo. Volver a aplicar
// el factor a una base reconstruida puede cambiar el total oficial. La tasa DGT
// y los suplementos ya finales se suman sin volver a gravarlos.
export function desglosa(t: Tarifa, precio: number): Desglose {
  const factor = FACTOR_IMPUESTO[t.impuesto]
  const publicadoSinDgt = redondea(precio - (t.incluyeTasaDgt ? TASA_DGT : 0))
  const base = t.incluyeImpuesto ? redondea(publicadoSinDgt / factor) : publicadoSinDgt
  const conImpuesto = t.incluyeImpuesto ? publicadoSinDgt : redondea(base * factor)
  const suplementos = t.suplementos ?? []
  const extra = suplementos.reduce((suma, suplemento) => suma + suplemento.importe, 0)
  return {
    base,
    impuesto: redondea(conImpuesto - base),
    tasaDgt: TASA_DGT,
    suplementos,
    total: redondea(conImpuesto + TASA_DGT + extra),
  }
}

export function tarifaPorProvincia(provinciaSlug: string): Tarifa | null {
  return TARIFAS.find(t => t.provincias.includes(provinciaSlug)) ?? null
}
