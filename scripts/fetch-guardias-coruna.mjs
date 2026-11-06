#!/usr/bin/env node
import { descargar, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseCoruna } from './lib/guardias-galicia.mjs'

const fecha = fechaMadrid()
const url = 'https://www.cofc.es/farmacia/index'
const html = await (await descargar(url)).text()
guardarGuardias('coruna', 'cofc.es', parseCoruna(html, fecha), {
  fecha, sourceUrl: url, min: 10, max: 200, coordenadasOficiales: true, guardiasVerificadas: true
})
