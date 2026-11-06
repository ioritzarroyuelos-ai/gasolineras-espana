#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { descargar, fechaMadrid, guardarGuardias, rangoGuardia, texto } from './lib/guardias-fetch.mjs'
import { turnoTarragona } from './lib/guardias-tarragona.mjs'

const fuente = 'https://coft.cat/font/guardies.php'
const fecha = fechaMadrid()
const [anyo, mes, dia] = fecha.split('-').map(Number)
const portal = parse(await (await descargar(fuente)).text())
const pueblos = portal.querySelectorAll('select[name=CODI] option').map(opcion => opcion.getAttribute('value'))
if (pueblos.length < 100 || pueblos.some(id => !/^\d+$/.test(id))) throw new Error('COFT: índice municipal incompleto')

const turnos = new Map()
const avisosMunicipales = {}
for (const id of pueblos) {
  const url = new URL('gpobles.php', fuente)
  url.search = new URLSearchParams({ CODI: id, MES: mes, DIA: dia, ANY: anyo })
  const doc = parse(await (await descargar(url)).text())
  if (!doc.querySelector('h1')?.text.includes('Farmàcies de Guàrdia')) throw new Error('COFT: respuesta inesperada')
  const impresion = doc.querySelector('a[href*=guaimp]')
  if (!impresion && !doc.querySelector('table#tablaverde')) continue
  const cartel = new URL(impresion?.getAttribute('href'), url).searchParams
  if (+cartel.get('ANY') !== anyo || +cartel.get('MES') !== mes || +cartel.get('DIA') !== dia || cartel.get('CODIPOBLE') !== id) {
    throw new Error('COFT: cartel de otro día o población')
  }
  let tramo = ''
  for (const elemento of doc.querySelectorAll('h1, table#tablaverde')) {
    if (elemento.tagName === 'H1') {
      const horas = /^Servei d.Urgències (?:Diürn|Nocturn)\s*\((\d{1,2}:\d{2})h a (\d{1,2}:\d{2})h\)$/i.exec(texto(elemento.text))
      tramo = horas ? rangoGuardia(fecha, horas[1].padStart(5, '0'), horas[2].padStart(5, '0')) : ''
      continue
    }
    // El colegio publica el refuerzo en una sección diferente a los dos turnos.
    if (!tramo) continue
    const titular = elemento.querySelector('.titularGuardia')
    const campos = new Map()
    for (const fila of elemento.querySelectorAll('tr')) {
      const [k, v] = fila.querySelectorAll('td')
      if (k && v) campos.set(texto(k.text), texto(v.text))
    }
    const poblacion = /^(.+?)\s*\(CP:\s*(\d{5})\)$/i.exec(campos.get('Població') || '')
    const direccion = texto(campos.get('Adreça')).replace(/\s*\(veure mapa\)\s*$/i, '')
    if (!titular || !poblacion || !direccion) throw new Error('COFT: ficha sin municipio o dirección')
    if (!poblacion[2].startsWith('43')) continue // Remisión a otra provincia.
    const notas = campos.get('Observacions') || ''
    const telefono = campos.get('Telèfon Urgències') || campos.get('Telèfon') || ''
    const interpretado = turnoTarragona(tramo,notas)
    if (interpretado.omitido) {
      const slug = poblacion[1].normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-')
      avisosMunicipales[slug] = ['El colegio indica un turno de sábado a las 14:00 a lunes a las 09:00. Consulta el calendario oficial para el resto de la semana.']
      continue
    }
    const aviso = interpretado.nota
    const key = titular.getAttribute('href') + '|' + aviso
    let registro = turnos.get(key)
    if (!registro) {
      registro = { fila: [0, 0, texto(titular.text) + ' · ' + direccion, poblacion[1], telefono, poblacion[2], '', aviso], tramos: new Set(), franjas: new Set() }
      turnos.set(key, registro)
    }
    if (interpretado.horario) registro.tramos.add(interpretado.horario)
    if (interpretado.conservarFranja) registro.franjas.add(tramo.slice(11,16) + '–' + tramo.slice(-5))
  }
}
const guardias = [...turnos.values()].map(({ fila, tramos, franjas }) => {
  fila[6] = franjas.size ? 'Turno publicado de ' + [...franjas].sort().join(' y ') : [...tramos].sort().join(' / ')
  return fila
})
guardarGuardias('tarragona', 'coft.cat', guardias, { fecha, sourceUrl: fuente, avisosMunicipales, guardiasVerificadas: true, min: 5, max: 350 })
