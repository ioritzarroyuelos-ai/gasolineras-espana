#!/usr/bin/env node
import { descargarJSON, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parsePontevedra } from './lib/guardias-galicia.mjs'

const fecha = fechaMadrid()
const data = await descargarJSON('https://farmacias.cofpo.org/farmaciasguardia.php', {
  method: 'POST', body: new URLSearchParams({ search_fecha: fecha.split('-').reverse().join('/') })
})
guardarGuardias('pontevedra', 'cofpo.org', parsePontevedra(data, fecha), {
  fecha, sourceUrl: 'https://farmacias.cofpo.org/', min: 10, max: 500, coordenadasOficiales: true, guardiasVerificadas: true
})
