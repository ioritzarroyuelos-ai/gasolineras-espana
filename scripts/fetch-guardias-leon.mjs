#!/usr/bin/env node
import { PDFParse } from 'pdf-parse'
import { descargar, desplazaFecha, fechaMadrid, guardarGuardias, rangoGuardia } from './lib/guardias-fetch.mjs'

const url = 'https://www.aytobaneza.es/export/sites/aytobaneza/galerias/descargas/policia/FarmaciasGuardia.pdf'
const fecha = fechaMadrid()
const pdf = new PDFParse({data:new Uint8Array(await (await descargar(url)).arrayBuffer())})
let texto
try { texto = (await pdf.getText()).text } finally { await pdf.destroy() }
if (!/FARMACIA DE GUARDIA DESDE LAS 9:00 HASTA LAS 9:00 DEL DIA SIGUIENTE/i.test(texto)) throw new Error('Horario de La Bañeza desconocido')
const farmacias = new Map(Array.from(texto.matchAll(/^([A-E])\)\s*(Lcd[oa]\.\s*[^\n]+?)\s*\n\s*Direcci[óo]n:\s*([^\n]+?)\s*\n\s*Tfno\.:?\s*([\d ]+)$/gim), m=>[m[1],m]))
const meses = [...texto.matchAll(/^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/gim)]
const guardias = []
for (const dia of [desplazaFecha(fecha,-1),fecha]) {
  const mes = new Date(dia+'T12:00Z').toLocaleString('es',{month:'long',timeZone:'UTC'})
  const idx = meses.findIndex(m=>m[1].toLowerCase()===mes)
  if (idx<0 && dia!==fecha) continue
  if (idx<0) throw new Error('El PDF no contiene el mes solicitado')
  const bloque = texto.slice(meses[idx].index,meses[idx+1]?.index)
  if (!new RegExp('\\b'+dia.slice(0,4)+'\\b').test(bloque)) {
    if (dia!==fecha) continue
    throw new Error('El calendario municipal es de otro año')
  }
  const letra = new RegExp('\\b([A-E])\\s+'+Number(dia.slice(-2))+'\\b').exec(bloque)
  const f = letra && farmacias.get(letra[1])
  if (!f) throw new Error('El turno no identifica una farmacia de La Bañeza')
  guardias.push([0,0,f[2]+' · '+f[3],'La Bañeza',f[4].replace(/\s+/g,''),'',rangoGuardia(dia,'09:00','09:00'),''])
}
guardarGuardias('leon','aytobaneza.es',guardias,{fecha,sourceUrl:url,guardiasVerificadas:true,cobertura:'La Bañeza. Calendario de la Policía Local.'})
