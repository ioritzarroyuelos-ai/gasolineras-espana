#!/usr/bin/env node
import { descargarJSON, desplazaFecha, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseOurense } from './lib/guardias-galicia.mjs'

const fecha = fechaMadrid()
const ayer = desplazaFecha(fecha, -1)
const api = 'https://www.cofourense.es/wp-json/vcomm/v1/farmacias/guardia?estilo=completo&fecha='
const [hoy, anterior] = await Promise.all([descargarJSON(api + fecha), descargarJSON(api + ayer)])
guardarGuardias('ourense', 'cofourense.es', [...parseOurense(anterior, ayer, true), ...parseOurense(hoy, fecha)], {
  fecha, sourceUrl: api + fecha, min: 5, max: 200, coordenadasOficiales: true, guardiasVerificadas: true
})
