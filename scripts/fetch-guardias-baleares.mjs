#!/usr/bin/env node
import { parse } from 'node-html-parser'
import { coordenadas, descargar, descargarJSON, desplazaFecha, fechaMadrid, guardarGuardias, rangoGuardia, texto } from './lib/guardias-fetch.mjs'

const fuente = 'https://www.cofib.es/es/Cercador.aspx'
const api = 'https://www.cofib.es/Scripts/ajax/FOWS.asmx/FarmaciesObertes'
const fecha = fechaMadrid()
const directorio = new Map()
for (const isla of [1, 2, 3]) { // Mallorca, Menorca y Pitiusas (Eivissa y Formentera).
  const doc = parse(await (await descargar(fuente + '?illa=' + isla)).text())
  const fichas = doc.querySelectorAll('.card-text')
  if (!fichas.length) throw new Error('COFIB: directorio insular incompleto')
  for (const ficha of fichas) {
    const enlace = ficha.querySelector('a[id$=rptMapa]')?.getAttribute('href')
    const registro = /\.\s*([^.]+?)\.\s*([\d\s+()-]+)\.\s*$/.exec(ficha.structuredText.trim())
    const coords = enlace && new URL(enlace).searchParams.get('query')?.split(',').map(Number)
    if (!coords || !registro) continue
    const clave = coords.map(c => c.toFixed(5)).join(',') + '|' + registro[2].replace(/\D/g, '')
    if (directorio.has(clave) && directorio.get(clave) !== registro[1]) throw new Error('COFIB: municipio ambiguo')
    directorio.set(clave, registro[1].trim())
  }
}

const porFarmacia = new Map()
for (let hora = 0; hora < 24; hora++) {
  const minuto = hora * 60 + 30
  const data = await descargarJSON(api, {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ data: fecha + 'T00:00:00', hora: minuto, nord: 40.5, sud: 38.5, est: 4.5, oest: 1, programa: '' }),
  })
  if (!Array.isArray(data.d) || !data.d.length) throw new Error('COFIB: respuesta incompleta')
  for (const f of data.d) {
    if (f.ObertaGuardia !== true) continue
    if (!f.NConselleria || !f.Nom || !f.Adreça) throw new Error('COFIB: turno sin identificar')
    const coord = coordenadas(f.Latitud, f.Longitud, [38.4, 40.6, 0.9, 4.6])
    const clave = coord.map(c => c.toFixed(5)).join(',') + '|' + texto(f.Telefon).replace(/\D/g, '')
    const municipio = directorio.get(clave)
    if (!municipio) throw new Error('COFIB: el directorio no confirma el municipio de la farmacia ' + f.NConselleria)
    const id = f.NConselleria
    if (!porFarmacia.has(id)) {
      porFarmacia.set(id, { fila: [...coord, texto(f.Nom) + ' · ' + texto(f.Adreça), municipio, texto(f.Telefon), '', '', ''], intervalos: new Set(), sinHorario: false })
    }
    const turno = porFarmacia.get(id)
    // TextHorari es la apertura normal. Solo TextGuardia describe la urgencia.
    const m = /SERVEI D'URGÈNCIA[^\d]*(\d{2}:\d{2})\s*(?:-|a)\s*(\d{2}:\d{2})/i.exec(texto(f.TextGuardia))
    const reloj = String(hora).padStart(2, '0') + ':30'
    if (!m || m[1] === m[2]) { turno.sinHorario = true; continue }
    const noche = m[2] < m[1]
    if (noche ? reloj >= m[2] && reloj < m[1] : reloj < m[1] || reloj >= m[2]) { turno.sinHorario = true; continue }
    const inicio = noche && reloj < m[2] ? desplazaFecha(fecha, -1) : fecha
    turno.intervalos.add(rangoGuardia(inicio, m[1], m[2]))
  }
}
const turnos = [...porFarmacia.values()].map(({ fila, intervalos, sinHorario }) => {
  fila[6] = [...intervalos].sort().join(' / ')
  if (sinHorario) fila[7] = 'El colegio también señala servicio de urgencias sin precisar todas las horas'
  return fila
})
guardarGuardias('baleares', 'cofib.es', turnos, { fecha, sourceUrl: fuente, guardiasVerificadas: true, coordenadasOficiales: true, min: 3, max: 500 })
