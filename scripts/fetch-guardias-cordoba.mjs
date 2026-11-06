#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { descargar, fechaMadrid, guardarGuardias, texto } from './lib/guardias-fetch.mjs'

const fecha = fechaMadrid()
const [ano, mes, dia] = fecha.split('-')
const base = 'https://www.cofco.org/aplicaciones/guardias/'
const portal = 'https://www.cofco.org/guardias-' + ano + '/'
const formulario = parse(await (await descargar(base + 'farmacias' + ano + '.php')).text())
const ciudades = formulario.querySelectorAll('select[name=sltCiudad] option')
if (!ciudades.length) throw new Error('El colegio no ofrece poblaciones para el año solicitado')

const resultados = new Map()
const avisosMunicipales = {}
const slug = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const localidades = new Set(ciudades.map(c => slug(texto(c.text))))
const incidencias = []
for (const ciudad of ciudades) {
  const id = ciudad.getAttribute('value')
  if (!/^\d+$/.test(id)) continue
  const params = new URLSearchParams({ dia, mes, ano, diaf: dia, mesf: mes, anof: ano, sltCiudad: id, resultado: '1' })
  const url = base + 'imprime' + ano + '.php?' + params
  const listado = parse(await (await descargar(url)).text())
  const fechas = listado.querySelectorAll('.fecha').map(n => texto(n.text))
  if (!fechas.length || fechas.some(f => !f.endsWith(' ' + [dia, mes, ano].join('-')))) {
    incidencias.push('El colegio no devolvió la fecha solicitada para ' + texto(ciudad.text))
    continue
  }
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
guardarGuardias('cordoba', 'cofco.org', [...resultados.values()], {
  fecha, sourceUrl: portal, guardiasVerificadas: true, incidencias, avisosMunicipales,
  cobertura: 'Buscador diario del colegio. Cada farmacia figura en la localidad que indica su ficha.'
})
