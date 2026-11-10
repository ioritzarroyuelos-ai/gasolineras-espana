#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { descargar, fechaMadrid, guardarGuardias, rangoGuardia, texto } from './lib/guardias-fetch.mjs'
import { paginasConPosicion } from './lib/guardias-pdf-posicion.mjs'
import { seleccionarSemanaPalencia } from './lib/guardias-palencia.mjs'

const url = 'https://www.cofpalencia.org/PUBLICO/CALENDARIOS%20DE%20GUARDIA/menu_calendarios_guardia.htm'
const fecha = fechaMadrid()
const hoy = new Date(fecha + 'T12:00:00Z')
const mes = hoy.toLocaleString('es',{month:'long',timeZone:'UTC'}).toUpperCase()
const dia = hoy.getUTCDate()
const anio = hoy.getUTCFullYear()
const sinTildes = s => texto(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
const compacto = s => sinTildes(s).replace(/\s+/g,'')
const menu = parse(new TextDecoder('windows-1252').decode(await (await descargar(url)).arrayBuffer()))
const enlaces = menu.querySelectorAll('a[href]').map(a => ({url: new URL(a.getAttribute('href'),url), nombre:sinTildes(a.text)}))
const guardias = new Map()
const pendientes = ['Aguilar de Campoo','Baltanás y Torquemada','Cervera de Pisuerga','Frómista','Guardo','Herrera de Pisuerga','Osorno','Paredes de Nava','Villada','Villamuriel de Cerrato','Villarramiel','Venta de Baños']
function guardar(dir, municipio, horas) {
  const fila = [0,0,dir,municipio,'','',rangoGuardia(fecha,...horas),'']
  guardias.set([dir,municipio,fila[6]].join('|'),fila)
}
async function paginaPdf(enlace) {
  if (enlace.url.origin !== new URL(url).origin) throw new Error('Enlace a un calendario no reconocido')
  const paginas = await paginasConPosicion(await (await descargar(enlace.url)).arrayBuffer())
  if (paginas.length !== 1) throw new Error('Calendario semanal con formato desconocido')
  return paginas[0]
}
const { enlace: semana, lunes, domingo } = seleccionarSemanaPalencia(enlaces, fecha)
const nombreMes = d => sinTildes(d.toLocaleString('es',{month:'long',timeZone:'UTC'}))
const datos = await paginaPdf(semana)
const semanaDias = ['DOMINGO','LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO']
const inicio = datos.findIndex(i=>i.x < .17 && sinTildes(i.texto) === semanaDias[hoy.getUTCDay()])
if (inicio < 0) throw new Error('Falta la fila de hoy en la capital')
const fila = datos.slice(inicio+1)
const fin = fila.findIndex(i=>i.x < .17 && semanaDias.includes(sinTildes(i.texto)))
const celdas = fila.slice(0,fin < 0 ? undefined : fin).filter(i=>i.y < .93)
if (!compacto(celdas.filter(i=>i.x < .17).map(i=>i.texto).join('')).startsWith(dia+'DE'+mes))
  throw new Error('La fecha de la fila no coincide en Palencia')
const cabecera = compacto(datos.slice(0,inicio).map(i=>i.texto).join(''))
if (!cabecera.includes('10:00A22:00') || !cabecera.includes('DELdiasiguiente'.toUpperCase())) throw new Error('Horario de capital desconocido')
for (const [x1,x2,nocturna] of [[.17,.416,false],[.416,.682,false],[.682,1,true]]) {
  const contenido = celdas.filter(i=>i.x>=x1 && i.x<x2).map(i=>i.texto).join(' ').split('(')[0].trim()
  if (!/\d/.test(contenido)) throw new Error('Celda de guardia sin dirección en Palencia')
  guardar(contenido,'Palencia',nocturna?['22:00','10:00']:['10:00','22:00'])
}
// Sólo estas dos tablas semanales publican dos columnas uniformes de lunes a domingo.
// Las demás usan colores, festivos locales y excepciones. Se enlaza al original.
for (const zona of ['Carrión de los Condes','Saldaña']) {
  const enlace = enlaces.find(e=>e.nombre===sinTildes(zona+' '+mes))
  if (!enlace) { pendientes.push(zona); continue }
  const items = await paginaPdf(enlace)
  const semanas = items.map((v,i)=>v.texto==='SEMANA'?i:-1).filter(i=>i>=0)
  const encabezado = compacto(items.slice(0,semanas[0]).map(i=>i.texto).join(''))
  if (!encabezado.includes(mes+anio) || !encabezado.includes('LUNESADOMINGO') || !encabezado.includes('10:00H.A22:00H.') || !encabezado.includes('22:00HA10:00H.')) { pendientes.push(zona); continue }
  const comienzo = '('+lunes.getUTCDate()+'DE'+nombreMes(lunes)+')'
  const final = '('+domingo.getUTCDate()+'DE'+nombreMes(domingo)+')'
  const bloques = semanas.map((n,i)=>items.slice(n,semanas[i+1]))
  const bloque = bloques.find(b=>compacto(b.filter(i=>i.x<.26).map(i=>i.texto).join('')).includes(comienzo+'AL'+final))
  if (!bloque) { pendientes.push(zona); continue }
  for (const [x1,x2,nocturna] of [[.26,.60,false],[.60,1,true]]) {
    const celda = texto(bloque.filter(i=>i.x>=x1 && i.x<x2).map(i=>i.texto).join(' '))
    const m = /^(.+?)\s*\(([^)]+)\)\s*-?\s*(.+)$/.exec(celda)
    const municipio = m && ['Carrión de los Condes','Saldaña'].find(n=>compacto(n)===compacto(m[3]))
    if (!municipio) { pendientes.push(zona); continue }
    guardar(m[1]+' · '+m[2],municipio,nocturna?['22:00','10:00']:['10:00','22:00'])
  }
}
guardarGuardias('palencia','cofpalencia.org',[...guardias.values()],{fecha,sourceUrl:url,guardiasVerificadas:true,min:3,max:10,
  cobertura:'Para estas zonas, consulta el calendario del colegio: '+[...new Set(pendientes)].join(', ')+'.'})
