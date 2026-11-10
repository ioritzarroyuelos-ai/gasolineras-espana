import { parse } from 'node-html-parser'
import { descargar, rangoGuardia, texto } from './guardias-fetch.mjs'

const directorio = 'https://www.cofbizkaia.eus/farmacia_de_guardia/'
const unicas = filas => [...new Map(filas.map(fila => [JSON.stringify(fila), fila])).values()]

export function urlGuardiasBizkaia(fecha, municipio = '') {
  const url = new URL(directorio)
  // Son los campos que envía el formulario oficial. El listado sin municipio
  // está limitado a 200 registros y no es una copia provincial completa.
  for (const [k, v] of Object.entries({ idmunicipio: municipio, zonasalud: '', fecha_guardia: fecha.split('-').reverse().join('/'),
    submitForm: '1', orderby: 'farmacia', order: 'desc', pagetype: 'farmacias_de_guardia' })) url.searchParams.set(k, v)
  return url.href
}

export function municipiosGuardiasBizkaia(html) {
  const listado = parse(html).querySelector('#content.farmaciasGuardia')
  const opciones = listado?.querySelectorAll('select[name=idmunicipio] option[value]') || []
  const municipios = opciones.filter(op => op.getAttribute('value')).map(op => {
    const id = op.getAttribute('value'), nombre = texto(op.getAttribute('data_municipio'))
    if (!/^\d{5}$/.test(id) || op.getAttribute('data_id') !== id || !nombre) throw new Error('COFBi: catálogo municipal desconocido')
    return { id, nombre }
  }).filter(m => m.id.startsWith('48'))
  if (municipios.length < 60 || municipios.length > 150 || new Set(municipios.map(m => m.id)).size !== municipios.length)
    throw new Error('COFBi: catálogo municipal incompleto o duplicado')
  return municipios
}

export function parseGuardiasBizkaia(html, fecha, municipio = '') {
  const documento = parse(html), listado = documento.querySelector('#content.farmaciasGuardia')
  const dia = fecha.split('-').reverse().join('/')
  if (listado?.querySelector('input[name=fecha_guardia]')?.getAttribute('value') !== dia)
    throw new Error('COFBi: la fecha devuelta no coincide con la solicitada')
  if (municipio && (!/^48\d{3}$/.test(municipio) || !listado.querySelector('select[name=idmunicipio] option[value="' + municipio + '"]')))
    throw new Error('COFBi: municipio no reconocido en la respuesta')
  if (listado.querySelectorAll('select option[selected]').some(opcion => opcion.getAttribute('value') && opcion.getAttribute('value') !== municipio))
    throw new Error('COFBi: el listado está limitado a un municipio o zona')
  const total = /^Total de farmacias\s*:\s*(\d+)$/i.exec(texto(listado.querySelector('.horarioComun p')?.text))
  // Orozko, Otxandio y Urduña/Orduña devuelven el formulario entero, sin tabla
  // ni total. Esto significa «sin resultados publicados», nunca «sin guardia».
  if (!total && municipio && !listado.querySelector('.horarioComun, h2, table') && listado.querySelector('.formularioDuda') && documento.querySelector('footer#footer')) return []
  if (!total || Number(total[1]) < 1) throw new Error('COFBi: falta el total de guardias')
  if (Number(total[1]) >= 200) throw new Error('COFBi: listado posiblemente truncado por el límite de 200 filas')

  const guardias = []
  const codigos = new Map(listado.querySelectorAll('option[data_municipio][data_id]').map(op =>
    [texto(op.getAttribute('data_municipio')).toUpperCase(), op.getAttribute('data_id')]))
  for (const titulo of listado.querySelectorAll('h2')) {
    const horario = /^Horario\s*:\s*(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})$/i.exec(texto(titulo.text))
    const filas = titulo.nextElementSibling?.querySelectorAll('table tbody tr')
    if (!horario || !filas?.length) throw new Error('COFBi: franja o tabla de guardias incompleta')
    // La rotación 09–09 abarca la guardia diurna y la noche hasta las 09 siguientes.
    // Una igualdad desconocida no debe convertirse automáticamente en 24 horas.
    if (horario[1] === horario[2] && horario[1] !== '09:00') throw new Error('COFBi: turno sin duración confirmada')
    const intervalo = rangoGuardia(fecha, horario[1], horario[2])
    for (const fila of filas) {
      const campo = etiqueta => fila.querySelector('td[data-label="' + etiqueta + '"]')?.text || ''
      const [titular, ...notas] = campo('Farmacia').trim().split(/\s*\n\s*/).filter(Boolean)
      const municipio = texto(campo('Municipio'))
      const [direccion, contacto] = texto(campo('Dirección')).split(/\s+(?=Contacto para guardias\b)/i)
      if (!titular || !municipio || !direccion) throw new Error('COFBi: farmacia sin titular, dirección o municipio')
      const farmacia = [0, 0, texto(titular) + ' · ' + direccion, municipio, texto(campo('Teléfono')), '', intervalo,
        [...notas, contacto].filter(Boolean).map(texto).join(' · ')]
      const codigo = codigos.get(municipio.toUpperCase())
      if (codigo && !codigo.startsWith('48')) farmacia.push(codigo.slice(0,2), texto(campo('Zona')))
      guardias.push(farmacia)
    }
  }
  if (guardias.length !== Number(total[1])) throw new Error('COFBi: el número de filas no cuadra con el total publicado')
  return unicas(guardias)
}

export async function recogerGuardiasBizkaia(fecha, { descargarHtml = async url => (await descargar(url, { headers: { Accept: 'text/html' } })).text(),
  esperar = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const url = urlGuardiasBizkaia(fecha)
  const municipios = municipiosGuardiasBizkaia(await descargarHtml(url))
  const resultados = new Array(municipios.length)
  let cursor = 0
  async function worker() {
    while (cursor < municipios.length) {
      const indice = cursor++, municipio = municipios[indice]
      try {
        resultados[indice] = parseGuardiasBizkaia(await descargarHtml(urlGuardiasBizkaia(fecha, municipio.id)), fecha, municipio.id)
      } catch (error) {
        throw new Error('COFBi: no se pudo verificar ' + municipio.nombre + ' (' + fecha + '): ' + error.message, { cause: error })
      }
      await esperar(300)
    }
  }
  // Dos consultas simultáneas para no sobrecargar al colegio. Cualquier fallo
  // aborta la copia; no sustituimos la última buena por un barrido incompleto.
  const trabajos = await Promise.allSettled([worker(), worker()])
  const fallo = trabajos.find(t => t.status === 'rejected')
  if (fallo) throw fallo.reason
  const sinResultados = municipios.filter((_, i) => !resultados[i].length)
  if (sinResultados.length > municipios.length * .1) throw new Error('COFBi: demasiados municipios sin resultados verificables')
  return { filas: unicas(resultados.flat()), url, municipios: municipios.length, sinResultados }
}
