// Excepciones históricas: dos actas públicas escaneadas sin capa de texto.
// Transcripción contrastada con la imagen completa y los dorsales/nombres del
// FP1 de la misma ronda. El hash exige los mismos bytes en cada descarga: una
// revisión del acta NO hereda esta tabla ni recibe una fecha nueva. No es OCR
// automático: otros escaneados necesitan revisión antes de añadirlos aquí.
const documentos = [
  {
    url: 'https://spain.tcr-series.com/docs/2026/r2-paul-ricard/resultados/Final%20Results%20Race%201.pdf',
    hash: 'e03f08ad8ea4028de61948ed7d635cede509a5000ef13f933ec5b8f9de9498ed',
    sesion: 'Carrera 1', ano: 2026,
    contraste: 'https://spain.tcr-series.com/docs/2026/r2-paul-ricard/resultados/Le%20Castellet%20-%20TCR%20Spain%20-%20Free%20Practice%201%20-%20Final%20ranking.pdf',
    filas: [
      [1, 29, 'HERRERO Matéo'], [2, 19, 'FERNANDEZ Felipe'], [3, 10, 'ANDERSSON Viktor'], [4, 81, 'ZABALA Erik'],
      [5, 38, 'PUSSIER Tom'], [6, 11, 'FONTAN Busian'], [7, 115, 'SARGEANT Luke'], [8, 41, 'POVLSEN Rene'],
      [9, 131, 'CASALONGA Mathieu'], [10, 33, 'CHALIGNE Samuel'], [11, 5, 'ERÖGE Demir'],
      [12, 237, 'PIIRIMÄGI Sten-Dorian', 'No clasificado'], [13, 27, 'FERNANDES Manuel', 'No clasificado'], [14, 73, 'FERNANDEZ Victor', 'No clasificado'],
    ],
  },
  {
    url: 'https://spain.tcr-series.com/docs/2026/r3-ricardo-tormo/TCR%20Spain%20-%20Final%20Result%20Race%202.pdf',
    hash: '7d7b094bca976ce1bb9b7a82863d987dc472ce4095a735d7dc3a5c1603d6f89f',
    sesion: 'Carrera 2', ano: 2026,
    contraste: 'https://spain.tcr-series.com/docs/2026/r3-ricardo-tormo/TCR%20Spain%20-%20Free%20Practice%201.pdf',
    filas: [
      [1, 10, 'Viktor Andersson'], [2, 419, 'Enzo Gianfratti'], [3, 481, 'Erik Zabala'], [4, 472, 'Sandro Pelatti'],
      [5, 441, 'Rene Povlsen'], [6, 437, 'Sten Dorian Piirimägi'], [7, 411, 'Busián Fontán'], [8, 420, 'Sebastian Quirno'],
      [9, 433, 'Samuel Chaligne'], [10, 405, 'Demir Eröge'], [11, 431, 'Mathieu Casalonga'],
      [null, 15, 'Luke Sargeant', 'DNC · No clasificado'], [null, 13, 'Manuel Fernandes', 'DNC · No clasificado'],
    ],
  },
]

export function tablaTcrRevisada(hash, sesion, ano, fuenteUrl, verificadoEn) {
  const documento = documentos.find(d => d.url === fuenteUrl)
  if (!documento) return null
  if (documento.hash !== hash || documento.ano !== ano || documento.sesion !== sesion) throw Error('El acta escaneada TCR ha cambiado o no corresponde a esta sesión: requiere nueva revisión')
  return { id: 'resultado', nombre: `Orden del acta final revisada · ${sesion}`, fuenteUrl, verificadoEn, columnas: [{ clave: 'numero', nombre: 'Dorsal' }, { clave: 'estado', nombre: 'Estado del acta' }], filas: documento.filas.map(([posicion, numero, nombre, estado = 'Clasificado']) => ({ posicion, nombre, valores: { numero, estado } })) }
}
