import { parse } from 'node-html-parser'
import { descargar, descargarJSON, desplazaFecha, rangoGuardia } from './guardias-fetch.mjs'
import { paginasConPosicion } from './guardias-pdf-posicion.mjs'
import { turnosEspeciales } from './guardias-tenerife-especiales.mjs'

export const calendarioTenerife = 'https://www.coftenerife.es/ciudadanos/farmacias-de-guardia/'
const limpio = s => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\d]+/gu, ' ').trim().toLowerCase()
const dias = ['dom','lun','mar','mie','jue','vie','sab']

export function turnosDeUnaColumna(pagina, zona, fecha) {
  const cabecera = pagina.filter(p => p.y < .14).map(p => limpio(p.texto))
  const dia = new Date(fecha + 'T12:00Z')
  const mes = dia.toLocaleDateString('es', { month: 'long', timeZone: 'UTC' }) + ' ' + dia.getUTCFullYear()
  if (!cabecera.includes(mes) || !cabecera.some(t => t === limpio(zona) || t.startsWith(limpio(zona) + ' '))) throw Error('El cartel no corresponde al mes y zona solicitados')
  const etiqueta = dia.getUTCDate() + ' ' + dias[dia.getUTCDay()]
  const enFila = (p, y) => Math.abs(p.y - y) < .003
  const filas = []
  for (const fechaImpresa of pagina.filter(p => p.x < .07 && limpio(p.texto) === etiqueta)) {
    const y = fechaImpresa.y
    const horario = pagina.find(p => p.x > .07 && p.x < .21 && enFila(p, y))?.texto
    // La madrugada aparece debajo del titular del día anterior. Se obtiene con
    // el cartel y la fila del día de inicio; nunca se toma el titular siguiente.
    if (!horario || horario.startsWith('00:00h') || horario.startsWith('D-F ')) continue
    const nombre = pagina.find(p => p.x >= .21 && p.x < .80 && enFila(p, y))?.texto
    const telefono = pagina.find(p => p.x >= .80 && enFila(p, y))?.texto.replace(/\D/g,'')
    const direccion = pagina.find(p => p.x >= .21 && p.x < .80 && p.y > y+.006 && p.y < y+.022)?.texto
    if (!nombre || !direccion) throw Error('Fila del calendario incompleta')
    const intervalo = /^(\d\d:\d\d)h a (\d\d:\d\d)h$/.exec(horario)
    const datos = { nombre, direccion, telefono }
    if (!intervalo) {
      if (!/^[6789]\d{8}$/.test(telefono)) throw Error('Falta el teléfono')
      // La hora de cierre cambia en festivos locales. Conservamos las dos reglas.
      if (!/^L-S HASTA \d\d:\d\d$/.test(horario)) throw Error('Franja sin identificar')
      const reglas = pagina.filter(p => p.y < .14 && /^(L-S|D-F):/.test(p.texto)).map(p => p.texto)
      if (reglas.length !== 2) throw Error('Falta la condición de festivos')
      filas.push({ ...datos, horario: reglas.join(' · '), nota: '' })
      continue
    }
    const [, inicio, fin] = intervalo
    let finReal = fin
    if (fin === '23:59') {
      const manana = new Date(desplazaFecha(fecha,1)+'T12:00Z')
      const relevo = pagina.find(p => p.x<.07 && p.y>y && p.y<y+.02 && limpio(p.texto) === manana.getUTCDate()+' '+dias[manana.getUTCDay()])
      const continuidad = relevo && pagina.find(p => p.x>.07 && p.x<.21 && enFila(p,relevo.y))?.texto
      if (inicio !== '09:00' || continuidad !== '00:00h a 09:00h' || !cabecera.some(t => t.includes('dia siguiente'))) throw Error('Relevo nocturno sin confirmar')
      finReal = '09:00'
    }
    const modalidad = cabecera.find(t => t.includes('localizada')) || ''
    if (!/^[6789]\d{8}$/.test(telefono)) {
      // Dos titulares, cada uno junto a su propio teléfono y tramo horario.
      const dobles = [nombre,direccion].map(linea => /^(.+) - (.+) - \(([6789][\d -]+)\)$/.exec(linea))
      if (finReal!=='09:00' || !/^guardia localizada 24\s*h$/.test(modalidad) || !dobles.every(f => f && f[3].replace(/\D/g,'').length===9)) throw Error('Fila con titular o teléfono ambiguo')
      for (const [i,m] of dobles.entries()) {
        filas.push({nombre:m[1],direccion:m[2],telefono:m[3].replace(/\D/g,''),nota:'Guardia localizada: llama antes de acudir',
          horario:i===0 ? rangoGuardia(fecha,inicio,fin) : rangoGuardia(desplazaFecha(fecha,1),'00:00',finReal)})
      }
      continue
    }
    if (!modalidad || /^guardia localizada 24\s*h$/.test(modalidad)) {
      filas.push({ ...datos, horario:rangoGuardia(fecha,inicio,finReal), nota: modalidad ? 'Guardia localizada: llama antes de acudir' : '' })
    } else {
      const cambio = modalidad === 'guardia localizada a partir de las 22 horas' ? '22:00' : modalidad === 'guardia localizada a partir de las 12 de la noche' ? '00:00' : ''
      if (!cambio || inicio!=='09:00' || finReal!=='09:00') throw Error('Modalidad presencial sin delimitar')
      filas.push({ ...datos, horario:rangoGuardia(fecha,inicio,cambio), nota:'' })
      filas.push({ ...datos, horario:rangoGuardia(cambio==='00:00'?desplazaFecha(fecha,1):fecha,cambio,finReal), nota:'Guardia localizada: llama antes de acudir' })
    }
  }
  if (!filas.length) throw Error('El cartel no contiene una fila de guardia para la fecha')
  return filas
}

function urlDelColegio(valor, base = calendarioTenerife) {
  const url = new URL(valor,base)
  if (url.origin !== new URL(calendarioTenerife).origin || url.username || url.password) throw Error('Enlace externo al calendario')
  return url
}

export async function consultarCalendarios(fecha) {
  const ayer = desplazaFecha(fecha,-1)
  const porMes = new Map()
  for (const dia of [fecha,ayer]) {
    const clave=dia.slice(0,7)
    if (!porMes.has(clave)) porMes.set(clave,[])
    porMes.get(clave).push(dia)
  }
  const turnos = [], pendientes = new Set()
  for (const [mes,diasCalendario] of porMes) {
    const [anio,numeroMes]=mes.split('-')
    const indice = await descargarJSON(urlDelColegio('/wp-admin/admin-ajax.php?action=getguardias&fecha='+numeroMes+'%7C'+anio))
    if (!Array.isArray(indice?.data) || indice.data.length<1) throw Error('Calendario mensual no disponible')
    for (const {zona,link} of indice.data) {
      try {
        const enlace=parse(link).querySelector('a')?.getAttribute('href')
        if (!enlace) throw Error('Falta el cartel')
        const paginaPdf=urlDelColegio(enlace)
        const periodo = /^(.*)\/(\d{4})\/(\d{1,2})$/.exec(paginaPdf.searchParams.get('guardias') || '')
        if (!periodo || periodo[1]!==zona || periodo[2]!==anio || Number(periodo[3])!==Number(numeroMes)) throw Error('Zona o mes del enlace incorrectos')
        const html=await (await descargar(paginaPdf)).text()
        const rutaVisor=/location\.href=['"]([^'"]+)['"]/.exec(html)?.[1]
        if (!rutaVisor) throw Error('Falta el visor')
        const visor=urlDelColegio(rutaVisor)
        const destino=visor.searchParams.get('file')
        if (!destino) throw Error('Falta el documento')
        const paginas=await paginasConPosicion(await (await descargar(urlDelColegio(destino,visor))).arrayBuffer())
        for (const dia of diasCalendario) {
          const filas=turnosEspeciales(paginas,zona,dia) ?? turnosDeUnaColumna(paginas[0],zona,dia)
          if (!filas.length) pendientes.add(zona)
          // Un cierre condicional sin fecha de fin no se traslada al día siguiente.
          turnos.push(...filas.filter(f => dia===fecha || /^\d{4}-\d\d-\d\d /.test(f.horario)).map(f => ({...f,zona,dia})))
        }
      } catch (e) { pendientes.add(zona); console.warn(zona+': '+e.message) }
      // El servidor del colegio genera los nombres de archivo por segundo.
      await new Promise(resolve => setTimeout(resolve,1050))
    }
  }
  return {turnos, pendientes:[...pendientes]}
}
