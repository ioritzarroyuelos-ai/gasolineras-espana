// Catálogo FIJO de las 21 elecciones (generales + europeas + 17 autonómicas +
// Ceuta y Melilla) e info de partidos. Es la fuente de verdad de qué elecciones
// existen (independiente del robot: garantiza que las 19 territoriales siempre
// aparecen aunque no haya sondeos). Metadatos verificados en vivo el 2026-09-23.
//
// Notas:
// - `proxima.confirmada` = false hasta que haya decreto oficial de convocatoria.
//   Mientras sea false, NO hay veda (enVeda solo aplica a fechas confirmadas).
// - `wikiSondeos` = artículo con la tabla de sondeos de la PRÓXIMA elección, o
//   null si aún no existe (europeas 2029, y las autonómicas de elección
//   anticipada reciente: Aragón y Extremadura). Preferimos es.wikipedia cuando
//   el artículo existe en español; si no, en.wikipedia.
// - Madrid: la Asamblea amplía de 135 a 143 escaños en 2027 (mayoría 72); se usa
//   el tamaño de la próxima cámara para que la validación no rechace sondeos.

export type WikiRef = { lang: 'es' | 'en'; articulo: string }

export type EleccionCatalogo = {
  id: string
  tipo: 'generales' | 'europeas' | 'autonomica'
  nombre: string
  comunidad?: string
  ciudadAutonoma?: boolean
  camara: { nombre: string; escanos: number; mayoria: number }
  ultimaFecha: string
  proxima: { valor: string | null; confirmada: boolean }
  wikiSondeos: WikiRef | null
  wikiResultados: WikiRef
}

const es = (articulo: string): WikiRef => ({ lang: 'es', articulo })
const en = (articulo: string): WikiRef => ({ lang: 'en', articulo })

export const ELECCIONES: EleccionCatalogo[] = [
  {
    id: 'generales',
    tipo: 'generales',
    nombre: 'Elecciones generales de España',
    camara: { nombre: 'Congreso de los Diputados', escanos: 350, mayoria: 176 },
    ultimaFecha: '2023-07-23',
    proxima: { valor: null, confirmada: false },
    wikiSondeos: es('Encuestas de opinión para las próximas elecciones generales españolas'),
    wikiResultados: es('Elecciones generales de España de 2023'),
  },
  {
    id: 'europeas',
    tipo: 'europeas',
    nombre: 'Elecciones al Parlamento Europeo (España)',
    camara: { nombre: 'Parlamento Europeo (delegación española)', escanos: 61, mayoria: 31 },
    ultimaFecha: '2024-06-09',
    proxima: { valor: null, confirmada: false },
    wikiSondeos: null, // no hay artículo de sondeos de la próxima europea (2029) específico de España
    wikiResultados: es('Elecciones al Parlamento Europeo de 2024 (España)'),
  },
  {
    id: 'andalucia',
    tipo: 'autonomica',
    nombre: 'Elecciones al Parlamento de Andalucía',
    comunidad: 'Andalucía',
    camara: { nombre: 'Parlamento de Andalucía', escanos: 109, mayoria: 55 },
    ultimaFecha: '2026-05-17',
    proxima: { valor: '2030-06-16', confirmada: false },
    wikiSondeos: en('Next Andalusian regional election'),
    wikiResultados: es('Elecciones al Parlamento de Andalucía de 2026'),
  },
  {
    id: 'cataluna',
    tipo: 'autonomica',
    nombre: 'Elecciones al Parlamento de Cataluña',
    comunidad: 'Cataluña',
    camara: { nombre: 'Parlamento de Cataluña', escanos: 135, mayoria: 68 },
    ultimaFecha: '2024-05-12',
    proxima: { valor: '2028-06-26', confirmada: false },
    wikiSondeos: es('Elecciones al Parlamento de Cataluña de 2028'),
    wikiResultados: es('Elecciones al Parlamento de Cataluña de 2024'),
  },
  {
    id: 'madrid',
    tipo: 'autonomica',
    nombre: 'Elecciones a la Asamblea de Madrid',
    comunidad: 'Comunidad de Madrid',
    camara: { nombre: 'Asamblea de Madrid', escanos: 143, mayoria: 72 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('2027 Madrilenian regional election'),
    wikiResultados: es('Elecciones a la Asamblea de Madrid de 2023'),
  },
  {
    id: 'comunidad-valenciana',
    tipo: 'autonomica',
    nombre: 'Elecciones a las Cortes Valencianas',
    comunidad: 'Comunidad Valenciana',
    camara: { nombre: 'Cortes Valencianas', escanos: 99, mayoria: 50 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('Next Valencian regional election'),
    wikiResultados: es('Elecciones a las Cortes Valencianas de 2023'),
  },
  {
    id: 'galicia',
    tipo: 'autonomica',
    nombre: 'Elecciones al Parlamento de Galicia',
    comunidad: 'Galicia',
    camara: { nombre: 'Parlamento de Galicia', escanos: 75, mayoria: 38 },
    ultimaFecha: '2024-02-18',
    proxima: { valor: '2028-03-25', confirmada: false },
    wikiSondeos: en('Next Galician regional election'),
    wikiResultados: es('Elecciones al Parlamento de Galicia de 2024'),
  },
  {
    id: 'castilla-y-leon',
    tipo: 'autonomica',
    nombre: 'Elecciones a las Cortes de Castilla y León',
    comunidad: 'Castilla y León',
    camara: { nombre: 'Cortes de Castilla y León', escanos: 82, mayoria: 42 },
    ultimaFecha: '2026-03-15',
    proxima: { valor: '2030-04-14', confirmada: false },
    wikiSondeos: en('Next Castilian-Leonese regional election'),
    wikiResultados: es('Elecciones a las Cortes de Castilla y León de 2026'),
  },
  {
    id: 'pais-vasco',
    tipo: 'autonomica',
    nombre: 'Elecciones al Parlamento Vasco',
    comunidad: 'País Vasco',
    camara: { nombre: 'Parlamento Vasco', escanos: 75, mayoria: 38 },
    ultimaFecha: '2024-04-21',
    proxima: { valor: '2028-05-21', confirmada: false },
    wikiSondeos: en('Next Basque regional election'),
    wikiResultados: es('Elecciones al Parlamento Vasco de 2024'),
  },
  {
    id: 'castilla-la-mancha',
    tipo: 'autonomica',
    nombre: 'Elecciones a las Cortes de Castilla-La Mancha',
    comunidad: 'Castilla-La Mancha',
    camara: { nombre: 'Cortes de Castilla-La Mancha', escanos: 33, mayoria: 17 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('2027 Castilian-Manchegan regional election'),
    wikiResultados: es('Elecciones a las Cortes de Castilla-La Mancha de 2023'),
  },
  {
    id: 'aragon',
    tipo: 'autonomica',
    nombre: 'Elecciones a las Cortes de Aragón',
    comunidad: 'Aragón',
    camara: { nombre: 'Cortes de Aragón', escanos: 67, mayoria: 34 },
    ultimaFecha: '2026-02-08',
    proxima: { valor: null, confirmada: false },
    wikiSondeos: null, // elección anticipada reciente; sin artículo de sondeos de la próxima
    wikiResultados: es('Elecciones a las Cortes de Aragón de 2026'),
  },
  {
    id: 'canarias',
    tipo: 'autonomica',
    nombre: 'Elecciones al Parlamento de Canarias',
    comunidad: 'Canarias',
    camara: { nombre: 'Parlamento de Canarias', escanos: 70, mayoria: 36 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('Next Canarian regional election'),
    wikiResultados: es('Elecciones al Parlamento de Canarias de 2023'),
  },
  {
    id: 'illes-balears',
    tipo: 'autonomica',
    nombre: 'Elecciones al Parlamento de las Islas Baleares',
    comunidad: 'Islas Baleares',
    camara: { nombre: 'Parlamento de las Islas Baleares', escanos: 59, mayoria: 30 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('Next Balearic regional election'),
    wikiResultados: es('Elecciones al Parlamento de las Islas Baleares de 2023'),
  },
  {
    id: 'murcia',
    tipo: 'autonomica',
    nombre: 'Elecciones a la Asamblea Regional de Murcia',
    comunidad: 'Región de Murcia',
    camara: { nombre: 'Asamblea Regional de Murcia', escanos: 45, mayoria: 23 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('2027 Murcian regional election'),
    wikiResultados: es('Elecciones a la Asamblea Regional de Murcia de 2023'),
  },
  {
    id: 'extremadura',
    tipo: 'autonomica',
    nombre: 'Elecciones a la Asamblea de Extremadura',
    comunidad: 'Extremadura',
    camara: { nombre: 'Asamblea de Extremadura', escanos: 65, mayoria: 33 },
    ultimaFecha: '2025-12-21',
    proxima: { valor: null, confirmada: false },
    wikiSondeos: null, // elección anticipada reciente; sin artículo de sondeos de la próxima
    wikiResultados: es('Elecciones a la Asamblea de Extremadura de 2025'),
  },
  {
    id: 'asturias',
    tipo: 'autonomica',
    nombre: 'Elecciones a la Junta General del Principado de Asturias',
    comunidad: 'Asturias',
    camara: { nombre: 'Junta General del Principado de Asturias', escanos: 45, mayoria: 23 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: es('Elecciones a la Junta General del Principado de Asturias de 2027'),
    wikiResultados: es('Elecciones a la Junta General del Principado de Asturias de 2023'),
  },
  {
    id: 'navarra',
    tipo: 'autonomica',
    nombre: 'Elecciones al Parlamento de Navarra',
    comunidad: 'Navarra',
    camara: { nombre: 'Parlamento de Navarra', escanos: 50, mayoria: 26 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('2027 Navarrese regional election'),
    wikiResultados: es('Elecciones al Parlamento de Navarra de 2023'),
  },
  {
    id: 'cantabria',
    tipo: 'autonomica',
    nombre: 'Elecciones al Parlamento de Cantabria',
    comunidad: 'Cantabria',
    camara: { nombre: 'Parlamento de Cantabria', escanos: 35, mayoria: 18 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('2027 Cantabrian regional election'),
    wikiResultados: es('Elecciones al Parlamento de Cantabria de 2023'),
  },
  {
    id: 'la-rioja',
    tipo: 'autonomica',
    nombre: 'Elecciones al Parlamento de La Rioja',
    comunidad: 'La Rioja',
    camara: { nombre: 'Parlamento de La Rioja', escanos: 33, mayoria: 17 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('2027 Riojan regional election'),
    wikiResultados: es('Elecciones al Parlamento de La Rioja de 2023'),
  },
  {
    id: 'ceuta',
    tipo: 'autonomica',
    nombre: 'Elecciones a la Asamblea de Ceuta',
    comunidad: 'Ceuta',
    ciudadAutonoma: true,
    camara: { nombre: 'Asamblea de Ceuta', escanos: 25, mayoria: 13 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('2027 Ceuta Assembly election'),
    wikiResultados: es('Elecciones a la Asamblea de Ceuta de 2023'),
  },
  {
    id: 'melilla',
    tipo: 'autonomica',
    nombre: 'Elecciones a la Asamblea de Melilla',
    comunidad: 'Melilla',
    ciudadAutonoma: true,
    camara: { nombre: 'Asamblea de Melilla', escanos: 25, mayoria: 13 },
    ultimaFecha: '2023-05-28',
    proxima: { valor: '2027-05-23', confirmada: false },
    wikiSondeos: en('2027 Melilla Assembly election'),
    wikiResultados: es('Elecciones a la Asamblea de Melilla de 2023'),
  },
]

export function eleccionPorId(id: string): EleccionCatalogo | undefined {
  return ELECCIONES.find((e) => e.id === id)
}

// Colores de marca de los partidos, por siglas normalizadas. La lista de
// candidaturas de cada elección la produce el parser desde la tabla; aquí solo
// asignamos color (con degradado por defecto para los que no estén mapeados).
const COLORES: Record<string, string> = {
  PP: '#1d6fb8',
  PSOE: '#e30613',
  'PSC': '#e30613',
  'PSDEG': '#e30613',
  'PSPV': '#e30613',
  'PSE': '#e30613',
  'PSOEA': '#e30613',
  VOX: '#5ac035',
  SUMAR: '#e5007d',
  PODEMOS: '#692c63',
  UP: '#692c63',
  'UNIDASPODEMOS': '#692c63',
  ERC: '#f6be00',
  JUNTS: '#00c3b2',
  EHBILDU: '#8fb63c',
  BILDU: '#8fb63c',
  PNV: '#009b48',
  EAJPNV: '#009b48',
  BNG: '#99badd',
  CC: '#ffd700',
  CCA: '#ffd700',
  UPN: '#0369a3',
  MM: '#00b0aa',
  'MASMADRID': '#00b0aa',
  'MASPAIS': '#00b0aa',
  COMPROMIS: '#e94e1b',
  PRC: '#00a650',
  CUP: '#fcdd09',
  CS: '#eb6109',
  SALF: '#222b6d',
  UPL: '#b41f2e',
}

const DEFECTO = '#8a8f98'

// Normaliza siglas para el lookup de color (quita acentos, signos y espacios).
export function normSiglas(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function colorPartido(siglas: string): string {
  return COLORES[normSiglas(siglas)] || DEFECTO
}
