import { desplazaFecha, rangoGuardia } from './guardias-fetch.mjs'

const canon = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

export function turnosEspeciales(paginas, zona, fecha) {
  const nombre = canon(zona)
  if (nombre==='25' || nombre==='SANTA CRUZ DE TENERIFE') return [] // Cartel mixto sin día de guardia.
  if (!['16','17'].includes(nombre) && !/^LA MATANZA|^LA OROTAVA/.test(nombre)) return null
  const zonaImpresa = nombre === '16' || nombre.startsWith('LA MATANZA')
    ? 'LA MATANZA, LA VICTORIA, SANTA URSULA, TACORONTE Y EL SAUZAL' : 'LA OROTAVA - LOS REALEJOS'
  const mes = new Date(fecha+'T12:00:00Z')
  const dia = mes.getUTCDate()
  const rotulo = dia+' '+mes.toLocaleString('es',{weekday:'long',timeZone:'UTC'})
  const cabecera = canon(meses[mes.getUTCMonth()]+' '+mes.getUTCFullYear())
  const pagina = paginas.find(p=>p.some(i=>i.y < .14 && canon(i.texto) === zonaImpresa + ' ' + cabecera) && p.some(i=>i.texto===rotulo))
  if (!pagina || !pagina.some(i=>/HASTA LAS 12H DE LA NOCHE/.test(i.texto)) || !pagina.some(i=>i.texto==='24 HORAS'))
    throw new Error('El colegio no presenta los dos turnos de '+fecha+' en '+zona)
  const filas = []
  for (const noche of [false,true]) {
    const columna = pagina.filter(i=>noche ? i.x>=.50 : i.x<.50)
    const posicion = columna.find(i=>i.texto===rotulo)?.y
    if (!posicion) throw new Error('Falta la fecha de una columna en '+zona)
    const celda = columna.filter(i=>i.y>posicion-.037 && i.y<posicion+.075)
    const tiempos = celda.filter(i=>i.x<(noche ? .64 : .16)).map(i=>i.texto)
    const lineas = celda.filter(i=>i.x>=(noche ? .64 : .16)).sort((a,b)=>Math.abs(a.y-b.y)<.003?a.x-b.x:a.y-b.y)
    const tel = lineas.find(i=>/^\(\s*\d[\d -]{7,}\d\s*\)$/.test(i.texto))
    const titular = lineas.find(i=>/^Lcd[oa]s?\.?/i.test(i.texto))
    const direccion = lineas.find(i=>/^(?:C[/.]\s*|Calle\b|Ctra\.?|Carretera\b|Av(?:da|\.)|Avenida\b|Camino\b|Plaza\b|Paseo\b|Urbanizaci[oó]n\b)/i.test(i.texto))
    if (!tel || !titular || !direccion || direccion.y<=titular.y || tel.y<=direccion.y)
      throw new Error('La celda de '+zona+' del '+fecha+' no identifica farmacia, dirección y teléfono')
    const comienza = new RegExp('^'+dia+' \\S+ 09:00h a '+(noche?'23:59':'00:00')+'h$')
    const siguiente = Number(desplazaFecha(fecha,1).slice(-2))
    if (!tiempos.some(t=>comienza.test(t)) || (noche && !tiempos.some(t=>new RegExp('^'+siguiente+' \\S+ 00:00h a 09:00h$').test(t))))
      throw new Error('Horario no reconocido en '+zona+' el '+fecha)
    filas.push({nombre:lineas.filter(i=>i.y>=titular.y-.001 && i.y<direccion.y-.001).map(i=>i.texto).join(' '),
      direccion:lineas.filter(i=>i.y>=direccion.y-.001 && i.y<tel.y-.001).map(i=>i.texto).join(' '),
      telefono:tel.texto.replace(/\D/g,''),horario:rangoGuardia(fecha,'09:00',noche?'09:00':'00:00'),nota:''})
  }
  return filas
}
