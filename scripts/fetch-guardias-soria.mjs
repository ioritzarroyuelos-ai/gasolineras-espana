#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { coordenadas, descargar, desplazaFecha, fechaMadrid, guardarGuardias, rangoGuardia, texto } from './lib/guardias-fetch.mjs'

const web = 'https://www.cofsoria.es/ciudadanos/farmacias-de-guardia/'
const fecha = fechaMadrid()
const detalles = new Map()
const guardias = []
for (const dia of [desplazaFecha(fecha,-1),fecha]) {
  const [anio,mes,d] = dia.split('-')
  const pagina = parse(await (await descargar(web + '?' + new URLSearchParams({dia: String(+d),mes: String(+mes),anio}))).text())
  for (const [campo,valor] of Object.entries({dia:d,mes,anio})) {
    if (Number(pagina.querySelector('select[name=' + campo + '] option[selected]')?.getAttribute('value')) !== Number(valor))
      throw new Error('La fecha devuelta por Soria no coincide con la consulta')
  }
  for (const grupo of pagina.querySelectorAll('.bloque-tipo-farmacia')) {
    const capital = texto(grupo.querySelector('h3')?.text) === 'Soria Capital'
    const leyenda = texto(grupo.text)
    if (capital ? !/9:00h del día indicado hasta las 9:00h del día siguiente/i.test(leyenda) : !/Hasta las 22:00.*24 Horas/i.test(leyenda))
      throw new Error('Soria ha cambiado la leyenda de horarios')
    if (!capital && dia !== fecha) continue
    for (const item of grupo.nextElementSibling?.querySelectorAll('.farmacia-item') || []) {
      const enlace = item.querySelector('.farmacia-ficha a')?.getAttribute('href')
      if (!/^\?farmacia=\d+$/.test(enlace || '')) throw new Error('Falta ficha de farmacia de Soria')
      if (!detalles.has(enlace)) detalles.set(enlace,parse(await (await descargar(web + enlace)).text()))
      const ficha = detalles.get(enlace)
      const municipio = texto(item.querySelector('.farmacia-municipio')?.text)
      if (municipio !== texto(ficha.querySelector('.ficha-municipio')?.text)) throw new Error('Ficha de otro municipio')
      const direccion = texto(item.querySelector('.farmacia-direccion')?.text)
      const titular = texto(ficha.querySelector('.ficha-titular')?.text)
      const campoTel = ficha.querySelectorAll('.ficha-dato').find(el => /teléfono guardia/i.test(el.querySelector('.ficha-dato-label')?.text || ''))
      const tel = (campoTel || ficha).querySelector('a[href^=tel]')?.getAttribute('href')?.slice(4) || ''
      const coord = ficha.toString().match(/L\.marker\(\[\s*([\d.]+),\s*(-[\d.]+)\s*\]/)
      const horas = capital ? rangoGuardia(dia,'09:00','09:00') : item.querySelector('.icon-luna') ? 'Guardia de 24 horas' : 'Guardia hasta las 22:00'
      guardias.push([...coordenadas(coord?.[1],coord?.[2],[41,42.2,-3.6,-1.8]),[titular,direccion].filter(Boolean).join(' · '),
        municipio,tel,'',horas,capital ? '' : 'El colegio indica que la atención puede ser localizada. Llama antes de acudir.'])
    }
  }
}
guardarGuardias('soria','cofsoria.es',guardias,{fecha,sourceUrl: web,min:3,max:60,guardiasVerificadas:true,coordenadasOficiales:true})
