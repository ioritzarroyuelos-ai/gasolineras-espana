#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { descargar, fechaMadrid, guardarGuardias, texto } from './lib/guardias-fetch.mjs'

const fecha = fechaMadrid()
const [anio,mes,dia] = fecha.split('-')
const url = 'https://www.cofzamora.es/admin/config/media/ver_mes_completo'
const pagina = parse(await (await descargar(url)).text())
const elegido = campo => pagina.querySelector('select[name=' + campo + '] option[selected]')?.getAttribute('value')
if (elegido('listaAnios') !== anio || elegido('listaMeses') !== mes || elegido('zonasGuardia') !== 'Zamora Capital')
  throw new Error('El calendario visible no corresponde a Zamora capital en el mes solicitado')
const farmacias = new Map()
for (const turno of ['fardiurna','farnoc']) {
  const prefijo = new RegExp('^edit-' + Number(mes) + '-\\d+-\\d+-' + Number(dia) + '-' + turno + '-detalles(nombre|direccion|telefono)$')
  const campos = {}
  for (const label of pagina.querySelectorAll('table label[data-drupal-selector]')) {
    const campo = prefijo.exec(label.getAttribute('data-drupal-selector'))?.[1]
    if (campo) campos[campo] = texto(label.text).replace(/^[^:]+:\s*/, '')
  }
  if (!campos.nombre || !campos.direccion) throw new Error('Falta el turno de Zamora capital')
  const key = campos.nombre + ' · ' + campos.direccion
  if (!farmacias.has(key)) farmacias.set(key,{tel: campos.telefono, tipos: []})
  farmacias.get(key).tipos.push(turno === 'fardiurna' ? 'diurno' : 'nocturno')
}
const filas = [...farmacias].map(([dir,f]) => [0,0,dir,'Zamora',f.tel || '','','Turno ' + f.tipos.join(' y '),''])
guardarGuardias('zamora','cofzamora.es',filas,{
  fecha, sourceUrl: url, guardiasVerificadas: true, min: 1, max: 2,
  cobertura: 'Zamora capital. Para las demás zonas, consulta el servicio de urgencia que publica el colegio.'
})
