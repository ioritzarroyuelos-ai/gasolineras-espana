#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { descargar, desplazaFecha, fechaMadrid, guardarGuardias, rangoGuardia } from './lib/guardias-fetch.mjs'
import { paginasConPosicion } from './lib/guardias-pdf-posicion.mjs'

const web = 'https://cofsegovia.com/farmacias-de-guardia/'
const fecha = fechaMadrid()
const menu = parse(await (await descargar(web)).text())
const enlace = menu.querySelectorAll('a[href]').map(e=>new URL(e.getAttribute('href'),web)).find(u=>u.origin===new URL(web).origin &&
  /CALENDARIO-GUARDIAS-SEGOVIA-CAPITAL/i.test(u.pathname) && u.pathname.includes(fecha.slice(0,4)) && /\.pdf$/i.test(u.pathname))
if (!enlace) throw new Error('Falta el calendario anual de Segovia capital')
const paginas = await paginasConPosicion(await (await descargar(enlace)).arrayBuffer())
const guardias = []
for (const dia of [desplazaFecha(fecha,-1),fecha]) {
  if (dia.slice(0,4)!==fecha.slice(0,4)) continue
  const objetivo = new Intl.DateTimeFormat('es',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(dia+'T12:00Z'))
  const pagina = paginas.find(items=>items.some(i=>i.x<.26 && i.texto===objetivo))
  if (!pagina || !pagina.some(i=>i.texto==='SERVICIOS DE URGENCIA '+dia.slice(0,4))) throw new Error('Falta la fecha y año en Segovia')
  const y = pagina.find(i=>i.texto===objetivo).y
  for (const [x1,x2,inicio,fin] of [[.26,.60,'10:15','22:00'],[.60,1,'22:00','10:15']]) {
    if (dia!==fecha && inicio==='10:15') continue
    const columna = pagina.filter(i=>i.x>=x1 && i.x<x2)
    if (!columna.some(i=>i.texto.includes(inicio) && i.texto.includes(fin))) throw new Error('La cabecera de horarios de Segovia ha cambiado')
    const nombre = columna.find(i=>i.y<y && i.y>y-.020 && /^FARMACIA /.test(i.texto))?.texto
    const direccion = columna.filter(i=>Math.abs(i.y-y)<.001).map(i=>i.texto).join(' ')
    const pie = columna.filter(i=>i.y>y+.001 && i.y<y+.020).map(i=>i.texto).join(' ')
    const telefono = /(?:Tfno|Tlf)\.?:?\s*(\d{3})\s*(\d{6})\b/i.exec(pie)
    if (!nombre || !direccion || !telefono) throw new Error('Celda incompleta en Segovia')
    guardias.push([0,0,nombre+' · '+direccion+' '+pie.slice(0,telefono.index).trim(),'Segovia',telefono[1]+telefono[2],'',rangoGuardia(dia,inicio,fin),''])
  }
}
guardarGuardias('segovia','cofsegovia.com',guardias,{fecha,sourceUrl:enlace.href,min:2,max:3,guardiasVerificadas:true,cobertura:'Segovia capital.'})
