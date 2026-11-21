#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { descargar, fechaMadrid, guardarGuardias, texto } from './lib/guardias-fetch.mjs'
import { consultaCapitalCordoba } from './lib/guardias-cordoba-capital.mjs'
import { paginasConPosicion } from './lib/guardias-pdf-posicion.mjs'

const fecha = fechaMadrid()
const [ano, mes, dia] = fecha.split('-')
const base = 'https://www.cofco.org/aplicaciones/guardias/'
const portal = 'https://www.cofco.org/guardias-' + ano + '/'
let ciudades = []
try {
  const formulario = parse(await (await descargar(base + 'farmacias' + ano + '.php')).text())
  ciudades = formulario.querySelectorAll('select[name=sltCiudad] option')
} catch { /* El calendario mensual se comprueba de forma independiente abajo. */ }

const resultados = new Map()
const avisosMunicipales = {}
const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const localidades = new Set(ciudades.map(c => slug(texto(c.text))))
const incidencias = []
const sinTurno = new Set()
if (!ciudades.length) incidencias.push('El buscador diario no ofrece poblaciones verificables para el año solicitado.')
for (const ciudad of ciudades) {
  const id = ciudad.getAttribute('value')
  if (!/^\d+$/.test(id)) continue
  const params = new URLSearchParams({ dia, mes, ano, diaf: dia, mesf: mes, anof: ano, sltCiudad: id, resultado: '1' })
  const url = base + 'imprime' + ano + '.php?' + params
  let listado
  try { listado = parse(await (await descargar(url)).text()) }
  catch { sinTurno.add(texto(ciudad.text)); continue }
  const fechas = listado.querySelectorAll('.fecha').map(n => texto(n.text))
  if (!fechas.length || fechas.some(f => !f.endsWith(' ' + [dia, mes, ano].join('-')))) {
    incidencias.push('El colegio no devolvió la fecha solicitada para ' + texto(ciudad.text))
    sinTurno.add(texto(ciudad.text))
    continue
  }
  if (!listado.querySelector('td.farmacia')) sinTurno.add(texto(ciudad.text))
  let descartadas = 0
  for (const bloque of listado.querySelectorAll('.fondodia, .fondonoche')) {
    const horario = texto(bloque.querySelector('.dia, .noche')?.text)
    for (const celda of bloque.querySelectorAll('td.farmacia')) {
      const direccion = texto(celda.text)
      const zona = texto(celda.parentNode.querySelectorAll('td')[2]?.text)
      const esCapital = texto(ciudad.text) === 'CORDOBA' && /^ZONA\s/.test(zona)
      // El municipio solicitado puede estar cubierto por otra localidad.
      const municipio = esCapital ? 'Córdoba' : zona
      if (!direccion || !municipio || (!esCapital && /^ZONA\b/i.test(municipio))) { descartadas++; continue }
      const fila = [0, 0, direccion, municipio, '', '', horario, 'Guardia de ' + (bloque.classNames.includes('fondodia') ? 'día' : 'noche')]
      resultados.set(JSON.stringify(fila), fila)
      const solicitada = slug(texto(ciudad.text))
      if (!esCapital && localidades.has(slug(municipio)) && slug(municipio) !== solicitada) {
        const aviso = fila[7] + ': el colegio indica ' + direccion + ', en ' + municipio + '. ' + horario
        const avisos = avisosMunicipales[solicitada] ||= []
        if (!avisos.includes(aviso)) avisos.push(aviso)
      }
    }
  }
  if (descartadas) incidencias.push(texto(ciudad.text) + ': hay turnos cuya localidad física no se especifica')
}
let respaldo = false
if (![...resultados.values()].some(row => row[3] === 'Córdoba')) {
  try {
    const capital = await consultaCapitalCordoba(fecha, {
      html: async url => (await descargar(url)).text(),
      pdf: async url => {
        const response = await descargar(url)
        if (Number(response.headers.get('Content-Length')) > 2000000) throw Error('COFCO: PDF demasiado grande')
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length > 2000000 || !new TextDecoder().decode(bytes.slice(0, 5)).startsWith('%PDF-')) throw Error('COFCO: PDF no válido')
        return bytes
      }, pages: paginasConPosicion,
    })
    for (const row of capital.rows) resultados.set(JSON.stringify(row), row)
    respaldo = true; sinTurno.delete('CORDOBA')
    incidencias.push('Córdoba capital se ha recuperado del calendario mensual oficial: ' + capital.urls.join(' · ') + '. No acredita los turnos del resto de la provincia.')
  } catch { incidencias.push('Tampoco se pudo verificar el calendario mensual de Córdoba capital.') }
}
for (const localidad of sinTurno) {
  const key = slug(localidad)
  avisosMunicipales[key] = [...(avisosMunicipales[key] || []), 'El buscador del colegio no ha devuelto un turno verificable para esta población en la fecha solicitada. Consulta la fuente oficial.']
}
if (sinTurno.size) incidencias.push('Cobertura parcial: ' + sinTurno.size + ' consultas municipales no devolvieron turnos verificables de la fecha solicitada.')
guardarGuardias('cordoba', 'cofco.org', [...resultados.values()], {
  fecha, sourceUrl: portal, guardiasVerificadas: true, incidencias, avisosMunicipales,
  cobertura: respaldo ? 'Cobertura parcial. Córdoba capital: calendario mensual enlazado por el colegio para el mes y año consultados, incluida la madrugada de la víspera. No se reutilizan turnos antiguos de los pueblos.' : 'Buscador diario del colegio. Cada farmacia figura en la localidad que indica su ficha.'
})
if (respaldo || sinTurno.size || incidencias.length) process.exitCode = 1
