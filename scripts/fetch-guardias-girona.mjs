#!/usr/bin/env node
import { descargar, fechaMadrid, guardarGuardias } from './lib/guardias-fetch.mjs'
import { consultaGirona, GIRONA_SOURCE } from './lib/guardias-girona.mjs'

const fecha = fechaMadrid()
const turnos = await consultaGirona(fecha, async (url, init) => (await descargar(url, init)).text())
guardarGuardias('girona', 'cofgi.org', turnos, { fecha, sourceUrl: GIRONA_SOURCE, guardiasVerificadas: true, min: 5, max: 600,
  cobertura: 'Turnos del día solicitado y guardias nocturnas de la víspera que terminan hoy. Las guardias localizadas requieren llamar antes de acudir.' })
