#!/usr/bin/env node
// COFA v2: servicio público enlazado por el buscador oficial (noviembre de 2026).
import { descargarJSON, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { parseAlicante } from './lib/guardias-fuentes.mjs'
const API = 'https://cofalicante.com/wp-json/wp-cofa/v2'
async function main() {
  const fecha = fechaMadrid()
  const localidades = await descargarJSON(API + '/locations')
  if (!Array.isArray(localidades) || localidades.length < 50) throw new Error('COFA: localidades incompletas')
  const zonas = [...new Set(localidades.map(l => l.value).filter(Boolean))]
  const turnos = new Map()
  for (const zona of zonas) {
    const data = await descargarJSON(API + '/pharmacies?' + new URLSearchParams({ d: fecha, l: zona }))
    for (const row of parseAlicante(data, fecha)) turnos.set(JSON.stringify(row), row)
    await new Promise(r => setTimeout(r, 150))
  }
  guardarGuardias('alicante', 'cofalicante.com', [...turnos.values()], { fecha, min: 10, max: 600, sourceUrl: 'https://cofalicante.com/farmacias-de-guardia/' })
}
main().catch(e => { console.error('ERROR:', e.message); process.exitCode = 1 })
