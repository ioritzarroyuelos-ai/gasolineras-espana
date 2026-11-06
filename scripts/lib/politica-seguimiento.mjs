// Complemento de la tabla española. Conserva la identidad de las candidaturas
// de esa tabla y sólo incorpora proyecciones nacionales de SW para La Séptima.
import { parse } from 'node-html-parser'
import { citasPorCelda, fuentePrimaria, parseFecha, parseSondeos } from './politica-parse.mjs'

const casa = 'SW Demoscopia'
const cliente = 'La Séptima'
const limpia = texto => texto.replace(/\p{Cf}/gu, '').replace(/\s+/gu, ' ').trim()
const normaliza = texto => limpia(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

export function esSeguimientoSW(s) {
  return normaliza(s.empresa) === 'sw demoscopia' && normaliza(s.comitente) === 'la septima'
}

function corrigeDiscrepancia(s) {
  if (s.campoFin !== '2026-11-04' || !esSeguimientoSW(s)) return s
  // Se han difundido 117 del PP o 118 incluyendo UPN; no imputar al PP la
  // cifra conjunta, aunque mañana aparezca también en la tabla española.
  return { ...s, datos: s.datos.map(d => d.candidaturaId === 'pp' ? { ...d, escanos: null } : d)
    .filter(d => d.pct != null || d.escanos != null) }
}

export function combinaSeguimiento(principales, seguimiento) {
  const confirmadas = new Map(seguimiento.map(s => [s.campoFin, s]))
  return [...principales.filter(s => !esSeguimientoSW(s) || !confirmadas.has(s.campoFin)), ...confirmadas.values()].map(corrigeDiscrepancia)
}

export function extraeSeguimientoGenerales(htmlIngles, candidaturas) {
  const root = parse(htmlIngles)
  const citas = citasPorCelda(root)
  const conocidos = new Set(candidaturas.map(c => c.id))
  const porFecha = new Map()
  const incidencias = []
  const titulos = []
  let tablas = 0

  for (const nodo of root.querySelectorAll('h2,h3,h4,h5,h6,table.wikitable')) {
    if (nodo.tagName !== 'TABLE') {
      const nivel = Number(nodo.tagName[1])
      titulos.length = nivel
      titulos[nivel - 1] = limpia(nodo.text)
      continue
    }
    const secciones = titulos.filter(Boolean)
    const anio = /^(\d{4})(?: \([^()]+\))?$/.exec(secciones.at(-1) || '')
    if (!anio || secciones.slice(-4, -1).join('/') !== 'Electoral polling/Nationwide polling/Voting intention estimates') continue

    const filas = nodo.querySelectorAll('tr').filter(f => f.closest('table') === nodo)
    const columnas = filas[0]?.querySelectorAll('th') ?? []
    if (limpia(columnas[0]?.text || '') !== 'Polling firm/Commissioner' || limpia(columnas[1]?.text || '') !== 'Fieldwork date') continue
    tablas++
    const fuentes = new Map()
    for (const fila of filas) {
      const celdas = fila.childNodes.filter(n => n.tagName === 'TD')
      if (celdas.length < 2) continue
      const firma = celdas[0].clone()
      firma.querySelectorAll('sup').forEach(n => n.remove())
      if (limpia(firma.text) !== casa + '/' + cliente) continue
      const fin = parseFecha(celdas[1].text, Number(anio[1])).fin
      const fuente = fuentePrimaria(citas.get(celdas[0]), casa, cliente, fin)
      if (fuente) fuentes.set(fin, fuente)
    }
    if (!fuentes.size) continue

    // Reutiliza el lector probado de porcentajes, escaños, rangos y celdas
    // compartidas, dándole el año extraído de «2026 (with Broad Front)».
    const { sondeos } = parseSondeos('<h2>' + anio[1] + '</h2>' + nodo.outerHTML)
    for (const s of sondeos) {
      if (s.empresa !== casa || s.comitente !== cliente || !s.campoFin || !fuentes.has(s.campoFin)) continue
      // El programa también muestra una serie diaria de voto directo en el
      // mismo gráfico. Sólo se importa la entrega con proyección de escaños.
      if (!s.datos.some(d => d.escanos != null)) continue
      if (porFecha.has(s.campoFin)) {
        porFecha.set(s.campoFin, null)
        incidencias.push('Dos proyecciones del seguimiento sin distinguir el ' + s.campoFin)
        continue
      }
      const datos = []
      for (const d of s.datos) {
        // Nombre completo de la candidatura en el encabezado inglés.
        const id = d.candidaturaId === 'adelanteandalucia2021' ? 'aa' : d.candidaturaId
        if (!conocidos.has(id)) continue
        datos.push({ ...d, candidaturaId: id })
      }
      if (datos.length) porFecha.set(s.campoFin, corrigeDiscrepancia({ ...s, ...fuentes.get(s.campoFin), datos }))
    }
  }
  if (!tablas) incidencias.push('No se reconoce la tabla nacional inglesa de estimaciones por año')
  return { sondeos: [...porFecha.values()].filter(Boolean), incidencias }
}
