#!/usr/bin/env node
import { descargar, desplazaFecha, fechaMadrid, guardarGuardias, coordenadas, rangoGuardia, texto } from './lib/guardias-fetch.mjs'

// Extrae el array "places" del HTML. El JSON esta inline en un <script>
// largo con otras config. Buscamos el arranque "places":[ y encontramos el
// matching-bracket haciendo conteo manual (regex no basta con strings que
// contienen { } dentro).
function extractPlaces(html) {
  const start = html.indexOf('"places":[')
  if (start === -1) return null
  const arrStart = start + '"places":'.length
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = arrStart; i < html.length; i++) {
    const c = html[i]
    if (escape) { escape = false; continue }
    if (c === '\\' && inStr) { escape = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        const json = html.slice(arrStart, i + 1)
        try { return JSON.parse(json) } catch (e) {
          console.error(`    JSON.parse fallo en posicion ${arrStart}: ${e.message}`)
          return null
        }
      }
    }
  }
  return null
}

const fecha = fechaMadrid()
const url = 'https://cofalava.org/farmacias-de-guardia/'
const lugares = extractPlaces(await (await descargar(url)).text())
if (!Array.isArray(lugares)) throw new Error('El calendario de Álava no contiene guardias')
const guardias = []
for (const dia of [desplazaFecha(fecha,-1),fecha]) {
  const delDia = lugares.filter(p=>p.location?.extra_fields?.fecha===dia.split('-').reverse().join('/'))
  if (!delDia.length && dia===fecha) throw new Error('Falta el día solicitado en Álava')
  for (const p of delDia) {
    const loc=p.location, e=loc.extra_fields
    const sol=/fa-sun-o\b/.test(e.guardia), luna=/fa-moon-o\b/.test(e.guardia)
    const horas = texto(e.horarios).match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/)
    if (!sol && !luna) throw new Error('Falta la clave de servicio del colegio alavés')
    // Inicio y cierre iguales sólo se extienden al día siguiente si el colegio señala día y noche.
    const exacto = horas && (horas[1]!==horas[2] || (sol && luna))
    if (dia!==fecha && (!exacto || !luna || horas[2]>horas[1])) continue
    guardias.push([...coordenadas(loc.lat,loc.lng,[42.3,43.2,-3.3,-2.2]),texto(p.title)+' · '+texto(e['direccion-corta']||p.address),
      texto(e.poblacion||loc.city),texto(e.telefono),texto(loc.postal_code),exacto?rangoGuardia(dia,horas[1],horas[2]):'Horario por confirmar',
      [e.zona,e.barrio].map(texto).filter(Boolean).join(' · ')])
  }
}
guardarGuardias('alava','cofalava.org',guardias,{fecha,sourceUrl:url,min:3,max:200,guardiasVerificadas:true,coordenadasOficiales:true})
