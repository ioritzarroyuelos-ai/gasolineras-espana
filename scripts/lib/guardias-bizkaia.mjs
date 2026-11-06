import { parse } from 'node-html-parser'
import { rangoGuardia, texto } from './guardias-fetch.mjs'

export function parseGuardiasBizkaia(html, fecha) {
  const listado = parse(html).querySelector('#content.farmaciasGuardia')
  const dia = fecha.split('-').reverse().join('/')
  if (listado?.querySelector('input[name=fecha_guardia]')?.getAttribute('value') !== dia)
    throw new Error('COFBi: la fecha devuelta no coincide con la solicitada')
  if (listado.querySelectorAll('select option[selected]').some(opcion => opcion.getAttribute('value')))
    throw new Error('COFBi: el listado está limitado a un municipio o zona')
  const total = /^Total de farmacias\s*:\s*(\d+)$/i.exec(texto(listado.querySelector('.horarioComun p')?.text))
  if (!total || Number(total[1]) < 1) throw new Error('COFBi: falta el total provincial de guardias')

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
  return guardias
}
