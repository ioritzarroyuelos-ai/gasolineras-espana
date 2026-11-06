// Contrastar la oficina, no el nombre de la zona que cubre.
// Registro E1 del Gobierno de La Rioja: https://web.larioja.org/dato-abierto/datoabierto?n=opd-905
export const registroOficinasRioja = 'https://ias1.larioja.org/opendata/download?r=Y2Q9OTA1fGNmPTA0'

function normaliza(s) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function palabras(s) { return normaliza(s).split(' ').filter(x => x.length > 2 && !['farmacia','farmaceuticos','hijos','calle','plaza','avenida','del','los','las'].includes(x)) }

export function municipioOficinaRioja(direccion, oficinas, zona) {
  const titular = palabras(direccion.split('(')[0].replace(/^Ld[oa]\.\s*/i, ''))
  const completo = ' ' + normaliza(direccion) + ' '
  const candidatos = oficinas.filter(f => {
    const nombre = ' ' + normaliza(f.DENOMINACION) + ' '
    return titular.length >= 2 && titular.every(p => nombre.includes(' ' + p + ' '))
  })
  const municipios = new Set(candidatos.map(f => f.DESC_POBLACION))
  if (municipios.size === 1 && municipios.has(zona)) return zona
  // Una calle y portal o un nombre comercial permiten desambiguar titulares
  // homónimos. Por ejemplo, hay dos Roldán Yanguas en ciudades distintas.
  const porDireccion = (candidatos.length ? candidatos : oficinas).filter(f => {
    const calle = palabras(f.VIA), numero = normaliza(f.NUMERO_VIA)
    const comercial = /\bfarmacia\s+([^().]+)\)?$/i.exec(f.DENOMINACION)?.[1]
    const rotulo = palabras(comercial)
    const coincideRotulo = candidatos.length && rotulo.length && rotulo.every(p => completo.includes(' ' + p + ' '))
    const coincideCalle = calle.length && calle.every(p => completo.includes(' ' + p + ' '))
    const nombre = palabras(f.DENOMINACION)
    const coincideTitular = titular.some(p => nombre.includes(p))
    return coincideRotulo || (coincideCalle && (candidatos.length || (coincideTitular && numero && completo.includes(' ' + numero + ' '))))
  })
  const destinos = new Set(porDireccion.map(f => f.DESC_POBLACION))
  return destinos.size === 1 ? [...destinos][0] : null
}

export function anotaDestinoRioja(avisos, zona, direccion, municipio, horario) {
  const clave = normaliza(zona).replaceAll(' ', '-')
  const intervalo = typeof horario === 'string' && /^(\d{4}-\d\d-\d\d) (\d\d:\d\d)-(\d{4}-\d\d-\d\d) (\d\d:\d\d)$/.exec(horario)
  const horas = intervalo ? ' De ' + intervalo[2] + ' a ' + intervalo[4] + (intervalo[1] === intervalo[3] ? '.' : ' del día siguiente.') : ''
  const aviso = municipio
    ? 'Rioja Salud indica que esta zona se atiende en ' + municipio + '. ' + direccion + '.' + horas
    : 'Rioja Salud publica un turno para esta zona, pero el municipio de la oficina está pendiente de confirmar. Consulta la fuente oficial antes de acudir.'
  const lista = avisos[clave] ??= []
  if (!lista.includes(aviso)) lista.push(aviso)
}

// Los ficheros anteriores anotaban en la columna municipal la cabecera de
// la zona de Cervera. El calendario indica el destino en la propia dirección.
// La lista municipal de farmacias distingue estas cinco localidades.
// https://aytoaguilar-inestrillas.larioja.org/aguilar-del-rio-alhama/salud
export function corrigeZonaCervera(fichero) {
  if (fichero.territorio !== 'rioja' || fichero.avisosMunicipales || !Array.isArray(fichero.guardias)) return fichero
  const avisosMunicipales = {}, guardias = []
  for (const fila of fichero.guardias) {
    if (fila[3] !== 'Cervera del Río Alhama') { guardias.push(fila); continue }
    const direccion = String(fila[2]), destino = normaliza(direccion)
    const lugar = /\baguilar(?: del rio alhama)?$/.test(destino) ? 'Aguilar del Río Alhama'
      : /\bigea$/.test(destino) ? 'Igea' : /\bcornago$/.test(destino) ? 'Cornago'
      : /\b(?:cervera(?: del rio alhama)?|rincon de olivedo|las casas)$/.test(destino) ? fila[3] : null
    if (lugar) {
      const copia = [...fila]; copia[3] = lugar; guardias.push(copia)
    }
    if (lugar !== fila[3]) anotaDestinoRioja(avisosMunicipales, fila[3], direccion, lugar, fila[6])
  }
  return { ...fichero, guardias, avisosMunicipales }
}
