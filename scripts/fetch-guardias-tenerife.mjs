#!/usr/bin/env node
// v1.40 — Descarga las farmacias de guardia de la provincia de Santa Cruz
// de Tenerife desde la API JSON pública del COF Tenerife.
//
// Cubre las 4 islas occidentales: Tenerife, La Palma, La Gomera y El Hierro
// (53 municipios en el listado, agrupados todos bajo la provincia 38).
//
// Fuente:
//   1) GET https://www.coftenerife.es/farmacias/controller/server.php/api/municipios
//      → JSON [{IdTermino, Termino, TipoTermino:"M"}, ...] con los 53
//        municipios de la provincia.
//   2) GET .../api/municipios/<IdTermino>/open/now
//      → JSON con farmacias abiertas/de guardia ahora en ese municipio,
//        incluyendo lat/lng nativas, telefono, horario textual.
//      Header `Authorization: ` (vacío) requerido — el cliente JS lo manda
//      siempre porque la API valida que el header exista.
//
// CAVEAT — sin info de provincia "santa cruz de tenerife":
//   La provincia es la 38 pero el `IdTermino=38` corresponde al municipio
//   "santa cruz de tenerife" (la capital). Para cobertura completa
//   iteramos los 53 municipios.
//
// Schema output (compatible con el resto de guardias-*.json):
//   [lat, lng, direccion, poblacion, telefono, cp, horarioGuardia, horarioGuardiaDesc]

import { guardarGuardias } from './lib/guardias-fetch.mjs'
import { leerListadoTenerife } from './lib/guardias-tenerife.mjs'
import { calendarioTenerife, consultarCalendarios } from './lib/guardias-tenerife-calendario.mjs'

const API_BASE = 'https://www.coftenerife.es/farmacias/controller/server.php/api'
const REFERER = 'https://www.coftenerife.es/farmacias/'
const USER_AGENT = 'cercaya-guardias/1.40 (+https://webapp-3ft.pages.dev)'

// Bbox provincia Santa Cruz de Tenerife (incluye Tenerife + La Palma +
// La Gomera + El Hierro). Defensa contra coords basura.
const BBOX = { minLat: 27.5, maxLat: 28.9, minLng: -18.3, maxLng: -16.1 }

const HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Referer': REFERER,
  'User-Agent': USER_AGENT,
  'Authorization': '', // vacío pero presente — el cliente JS lo manda asi
}

async function fetchJson(url, permitirSinResultados = false, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) })
      return await leerListadoTenerife(res, permitirSinResultados)
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, i * 1000))
    }
  }
  throw lastErr
}

function titleCase(s) {
  return String(s || '').toLowerCase()
    .replace(/(^|[^\p{L}])(\p{L})/gu, (_, sep, c) => sep + c.toUpperCase())
}

async function main() {
  console.log('Descargando guardias Tenerife — coftenerife.es API JSON...')

  const fechaLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const fecha = fechaLocal()
  const municipios = await fetchJson(`${API_BASE}/municipios`)
  if (!Array.isArray(municipios)) throw new Error('Listado de municipios inválido')
  console.log(`  ${municipios.length} municipios detectados`)
  if (municipios.length < 30) {
    throw new Error(`Solo ${municipios.length} municipios. La estructura cambio?`)
  }
  if (municipios.length > 100) {
    throw new Error(`Sospechoso: ${municipios.length} municipios. Max razonable ~80.`)
  }

  const dedupe = new Map()
  const directorio = new Map()
  const porTitular = new Map()
  const porNombreYApellidos = new Map()
  const claveNombre = s => String(s || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()
    .replace(/^lcd[oa]s?\.?\s*(?:d(?:ña|na|ª)?\.?\s*)?/,'').replace(/\bm[ªº]\.?/g,'maria').replace(/[^a-z0-9]+/g,' ').trim()
  const claveCalle = s => claveNombre(String(s || '').split('(')[0]).replace(/^ctra /,'carretera ').trim()
  let descartadas = 0
  const errores = []
  for (const m of municipios) {
    try {
      for (const farmacia of await fetchJson(`${API_BASE}/municipios/${m.IdTermino}`, true)) {
        const tel = String(farmacia.telefono || '').replace(/\D/g,'')
        if (tel && farmacia.idFarmacia && farmacia.municipio) {
          if (!directorio.has(tel)) directorio.set(tel,new Map())
          directorio.get(tel).set(farmacia.idFarmacia,farmacia)
        }
        for (const titular of farmacia.infoTitulares || []) {
          const nombre=claveNombre(titular.nombreCompleto)
          if (!nombre || !farmacia.idFarmacia || !farmacia.municipio) continue
          if (!porTitular.has(nombre)) porTitular.set(nombre,new Map())
          porTitular.get(nombre).set(farmacia.idFarmacia,farmacia)
          const apellidos=claveNombre(titular.apellidos)
          if (apellidos.split(' ').length >= 2 && titular.nombre) {
            const identidad=claveNombre(titular.nombre).split(' ')[0]+'|'+apellidos
            if (!porNombreYApellidos.has(identidad)) porNombreYApellidos.set(identidad,new Map())
            porNombreYApellidos.get(identidad).set(farmacia.idFarmacia,farmacia)
          }
        }
      }
      const farmacias = await fetchJson(`${API_BASE}/municipios/${m.IdTermino}/open/now`, true)
      if (!Array.isArray(farmacias)) throw new Error('Respuesta de farmacias inválida')
      for (const f of farmacias) {
        const lat = parseFloat(f.latitud)
        const lng = parseFloat(f.longitud)
        if (!isFinite(lat) || !isFinite(lng)) { descartadas++; continue }
        if (lat < BBOX.minLat || lat > BBOX.maxLat) { descartadas++; continue }
        if (lng < BBOX.minLng || lng > BBOX.maxLng) { descartadas++; continue }
        const id = f.idFarmacia || `${lat},${lng}`
        if (dedupe.has(id)) continue
        dedupe.set(id, { ...f, lat, lng })
      }
    } catch (e) {
      const nombre = String(m.Termino || m.IdTermino)
      errores.push(nombre)
      console.error(`    ${nombre}: ${e.message}`)
    }
    // Pausa minima para no martillear el backend.
    await new Promise(r => setTimeout(r, 80))
  }
  console.log(`  ${dedupe.size} farmacias unicas, ${descartadas} fuera bbox, ${errores.length} municipios con error`)

  if (errores.length > municipios.length * 0.5) {
    throw new Error(`Demasiados errores (${errores.length}/${municipios.length}). API caida?`)
  }
  if (dedupe.size < 5) {
    throw new Error(`Solo ${dedupe.size} farmacias validas. Abortamos.`)
  }

  const calendario = await consultarCalendarios(fecha)
  const guardias = [], conGuardiaHoy = new Set(), vistos = new Set()
  const pendientes = new Set(calendario.pendientes)
  const avisosMunicipales = {}
  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
  for (const turno of calendario.turnos) {
    let farmacias = directorio.get(turno.telefono)
    if (farmacias?.size !== 1) {
      const nombre=claveNombre(turno.nombre)
      farmacias=porTitular.get(nombre)
      // El cartel a veces abrevia el segundo nombre. Los dos apellidos, el
      // primer nombre y una única oficina en el directorio deben coincidir.
      if (!farmacias) {
        const coincidencias = new Map()
        for (const [identidad, oficinas] of porNombreYApellidos) {
          const [primero, apellidos] = identidad.split('|')
          if (nombre.startsWith(primero+' ') && nombre.endsWith(' '+apellidos))
            for (const [id, oficina] of oficinas) coincidencias.set(id, oficina)
          else if (apellidos.startsWith('de ') && nombre.startsWith(primero+' ') && nombre.endsWith(' '+apellidos.slice(3))) {
            for (const [id, oficina] of oficinas) {
              if (claveCalle(oficina.direccion)===claveCalle(turno.direccion)) coincidencias.set(id,oficina)
            }
          }
        }
        farmacias=coincidencias
      }
    }
    // Las zonas del PDF pueden reunir varios pueblos. Sólo el directorio
    // identifica el municipio de la oficina; no se usa el nombre de la zona.
    const localidadEntreParentesis = /\(([^()]+)\)\.?$/.exec(turno.direccion)?.[1]
    const lugarExplicito = municipios.filter(m => localidadEntreParentesis && slug(m.Termino)===slug(localidadEntreParentesis) && ('-'+slug(turno.zona)+'-').includes('-'+slug(m.Termino)+'-'))
    const f = farmacias?.size===1 ? [...farmacias.values()][0] : lugarExplicito.length===1 ? {municipio:lugarExplicito[0].Termino} : null
    if (!f) { pendientes.add(turno.zona); continue }
    if (turno.dia === fecha && /^\d{4}-\d\d-\d\d /.test(turno.horario)) {
      const hora = instante => instante.slice(8,10)+'/'+instante.slice(5,7)+' a las '+instante.slice(-5)
      const desde = turno.horario.slice(0,16), hasta = turno.horario.slice(17)
      const zona = '-'+slug(turno.zona)+'-'
      for (const municipio of municipios) {
        const lugar = slug(municipio.Termino)
        if (!lugar || !zona.includes('-'+lugar+'-') || lugar===slug(f.municipio)) continue
        const aviso = 'El turno de la zona se atiende en '+titleCase(f.municipio)+', en '+turno.direccion+'. Del '+hora(desde)+' al '+hora(hasta)+'. '+(turno.nota ? turno.nota+'. ' : '')+'Teléfono '+turno.telefono+'.'
        const avisos = avisosMunicipales[lugar] ??= []
        if (!avisos.includes(aviso)) avisos.push(aviso)
      }
    }
    const etiqueta = ['Calendario de guardias del colegio',turno.nota].filter(Boolean).join(' · ')
    const clave = JSON.stringify([turno.telefono,turno.horario,etiqueta])
    if (vistos.has(clave)) continue
    vistos.add(clave)
    guardias.push([Number(f.latitud) || 0, Number(f.longitud) || 0,
      turno.nombre+' · '+turno.direccion, titleCase(f.municipio), turno.telefono, '', turno.horario, etiqueta])
    if (turno.dia === fecha && f.idFarmacia) conGuardiaHoy.add(f.idFarmacia)
  }
  for (const f of dedupe.values()) {
    if (conGuardiaHoy.has(f.idFarmacia)) continue
    const titNombre = titleCase(f.nombreFarmacia || '')
    const dirRaw = f.direccion || ''
    const dirFinal = `${titNombre} · ${titleCase(dirRaw)}`.replace(/\s+·\s*$/, '')
    const telefono = String(f.telefono || '').replace(/\s+/g, '')
    const horario = String(f.descripcionHorario || '').trim()
    const horarioDesc = f.zonaGuardia ? `Zona: ${f.zonaGuardia}` : ''
    guardias.push([
      Math.round(f.lat * 1e5) / 1e5,
      Math.round(f.lng * 1e5) / 1e5,
      dirFinal.slice(0, 140),
      titleCase(f.municipio || ''),
      telefono,
      '', // CP no expuesto en este endpoint
      horario,
      horarioDesc,
    ])
  }

  if (fechaLocal() !== fecha) throw new Error('Cambio de día durante la consulta; se conserva el último fichero')
  guardarGuardias('tenerife', 'coftenerife.es', guardias, {
    min: 5, sourceUrl: calendarioTenerife, horariosCompletos: true, guardiasVerificadas: true,
    fecha, avisosMunicipales,
    cobertura: 'Las guardias proceden del calendario del colegio. Las demás fichas muestran horarios de apertura.',
    incidencias: [
      ...(pendientes.size ? ['Consulta el calendario original para los turnos sin verificar en '+[...pendientes].join(', ')+'.'] : []),
      ...(errores.length ? [`Cobertura parcial: ${errores.length} de ${municipios.length} municipios no se pudieron comprobar (${errores.join(', ')}).`] : []),
      ...(descartadas ? [`${descartadas} fichas omitidas por coordenadas inválidas.`] : []),
    ],
  })
}

main().catch(e => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
