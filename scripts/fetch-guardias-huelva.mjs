#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { descargar, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { paginasConPosicion } from './lib/guardias-pdf-posicion.mjs'

const sourceUrl = 'https://cofhuelva.org/cuadro-de-guardias'
const fecha = fechaMadrid()
const dia = new Date(fecha + 'T12:00:00Z')
const mes = dia.toLocaleString('es-ES', { month: 'long', timeZone: 'UTC' })
const titulo = 'huelva ' + mes + ' ' + fecha.slice(0, 4)
const pagina = parse(await (await descargar(sourceUrl)).text())
const links = pagina.querySelectorAll('a[href*="downloader.php"]').map(a => new URL(a.getAttribute('href'), sourceUrl))
const pdf = links.find(url => url.origin === new URL(sourceUrl).origin && url.searchParams.get('localty')?.toLowerCase() === titulo)
if (!pdf) throw new Error('Falta el cuadro del mes solicitado para Huelva capital')
const paginas = await paginasConPosicion(await (await descargar(pdf)).arrayBuffer())
const seccion = paginas.find(p => p.some(item => /^FARMACIAS 24H$/i.test(item.texto)) && p.some(item => item.texto.toLowerCase() === mes))
if (!seccion) throw new Error('Falta el título de la sección 24 horas del mes')
const cabecera = seccion.find(item => /^FARMACIAS 24H$/i.test(item.texto))
const lineas = new Map()
for (const item of seccion.filter(v => v.y > cabecera.y).sort((a,b) => a.y-b.y || a.x-b.x)) {
  const y = Math.round(item.y * 1000)
  lineas.set(y, [...(lineas.get(y) || []), item.texto])
}
const guardias = [...lineas.values()].map(linea => linea.join(' ')).filter(linea => /^(?:p[º.]|paseo|av[de.]|c\/|calle|plaza|pz[.]|avenida)\s*/i.test(linea))
  .map(direccion => [0, 0, direccion, 'Huelva', '', '', '24 horas', 'Atención continuada'])
guardarGuardias('huelva', 'cofhuelva.org', guardias, { fecha, sourceUrl: pdf.href, guardiasVerificadas: true, cobertura: 'Farmacias de 24 horas de Huelva capital. El colegio también publica turnos diurnos y los calendarios de la provincia.' })
