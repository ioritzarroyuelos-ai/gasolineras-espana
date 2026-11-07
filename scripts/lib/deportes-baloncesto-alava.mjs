import { parse } from 'node-html-parser'
import { createHash } from 'node:crypto'
import { fechaDeportiva, leerFuenteDeportiva } from './deportes.mjs'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'

const WEB = 'https://www.basketaraba.com'
const CALENDARIO = WEB + '/es/fab-online/calendario-y-resultados-federacion-alavesa-de-baloncesto'
const TABLA = WEB + '/es/fab-online/clasificaciones-federacion-alavesa-de-baloncesto'
const FUENTE = 'Federación Alavesa de Baloncesto', PORTAL = 'basket-alava', HORA = 3600000
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const sinEtiquetas = nodo => { const copia = parse(nodo.innerHTML); copia.querySelectorAll('.tit-mobil').forEach(n => n.remove()); return texto(copia.text) }
const urlGrupo = (g, tabla = false) => (tabla ? TABLA : CALENDARIO) + '?grupo=' + g.codigo + '&seccion=' + (tabla ? '0' : '2')
function identidad(doc, grupo) {
  if (texto(doc.querySelector('p.tit-equipo')?.text) !== 'GRUPO: ' + grupo.codigo + ' ' + grupo.nombre) throw Error('Álava devuelve otro grupo')
}
export function gruposAlava(html) {
  const tabla = parse(html).querySelector('table.fab-online')
  if (!tabla || texto(tabla.querySelector('thead')?.text) !== 'CÓDIGO GRUPO CATEGORÍA') throw Error('Álava no identifica el catálogo de grupos')
  const grupos = tabla.querySelectorAll('tbody tr').map(tr => {
    const c = tr.querySelectorAll('td'), valores = c.map(sinEtiquetas)
    if (c.length !== 3 || !/^\d{4}$/.test(valores[0]) || !valores[1] || !valores[2]) throw Error('Grupo de Álava incompleto')
    const url = new URL(c[0].querySelector('a')?.getAttribute('href') || '', CALENDARIO)
    if (url.origin !== WEB || url.searchParams.get('grupo') !== valores[0] || url.searchParams.get('seccion') !== '2') throw Error('Enlace de Álava no reconocido')
    return { codigo: valores[0], nombre: valores[1], categoria: valores[2] }
  })
  if (!grupos.length || new Set(grupos.map(g => g.codigo)).size !== grupos.length) throw Error('Catálogo de Álava vacío o duplicado')
  return grupos
}
export function calendarioAlava(html, grupo, ahora = Date.now()) {
  const doc = parse(html); identidad(doc, grupo)
  const tablas = doc.querySelectorAll('table.fab-online').filter(t => /^Jornada \d+/.test(texto(t.querySelector('thead')?.text)))
  if (!tablas.length) throw Error('Álava todavía no publica jornadas para este grupo')
  const eventos = [], fechas = [], hoy = new Date(ahora).toISOString().slice(0, 10)
  for (const tabla of tablas) {
    const cab = tabla.querySelectorAll('thead th'), jornada = texto(cab[0]?.text), m = texto(cab[2]?.text).match(/^(\d{2})-(\d{2})-(\d{4})$/)
    const fecha = m && `${m[3]}-${m[2]}-${m[1]}`
    if (!fechaDeportiva(fecha)) throw Error('Fecha de jornada de Álava no reconocida')
    fechas.push(fecha)
    for (const tr of tabla.querySelectorAll('tbody tr')) {
      const c = tr.querySelectorAll('td').map(n => texto(n.text))
      if (c.length !== 3 || !c[0] || !c[2]) throw Error('Partido de Álava incompleto')
      if (/^descansa$/i.test(c[0]) || /^descansa$/i.test(c[2])) continue
      const marcador = c[1].match(/^(\d{1,3})\s*[–-]\s*(\d{1,3})$/)
      if (!marcador && !/^[–-]$/.test(c[1])) throw Error('Marcador de Álava no reconocido')
      const final = marcador && Number(marcador[1]) + Number(marcador[2]) > 0 && fecha < hoy
      const detalle = `Fecha de jornada: ${texto(cab[2].text)}. La federación no confirma aquí el día y la hora de cada partido.`
      eventos.push({ id: 'alava-' + grupo.codigo + '-' + createHash('sha256').update(jornada + '\n' + c[0] + '\n' + c[2]).digest('hex').slice(0, 20), nombre: c[0] + ' · ' + c[2], local: c[0], visitante: c[2], jornada,
        estado: final ? 'finalizado' : 'por_confirmar', ...(final ? { resultado: { local: Number(marcador[1]), visitante: Number(marcador[2]) } } : {}), detalle, fuenteUrl: urlGrupo(grupo) })
    }
  }
  if (!eventos.length || new Set(eventos.map(e => e.id)).size !== eventos.length) throw Error('Calendario de Álava vacío o duplicado')
  const anos = [...new Set(fechas.map(f => Number(f.slice(0, 4))))].sort()
  if (anos.at(-1) - anos[0] > 1) throw Error('El calendario de Álava mezcla años no consecutivos')
  return { eventos, temporada: 'Calendario ' + anos.join('–') }
}
export function clasificacionAlava(html, grupo) {
  const doc = parse(html); identidad(doc, grupo)
  const tabla = doc.querySelector('table.fab-online'), claves = ['j', 'g', 'p', 'np', 's', 'tf', 'tc', 'puntos']
  if (!tabla || texto(tabla.querySelector('thead')?.text) !== 'Puesto Equipo J G P NP S TF TC Puntos') throw Error('Álava no publica una tabla reconocida')
  const filas = tabla.querySelectorAll('tbody tr').map(tr => {
    const c = tr.querySelectorAll('td').map(sinEtiquetas)
    if (c.length !== 10 || !c[1] || [c[0], ...c.slice(2)].some(n => !/^-?\d+$/.test(n))) throw Error('Clasificación de Álava incompleta')
    return { posicion: Number(c[0]), nombre: c[1], valores: Object.fromEntries(claves.map((clave, i) => [clave, Number(c[i + 2])])) }
  })
  if (!filas.length || new Set(filas.map(f => f.posicion)).size !== filas.length || filas.some(f => f.posicion < 1 || ['j', 'g', 'p', 'np', 'tf', 'tc'].some(k => f.valores[k] < 0))) throw Error('Clasificación de Álava incoherente')
  return [{ id: 'grupo-' + grupo.codigo, nombre: grupo.nombre, columnas: claves.map(clave => ({ clave, nombre: clave.toUpperCase() })), filas }]
}
export async function obtieneBaloncestoAlava(opciones = {}) {
  const estado = normalizaEstadoNovanet(opciones.estadoNovanet?.[PORTAL]), competiciones = [], incidencias = []
  const reloj = opciones.relojAlava || Date.now, guardar = () => opciones.guardarEstadoNovanet?.(PORTAL, estado), duerme = opciones.duermeAlava || (ms => new Promise(r => setTimeout(r, ms)))
  let siguiente = 0, parado = false
  const restantes = () => !estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA ? 120 : 120 - estado.ventana.peticiones
  const disponible = () => !parado && restantes() > 0 && (!estado.noConsultarAntes || reloj() >= Date.parse(estado.noConsultarAntes))
  const lee = url => leerFuenteDeportiva(url, { fetcher: async (destino, init) => {
    if (!disponible()) throw Error('Álava continuará en la siguiente tanda permitida')
    if (siguiente > reloj()) await duerme(siguiente - reloj())
    if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) estado.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 }
    estado.ventana.peticiones++; siguiente = reloj() + 1000
    if (estado.ventana.peticiones >= 120) estado.noConsultarAntes = new Date(Date.parse(estado.ventana.desde) + HORA).toISOString()
    await guardar()
    const r = await (opciones.fetcher || fetch)(destino, init)
    if (r.status === 429) { const valor = r.headers.get('Retry-After'), hasta = /^\d+$/.test(valor || '') ? reloj() + Number(valor) * 1000 : Date.parse(valor); estado.noConsultarAntes = new Date(Math.max(Number.isFinite(hasta) ? hasta : reloj() + HORA, reloj())).toISOString(); parado = true; await guardar() }
    return r
  } })
  const fallo = (nombre, motivo, id) => incidencias.push({ deporte: 'baloncesto', nombre, fuenteUrl: CALENDARIO, motivo, ...(id ? { id } : {}) })
  try {
    const grupos = gruposAlava(await lee(CALENDARIO)); let contados = 0
    while (disponible() && restantes() >= 2 && contados < grupos.length) {
      estado.grupo %= grupos.length
      const grupo = grupos[estado.grupo], id = 'basket-alava-' + grupo.codigo
      try {
        const agenda = calendarioAlava(await lee(urlGrupo(grupo)), grupo, reloj()), sello = new Date(reloj()).toISOString()
        let tablas = [], aviso
        try { tablas = clasificacionAlava(await lee(urlGrupo(grupo, true)), grupo) } catch (e) { aviso = e.message; fallo(grupo.nombre, aviso, id) }
        const fechaTabla = new Date(reloj()).toISOString(), tipo = /MIXTO/i.test(grupo.categoria) ? 'mixto' : /FEMENINA/i.test(grupo.categoria) ? 'femenino' : /MASCULINA/i.test(grupo.categoria) ? 'masculino' : undefined
        competiciones.push({ id, deporte: 'baloncesto', nombre: grupo.categoria + ' · ' + grupo.nombre, temporada: agenda.temporada, categoria: grupo.categoria, grupo: grupo.nombre, zona: 'Álava', ...(tipo ? { genero: tipo } : {}), fuente: { nombre: FUENTE, url: urlGrupo(grupo) }, comprobadoEn: fechaTabla,
          agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: urlGrupo(grupo), eventos: agenda.eventos, aviso: 'Calendario publicado por la federación. Las fechas corresponden a jornadas, no a horarios confirmados de cada partido.' },
          clasificacion: { estado: tablas.length ? 'actualizado' : 'no_disponible', consultado: fechaTabla, ...(tablas.length ? { verificadoEn: fechaTabla } : { aviso }), fuenteUrl: urlGrupo(grupo, true), tablas } })
        estado.ultimoExito = sello; estado.verificados[grupo.codigo] = sello
      } catch (e) { fallo(grupo.nombre, e.message, id) }
      if (parado) break
      estado.grupo = (estado.grupo + 1) % grupos.length; contados++; await guardar()
    }
    fallo('Álava · actualización por grupos', `Grupos localizados: ${grupos.length}. Grupos comprobados: ${Object.keys(estado.verificados).length}. La actualización continúa por tandas.`)
  } catch (e) { fallo('Baloncesto · Álava', e.message) }
  return { competiciones, incidencias }
}
