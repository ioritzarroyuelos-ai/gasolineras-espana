#!/usr/bin/env node
import { descargarJSON, desplazaFecha, fechaMadrid, guardarGuardias, rangoGuardia, texto } from './lib/guardias-fetch.mjs'

const url = 'https://datosabiertos.navarra.es/es/datastore/dump/e309e89e-d62e-4222-b6fa-e81d0924a086?format=json'
const fecha = fechaMadrid()
const ayer = desplazaFecha(fecha,-1)
const data = await descargarJSON(url)
const titulos = data.fields?.map(f=>f.id)
if (!['fecha','desde','hasta','localidad','grupo','direccion','farmacia','cod_Farmacia','telefono'].every(k=>titulos?.includes(k)))
  throw new Error('Navarra ha cambiado los campos de las guardias')
const filas = new Map()
for (const dia of [ayer,fecha]) {
  const registros = data.records.filter(v=>v[titulos.indexOf('fecha')]===dia.split('-').reverse().join('/'))
  if (dia===fecha && registros.length<5) throw new Error('El calendario no cubre la fecha actual')
  for (const v of registros) {
    const campo = n=>texto(v[titulos.indexOf(n)])
    const hora = n=>{
      const m = /^([0-9]|1[0-9]|2[0-3])(?:[:.]([0-5]\d))?$/.exec(campo(n))
      if (!m) throw new Error('Hora de guardia desconocida en Navarra')
      return m[1].padStart(2,'0')+':'+(m[2]||'00')
    }
    const inicio = hora('desde'), fin = hora('hasta')
    if (dia===ayer && fin>=inicio) continue
    const horas = inicio===fin ? 'Horario por confirmar' : rangoGuardia(dia,inicio,fin)
    filas.set([dia,campo('cod_Farmacia'),inicio,fin].join('|'),[0,0,campo('farmacia')+' · '+campo('direccion'),
      campo('localidad'),campo('telefono'),'',horas,campo('grupo')])
  }
}
guardarGuardias('navarra','datosabiertos.navarra.es',[...filas.values()],{fecha,sourceUrl:url,min:5,max:250,guardiasVerificadas:true})
