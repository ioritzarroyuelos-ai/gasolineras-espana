// Tarifas oficiales de la ITV por territorio.
//
// COMO SE HA CONSTRUIDO ESTO
// Cada cifra viene de un boletin oficial autonomico o del operador que presta el
// servicio, y ha pasado por un segundo verificador con fuente independiente. Las
// que no superaron esa doble comprobacion NO estan aqui: es preferible una
// comunidad ausente a un precio inventado sobre algo que la gente va a pagar.
//
// POR QUE NO VALE "PRECIO + 21%"
// Hay CUATRO regimenes fiscales distintos y dos territorios donde la ITV es una
// TASA y no lleva impuesto indirecto ninguno:
//   - IVA 21%  peninsula, Baleares, Pais Vasco y Navarra (territorio IVA)
//   - IGIC 7%  Canarias
//   - IPSI 9%  Ceuta   (epigrafe IAE 843.6, Agrupacion 84, fuera del Anexo 3)
//   - IPSI 4%  Melilla (tipo general de servicios)
//   - exento   Extremadura y los Consells de Balears: son tasas, no precios
//
// Y la tasa de la DGT (4,18 € en 2026) se suma DESPUES del impuesto y nunca
// lleva impuesto: la estacion actua como sustituto del contribuyente y la
// repercute como suplido (Orden INT/229/2021, art. 2).
//
// El lio de verdad es que cada fuente publica con un criterio distinto: Canarias
// publica sin impuesto ni tasa, Melilla publica con todo dentro, y Eivissa
// incluye la tasa pero Mallorca no. Por eso cada entrada lleva sus dos flags
// propios en vez de deducirlos del territorio.

export const TASA_DGT = 4.18

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
  impuesto: Impuesto
  // Criterio con el que la FUENTE publica sus cifras. No se deduce del
  // territorio: dos islas de Balears lo hacen distinto.
  incluyeImpuesto: boolean
  incluyeTasaDgt: boolean
  gasolina?: number
  diesel?: number
  norma: string
  fuenteUrl?: string
  vigencia: string
  // 'alta'  = boletin oficial + segunda fuente independiente al centimo
  // 'media' = cifra correcta pero con un matiz relevante que se avisa al usuario
  fiabilidad: 'alta' | 'media'
  nota?: string
}

// Ordenadas por nombre. Solo territorios con cifra verificada; los que no
// superaron la verificacion se listan en SIN_DATO mas abajo.
export const TARIFAS: ReadonlyArray<Tarifa> = [
  {
    slug: 'andalucia', nombre: 'Andalucía',
    provincias: ['almeria', 'cadiz', 'cordoba', 'granada', 'huelva', 'jaen', 'malaga', 'sevilla'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 33.28, diesel: 38.39,
    norma: 'Resolución de 19/12/2016 de la D.G. de Industria, Energía y Minas (BOJA nº 246, 27/12/2016)',
    fuenteUrl: 'https://www.veiasa.es/itv/tarifas',
    vigencia: 'Desde 01/01/2017, sin cambios a fecha de hoy',
    fiabilidad: 'alta',
    nota: 'Andalucía cobra por cilindrada: estos importes son para turismos de menos de 1.600 cc. '
      + 'A partir de 1.600 cc son 43,52 € (gasolina) y 48,62 € (diésel).',
  },
  {
    slug: 'aragon', nombre: 'Aragón',
    provincias: ['huesca', 'teruel', 'zaragoza'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 49.56, diesel: 60.76,
    norma: 'Orden PEJ/1853/2025 (tarifa base 37,50 € gasolina / 46,76 € diésel, sin impuesto ni tasa)',
    vigencia: '2026',
    fiabilidad: 'alta',
  },
  {
    slug: 'asturias', nombre: 'Asturias',
    provincias: ['asturias'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 45.32, diesel: 45.32,
    norma: 'Resolución de 19/12/2025 (BOPA nº 248, 26/12/2025). Operador público ITVASA',
    fuenteUrl: 'https://www.itvasa.es/categoriaM.php',
    vigencia: '2026',
    fiabilidad: 'alta',
    nota: 'Asturias cobra lo mismo por gasolina y diésel.',
  },
  {
    slug: 'canarias', nombre: 'Canarias',
    provincias: ['las-palmas', 'santa-cruz-de-tenerife'],
    regulada: true, impuesto: 'igic7', incluyeImpuesto: false, incluyeTasaDgt: false,
    gasolina: 36.77, diesel: 45.87,
    norma: 'Resolución de 23/01/2026 de la D.G. de Industria (BOC nº 23, 04/02/2026, anuncio 343)',
    fuenteUrl: 'https://sede.gobiernocanarias.org/boc/boc-a-2026-023-343.pdf',
    vigencia: '01/02/2026 – 31/01/2027',
    fiabilidad: 'alta',
    nota: 'En Canarias no se aplica IVA sino IGIC. La propia resolución advierte de que sus '
      + 'importes no incluyen ni el IGIC ni la tasa de Tráfico.',
  },
  {
    slug: 'cantabria', nombre: 'Cantabria',
    provincias: ['cantabria'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: false,
    gasolina: 51.07, diesel: 57.80,
    norma: 'Orden IND/58/2025 (BOC nº 246, 23/12/2025)',
    vigencia: '2026',
    fiabilidad: 'alta',
  },
  {
    slug: 'castilla-la-mancha', nombre: 'Castilla-La Mancha',
    provincias: ['albacete', 'ciudad-real', 'cuenca', 'guadalajara', 'toledo'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: false, incluyeTasaDgt: false,
    gasolina: 32.46, diesel: 42.98,
    norma: 'Resolución de 11/12/2025 de la D.G. de Transición Energética (DOCM nº 251, 30/12/2025)',
    vigencia: '01/01/2026 – 31/12/2026',
    fiabilidad: 'media',
    nota: 'Son tarifas máximas. Además, la comunidad repercute una tasa autonómica propia de unos '
      + '1,04 € que puede alterar el total en algunos céntimos.',
  },
  {
    slug: 'castilla-y-leon', nombre: 'Castilla y León',
    provincias: ['avila', 'burgos', 'leon', 'palencia', 'salamanca', 'segovia', 'soria', 'valladolid', 'zamora'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 51.18, diesel: 60.51,
    norma: 'Resolución de 12/12/2025 (BOCYL nº 245, 22/12/2025)',
    vigencia: '2026',
    fiabilidad: 'alta',
  },
  {
    slug: 'cataluna', nombre: 'Cataluña',
    provincias: ['barcelona', 'girona', 'lleida', 'tarragona'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 40.60, diesel: 45.59,
    norma: 'Tarifas máximas reguladas por la Generalitat de Catalunya',
    vigencia: '2026',
    fiabilidad: 'alta',
    nota: 'Son precios máximos: hay operadores que cobran menos. Hay un anteproyecto de '
      + 'liberalización aprobado en julio de 2026 y pendiente de votación.',
  },
  {
    slug: 'ceuta', nombre: 'Ceuta',
    provincias: ['ceuta'],
    regulada: true, impuesto: 'ipsi9', incluyeImpuesto: false, incluyeTasaDgt: false,
    gasolina: 46.00, diesel: 54.57,
    norma: 'Decreto de la Consejería de Medio Ambiente de 16/01/2023 (BOCCE nº 6.271, 20/01/2023)',
    vigencia: 'Desde 01/01/2023, congelada hasta 2026',
    fiabilidad: 'media',
    nota: 'En Ceuta no se aplica IVA sino IPSI. El tipo del 9% se deduce de la ordenanza fiscal '
      + '(epígrafe 843.6 del IAE) y cuadra al céntimo con los precios finales publicados, pero no '
      + 'consta en un boletín con esas palabras.',
  },
  {
    slug: 'comunitat-valenciana', nombre: 'Comunitat Valenciana',
    provincias: ['alicante', 'castellon', 'valencia'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 41.47, diesel: 56.15,
    norma: 'Acuerdo del Consell de 25/03/2011, aplicado por la empresa pública SITVAL',
    vigencia: 'Vigente en 2026',
    fiabilidad: 'alta',
  },
  {
    slug: 'extremadura', nombre: 'Extremadura',
    provincias: ['badajoz', 'caceres'],
    regulada: true, impuesto: 'exento', incluyeImpuesto: true, incluyeTasaDgt: false,
    gasolina: 29.25, diesel: 29.25,
    norma: 'Tasa publicada en el DOE',
    vigencia: '2026',
    fiabilidad: 'media',
    nota: 'En Extremadura la ITV pública es una TASA y no lleva IVA. Ojo: la red es mixta, y en las '
      + 'estaciones privadas concesionarias el precio es distinto y más alto.',
  },
  {
    slug: 'galicia', nombre: 'Galicia',
    provincias: ['a-coruna', 'lugo', 'ourense', 'pontevedra'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 43.76, diesel: 52.30,
    norma: 'Tarifa del contrato de concesión, con revisión anual por IPC',
    vigencia: 'Revisión de febrero de 2026',
    fiabilidad: 'media',
    nota: 'No hay una orden en el DOG que fije estas tarifas: salen del contrato de concesión, '
      + 'y se han contrastado con la web del concesionario.',
  },
  {
    slug: 'illes-balears-mallorca', nombre: 'Mallorca',
    provincias: [],
    regulada: true, impuesto: 'exento', incluyeImpuesto: true, incluyeTasaDgt: false,
    gasolina: 17.01, diesel: 30.92,
    norma: 'Ordenança fiscal del Consell Insular de Mallorca (BOIB nº 52, 04/04/2020)',
    vigencia: 'Vigente en 2026',
    fiabilidad: 'alta',
    nota: 'En Balears la ITV es una TASA de cada Consell Insular, así que no lleva IVA. '
      + 'La tasa de Tráfico se suma aparte.',
  },
  {
    slug: 'illes-balears-eivissa', nombre: 'Eivissa',
    provincias: [],
    regulada: true, impuesto: 'exento', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 24.18, diesel: 32.18,
    norma: 'Ordenança fiscal del Consell d\'Eivissa',
    fuenteUrl: 'https://itv.conselldeivissa.es/ca/tarifes/',
    vigencia: 'Vigente en 2026',
    fiabilidad: 'alta',
    nota: 'A diferencia de Mallorca, Eivissa publica los precios con la tasa de Tráfico ya incluida.',
  },
  {
    slug: 'la-rioja', nombre: 'La Rioja',
    provincias: ['la-rioja'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 41.80,
    norma: 'Tarifa regulada por el Gobierno de La Rioja',
    vigencia: '2026',
    fiabilidad: 'media',
    nota: 'Solo se publica el precio de gasolina: las fuentes consultadas no coinciden en el importe '
      + 'del diésel y no se ha podido abrir el boletín oficial para dirimirlo.',
  },
  {
    slug: 'melilla', nombre: 'Melilla',
    provincias: ['melilla'],
    regulada: true, impuesto: 'ipsi4', incluyeImpuesto: true, incluyeTasaDgt: true,
    gasolina: 34.40, diesel: 34.40,
    norma: 'Orden nº 2992 de 17/12/2025 (BOME nº 6337, 19/12/2025)',
    fuenteUrl: 'https://bomemelilla.es/bome/descargar/BOME-B-2025-6337.pdf',
    vigencia: 'Desde 01/01/2026',
    fiabilidad: 'alta',
    nota: 'En Melilla no se aplica IVA sino IPSI. El control de emisiones se factura aparte '
      + '(8,69 €), así que un turismo suele pagar unos 43,09 € en total.',
  },
  {
    slug: 'pais-vasco', nombre: 'País Vasco',
    provincias: ['alava', 'guipuzcoa', 'bizkaia'],
    regulada: true, impuesto: 'iva21', incluyeImpuesto: true, incluyeTasaDgt: false,
    gasolina: 55.28, diesel: 57.74,
    norma: 'Resolución de 01/12/2025 del director de Desarrollo y Administración Industrial (BOPV nº 238, 10/12/2025)',
    fuenteUrl: 'https://www.euskadi.eus/bopv2/datos/2025/12/2505258a.pdf',
    vigencia: '01/01/2026 – 31/12/2026',
    fiabilidad: 'alta',
  },
]

// Territorios sin tarifa oficial que publicar, y el motivo. Se muestran en la
// pagina: saber que en Madrid conviene comparar entre estaciones es informacion
// util, no un hueco.
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
    motivo: 'La tarifa se actualiza automáticamente por IPC sin publicarse cada año en el Boletín '
      + 'Oficial de Navarra, así que no hay cifra oficial de 2026 que citar.',
  },
  {
    nombre: 'Menorca y Formentera',
    motivo: 'La ordenanza accesible de Menorca es de 2002 y la concesión está en relicitación. '
      + 'De Formentera no se ha localizado tarifario oficial.',
  },
]

export interface Desglose {
  base: number
  impuesto: number
  tasaDgt: number
  total: number
}

function redondea(n: number): number {
  return Math.round(n * 100) / 100
}

// Descompone la cifra publicada en base + impuesto + tasa, sea cual sea el
// criterio con el que la fuente la publique. La tasa se suma SIEMPRE despues del
// impuesto: nunca (base + tasa) * factor.
export function desglosa(t: Tarifa, precio: number): Desglose {
  const factor = FACTOR_IMPUESTO[t.impuesto]

  // Si la cifra publicada lo lleva todo dentro, se va quitando hacia atras.
  let base = precio
  if (t.incluyeTasaDgt) base -= TASA_DGT
  if (t.incluyeImpuesto) base = base / factor

  base = redondea(base)
  const conImpuesto = redondea(base * factor)
  return {
    base,
    impuesto: redondea(conImpuesto - base),
    tasaDgt: TASA_DGT,
    total: redondea(conImpuesto + TASA_DGT),
  }
}

export function tarifaPorProvincia(provinciaSlug: string): Tarifa | null {
  return TARIFAS.find(t => t.provincias.includes(provinciaSlug)) ?? null
}
