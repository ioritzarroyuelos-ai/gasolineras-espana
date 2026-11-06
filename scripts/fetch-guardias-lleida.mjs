#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { coordenadas, descargar, desplazaFecha, fechaMadrid, guardarGuardias, rangoGuardia, texto } from './lib/guardias-fetch.mjs'

const base = 'https://www.coflleida.cat/cat/farmacies/farmacies.asp'
const fecha = fechaMadrid()
const [anyo, mes, dia] = fecha.split('-').map(Number)
const meses = ['gener', 'febrer', 'març', 'abril', 'maig', 'juny', 'juliol', 'agost', 'setembre', 'octubre', 'novembre', 'desembre']
const etiqueta = dia + ' de ' + meses[mes - 1]
async function leer(params) {
  const res = await descargar(base + '?' + new URLSearchParams(params))
  return parse(new TextDecoder('windows-1252').decode(await res.arrayBuffer()))
}
const indice = await leer({ Inicial: 'A' })
const letras = new Set(['A'])
for (const enlace of indice.querySelectorAll('a[href*=Inicial]')) {
  const inicial = new URL(enlace.getAttribute('href'), base).searchParams.get('Inicial')
  if (/^[A-Z]$/.test(inicial)) letras.add(inicial)
}
const zonas = new Set()
for (const inicial of letras) {
  const pagina = inicial === 'A' ? indice : await leer({ Inicial: inicial })
  for (const enlace of pagina.querySelectorAll('a[href*=IdZona]')) {
    const id = new URL(enlace.getAttribute('href'), base).searchParams.get('IdZona')
    if (/^\d+$/.test(id)) zonas.add(id)
  }
}
if (zonas.size < 50) throw new Error('COFLleida: índice de zonas incompleto')

const turnos = new Map()
function registrar(enlace, direccion, municipio, telefono, tipo, coord) {
  const params = new URL(enlace.getAttribute('href'), base).searchParams
  if (Number(params.get('Any')) !== anyo || Number(params.get('Mes')) !== mes || !params.get('IdFarmacia')) throw new Error('COFLleida: mes de ficha incorrecto')
  if (!direccion || !municipio || !tipo) throw new Error('COFLleida: ficha sin dirección, municipio o turno')
  // La zona de la Cerdanya remite también a Alp, que pertenece a Girona.
  if (municipio === 'Alp') return
  const horas = /\bde (\d{1,2})(?::(\d{2}))? a (\d{1,2})(?::(\d{2}))? hores\b/i.exec(tipo)
  let horario = tipo === 'DIA I NIT' ? 'Turno de día y de noche' : tipo
  if (horas) {
    const inicio = horas[1].padStart(2, '0') + ':' + (horas[2] || '00')
    const fin = horas[3].padStart(2, '0') + ':' + (horas[4] || '00')
    horario = fin === '24:00' ? fecha + ' ' + inicio + '-' + desplazaFecha(fecha, 1) + ' 00:00' : rangoGuardia(fecha, inicio, fin)
  }
  const clave = params.get('IdFarmacia')
  const anterior = turnos.get(clave)
  if (!anterior) {
    turnos.set(clave, [...coord, texto(enlace.text) + ' · ' + direccion, municipio, telefono, '', horario, ''])
  } else if (!anterior[6].split(' / ').includes(horario)) {
    anterior[6] += ' / ' + horario
  }
}
for (const idZona of zonas) {
  const pagina = await leer({ Detall: 'Calendari', IdZona: idZona, Any: anyo, Mes: mes, Dia: dia })
  let seccion = null
  for (const el of pagina.querySelectorAll('td, div.dades')) {
    if (/tit[oO]lsubseccio/i.test(el.getAttribute('class') || '')) {
      const titulo = texto(el.text)
      if (/^\d{1,2} de /.test(titulo)) {
        seccion = titulo === etiqueta ? '' : titulo.startsWith(etiqueta + ' - ') ? titulo.slice(etiqueta.length + 3) : null
      }
      continue
    }
    if (seccion === null) continue
    if (seccion && el.tagName === 'TD') {
      // La capital utiliza una tabla separada para el turno diurno y el nocturno.
      const enlace = el.children.find(n => n.tagName === 'A' && n.getAttribute('href')?.includes('IdFarmacia='))
      if (!enlace) continue
      const [, lugar, contacto] = el.parentNode.children
      if (!lugar || !contacto) throw new Error('COFLleida: tabla de la capital desconocida')
      const [direccion, ciudad] = lugar.structuredText.trim().split(/\n/).map(texto)
      registrar(enlace, direccion, ciudad?.split(',')[0].trim(), texto(contacto.text).match(/Farmàcia:\s*(\d{9})/i)?.[1] || '', seccion, [0, 0])
    } else if (el.tagName === 'DIV') {
      const enlace = el.querySelector('a[href*=IdFarmacia]')
      if (!enlace) throw new Error('COFLleida: farmacia sin identificación')
      const [, ...lineas] = el.structuredText.trim().split(/\n/).map(texto).filter(Boolean)
      const tipo = seccion || lineas.shift()
      if (!tipo || (!seccion && !/^(?:DIA|NIT)\b/i.test(tipo))) throw new Error('COFLleida: formato de turno desconocido')
      const [direccion, ciudad, contacto] = lineas
      const gps = /google\.maps\.LatLng\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/.exec(el.parentNode.querySelector('script')?.text || '')
      registrar(enlace, direccion, ciudad, contacto?.match(/Farmàcia:\s*(\d{9})/i)?.[1] || '', tipo,
        gps ? coordenadas(gps[1], gps[2], [40.5, 42.9, 0.2, 1.9]) : [0, 0])
    }
  }
}
guardarGuardias('lleida', 'coflleida.cat', [...turnos.values()], { fecha, sourceUrl: base, guardiasVerificadas: true, min: 5, max: 180 })
