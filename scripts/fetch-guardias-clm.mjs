#!/usr/bin/env node
// El Consejo de Colegios de CLM publica todos los turnos fechados en una consulta.
// Evita el barrido de 1.500 localidades del servicio antiguo, que agotaba el plazo.
import { descargarJSON, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseCLM } from './lib/guardias-fuentes.mjs'
async function main() {
  const fecha = fechaMadrid()
  const data = await descargarJSON('https://farmaciasdeguardia.cofcam.es/api.php?action=list&fecha=' + fecha)
  guardarGuardias('clm', 'farmaciasdeguardia.cofcam.es', parseCLM(data, fecha), { fecha, coordenadasOficiales: true, min: 30, max: 1500, sourceUrl: 'https://farmaciasdeguardia.cofcam.es/' })
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
