#!/usr/bin/env node
import { descargar, descargarJSON, desplazaFecha, fechaMadrid, guardarGuardias, rangoGuardia, texto } from './lib/guardias-fetch.mjs'

const web = 'https://www.cofgipuzkoa.eus/ciudadano/farmacias-gipuzkoa/farmacias-de-guardia-2/'
const api = 'https://cofgipuzkoa.pretools.net/'
const tipos = {
  '694c2fd7-6c2f-ed11-9db1-0022489d69fc': 'Turno diurno',
  '107665e3-7832-ed11-9db1-0022489c80ec': 'Turno nocturno',
  'c46368dd-7832-ed11-9db1-0022489c80ec': 'Refuerzo de guardia'
}
const fecha = fechaMadrid()
const html = await (await descargar(web)).text()
const menu = html.match(/<select[^>]*id="municipio"[\s\S]*?<\/select>/)?.[0] || ''
const zonas = new Set(Array.from(menu.matchAll(/value="(\d+,\d+)"/g), m => m[1]))
if (zonas.size < 15) throw new Error('Lista incompleta de zonas de guardia')
const filas = new Map()
function consultar(endpoint, params) {
  return descargarJSON(api + endpoint, {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(params)})
}
for (const dia of [desplazaFecha(fecha, -1), fecha]) {
  const festivosZona = new Map()
  for (const municipio of zonas) {
    const festivos = []
    for (const zona of new Set(municipio.split(','))) {
      if (!festivosZona.has(zona)) festivosZona.set(zona, await consultar('festivos/' + zona, {fechaInicio: dia, fechaFin: dia}))
      festivos.push(...festivosZona.get(zona))
    }
    const data = await consultar('buscarFarmaciasGuardia', {municipio, fecha: dia, festivos})
    if (!Array.isArray(data)) throw new Error('Zona de guardia sin respuesta ' + municipio)
    for (const f of data) {
      if (f.tipo === '13h') continue // La web las identifica como farmacias voluntarias con horario ampliado.
      if (!tipos[f.tipo] || !f.id || !f.fecha || !f.poblacion || !f.direccion || fechaMadrid(new Date(f.fecha)) !== dia)
        throw new Error('Turno desconocido o de fecha distinta en ' + municipio)
      const tramo = texto(f.horario).match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/)
      const exacto = tramo && tramo[1] !== tramo[2]
      if (dia !== fecha && (!exacto || tramo[2] >= tramo[1])) continue
      const horas = exacto ? rangoGuardia(dia,tramo[1],tramo[2]) : 'Horario por confirmar'
      filas.set([f.id, f.tipo, dia, horas].join('|'), [0,0,texto(f.nombre) + ' · ' + texto(f.direccion),
        texto(f.poblacion),texto(f.telefono),'',horas,[tipos[f.tipo],f.barrio].filter(Boolean).join(' · ')])
    }
  }
}
guardarGuardias('gipuzkoa', 'cofgipuzkoa.eus', [...filas.values()], {fecha, sourceUrl: web, min: 15, max: 250, guardiasVerificadas: true})
