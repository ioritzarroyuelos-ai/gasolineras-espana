#!/usr/bin/env node
import { coordenadas, descargarJSON, desplazaFecha, fechaMadrid, guardarGuardias, texto } from './lib/guardias-fetch.mjs'

const fuente = 'https://www.cofhuesca.com/farmacias-de-guardia'
const fecha = fechaMadrid()
const fechaES = dia => dia.split('-').reverse().join('/')
const ayer = desplazaFecha(fecha, -1)
const url = new URL('/Procesar/procesar.php', fuente)
url.search = new URLSearchParams({ controller: 'ControllerFarmaciaGuardia', seleccionFarmacia: '1', idZona: '', idPoblacion: '', fecha: fechaES(fecha) })
const lista = await descargarJSON(url)
if (!Array.isArray(lista)) throw new Error('COFH: lista de guardias ilegible')

const turnos = lista.map(f => {
  if (!f.id || !f.nombre || !f.direccion || !f.poblacion || ![fechaES(fecha), fechaES(ayer)].includes(f.fecha)) {
    throw new Error('COFH: guardia incompleta o de otro día')
  }
  // Misma regla que la tabla pública del colegio. Para el turno que empieza
  // hoy publica «a partir de las 9», sin indicar una hora de finalización.
  const horario = f.fecha === fechaES(fecha) ? 'Desde las 09:00 del ' + f.fecha : fecha + ' 00:00-' + fecha + ' 09:00'
  const localizada = String(f.guardiaLocalizada) === '1'
  return [...coordenadas(f.latitud, f.longitud, [41.4, 43, -1, 1]), texto(f.nombre) + ' · ' + texto(f.direccion),
    texto(f.poblacion), texto(localizada ? f.telefonoGL || f.telefono : f.telefono), '', horario,
    localizada ? 'Guardia localizada: llama antes de acudir' : 'Farmacia de guardia']
})
// «refuerzo» nombra otra localidad que atiende a la zona. No identifica a esta farmacia.
guardarGuardias('huesca', 'cofhuesca.com', turnos, { fecha, sourceUrl: fuente, guardiasVerificadas: true, coordenadasOficiales: true, min: 3, max: 150 })
