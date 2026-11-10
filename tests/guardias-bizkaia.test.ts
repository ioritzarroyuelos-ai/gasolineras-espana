import { describe, expect, it, vi } from 'vitest'
import { parse } from 'node-html-parser'
import municipalHTML from './fixtures/guardias/bizkaia-municipios.html?raw'
import { municipiosGuardiasBizkaia, parseGuardiasBizkaia, recogerGuardiasBizkaia, urlGuardiasBizkaia } from '../scripts/lib/guardias-bizkaia.mjs'

const navarro = ['DURANGO', 'NAVARRO ARANDA, Mª JESUS', '94 6810223', 'Artecalle, nº 6']
const bermeo = ['BERMEO', 'APARICIO GONZALEZ, AIDA Mª', '94 6187007', 'Askatasuna Bidea, nº 25']
const bilbao = ['BILBAO', 'ROSELLO GUTIÉRREZ, CRISTINA<br/>Horario de urgencia', '944218904', 'Gordóniz, 34']
const fecha = '2026-11-06'

function tabla(horas: string, valores: string[]) {
  const campos = valores.map((v, i) => '<td data-label="' + ['Municipio','Farmacia','Teléfono','Dirección'][i] + '">' + v + '</td>')
  return '<h2> Horario : ' + horas + '</h2><div><table><tbody><tr>' + campos.join('') + '</tr></tbody></table></div>'
}

function pagina(tablas: string, total: number, otroCampo = '') {
  return '<div id="content" class="farmaciasGuardia"><input name="fecha_guardia" value="06/11/2026">' + otroCampo
    + '<div class="horarioComun"><p>Total de farmacias : ' + total + '</p></div>' + tablas + '</div>'
}

describe('COFBi · calendario de guardias por fecha', () => {
  it('aplica el horario de cada tabla a su fila y distingue una noche entera de un turno de 24 horas', () => {
    const html = pagina(tabla('09:00 - 09:00', navarro) + tabla('08:00 - 23:59', bermeo) + tabla('22:00 - 09:00', bilbao), 3)
    const guardias = parseGuardiasBizkaia(html, fecha)
    expect(guardias[0]).toEqual([0, 0, 'NAVARRO ARANDA, Mª JESUS · Artecalle, nº 6', 'DURANGO', '94 6810223', '', '2026-11-06 09:00-2026-11-07 09:00', ''])
    expect(guardias[1][6]).toBe('2026-11-06 08:00-2026-11-06 23:59')
    expect(guardias[2].slice(6)).toEqual(['2026-11-06 22:00-2026-11-07 09:00', 'Horario de urgencia'])
  })

  it('conserva el contacto de guardias sin convertirlo en parte de la dirección', () => {
    const lekeitio = ['LEKEITIO','GOROSTIAGA OMAETXEBARRIA, KOLDO','946843023','Atea, nº 14      Contacto para guardias 946843023']
    const [fila] = parseGuardiasBizkaia(pagina(tabla('09:00 - 09:00', lekeitio), 1), fecha)
    expect(fila[2]).toBe('GOROSTIAGA OMAETXEBARRIA, KOLDO · Atea, nº 14')
    expect(fila[7]).toBe('Contacto para guardias 946843023')
  })

  it('rehúsa listados parciales, directorios ordinarios y respuestas de otro día o municipio', () => {
    const grupo = tabla('09:00 - 09:00', navarro)
    expect(() => parseGuardiasBizkaia(pagina(grupo, 2), fecha)).toThrow(/número de filas/)
    expect(() => parseGuardiasBizkaia(pagina(grupo, 1), '2026-11-07')).toThrow(/fecha/)
    expect(() => parseGuardiasBizkaia('<div class="horarioComun">' + grupo + '</div>', fecha)).toThrow(/fecha/)
    expect(() => parseGuardiasBizkaia(pagina(grupo, 1, '<select><option value="48027" selected>Durango</option></select>'), fecha)).toThrow(/limitado/)
    expect(() => parseGuardiasBizkaia(pagina(tabla('08:30 - 08:30', navarro), 1), fecha)).toThrow(/duración/)
    expect(() => parseGuardiasBizkaia(pagina(tabla('pendiente', navarro), 1), fecha)).toThrow(/franja/)
  })
  it('elimina duplicados después de validar el total y conserva turnos distintos de la misma farmacia', () => {
    const turno = tabla('09:00 - 09:00', navarro)
    const noche = tabla('22:00 - 09:00', navarro)
    expect(parseGuardiasBizkaia(pagina(turno + turno + noche, 3), fecha)).toHaveLength(2)
    expect(() => parseGuardiasBizkaia(pagina(turno + turno, 1), fecha)).toThrow(/número de filas/)
    expect(() => parseGuardiasBizkaia(pagina(turno.repeat(200), 200), fecha)).toThrow(/truncado/)
  })
})

// Formulario y resultado reales de Durango del 10/11/2026: la consulta devuelve
// también una farmacia situada en Abadiño. No cambiamos su localidad física.
describe('COFBi · barrido del catálogo municipal', () => {
  const dia = '2026-11-10'
  const vacio = () => {
    const doc = parse(municipalHTML)
    doc.querySelector('.horarioComun')!.remove()
    for (const titulo of doc.querySelectorAll('h2')) { titulo.nextElementSibling!.remove(); titulo.remove() }
    return doc.toString()
  }
  it('reconoce las 84 opciones y utiliza los parámetros del formulario', () => {
    const catalogo = municipiosGuardiasBizkaia(municipalHTML)
    expect(catalogo).toHaveLength(84)
    expect(catalogo.some(m => m.id === '20030')).toBe(false)
    const url = new URL(urlGuardiasBizkaia(dia, '48027'))
    expect(Object.fromEntries(url.searchParams)).toEqual({ idmunicipio: '48027', zonasalud: '', fecha_guardia: '10/11/2026', submitForm: '1', orderby: 'farmacia', order: 'desc', pagetype: 'farmacias_de_guardia' })
    const filas = parseGuardiasBizkaia(municipalHTML, dia, '48027')
    expect(filas.map(f => f[3])).toEqual(['DURANGO', 'ABADIÑO'])
    expect(filas[0][6]).toBe('2026-11-10 09:00-2026-11-11 09:00')
  })
  it('acepta un formulario completo sin resultados, sin tratar un HTML cortado como vacío', () => {
    expect(parseGuardiasBizkaia(vacio(), dia, '48075')).toEqual([])
    expect(() => parseGuardiasBizkaia(vacio().replace(/<footer[\s\S]*$/, ''), dia, '48075')).toThrow(/total/)
    expect(() => parseGuardiasBizkaia(vacio(), dia, '48999')).toThrow(/municipio/)
    expect(() => parseGuardiasBizkaia(vacio(), '2026-11-11', '48075')).toThrow(/fecha/)
    expect(() => municipiosGuardiasBizkaia(pagina('', 0))).toThrow(/catálogo/)
  })
  it('consulta todas las opciones, une sus zonas sin duplicarlas y conserva las consultas sin resultados como pendientes', async () => {
    const consultas: string[] = []
    const resultado = await recogerGuardiasBizkaia(dia, {
      esperar: async () => {},
      descargarHtml: async url => {
        const id = new URL(url).searchParams.get('idmunicipio')!
        consultas.push(id)
        return id === '48075' ? vacio() : municipalHTML
      }
    })
    expect(consultas).toHaveLength(85)
    expect(new Set(consultas).size).toBe(85)
    expect(resultado.municipios).toBe(84)
    expect(resultado.filas).toHaveLength(2)
    expect(resultado.sinResultados).toEqual([{ id: '48075', nombre: 'OROZKO' }])
  })
  it('rechaza todo el barrido si una consulta falla o demasiadas carecen de datos', async () => {
    await expect(recogerGuardiasBizkaia(dia, { esperar: async () => {}, descargarHtml: async url => {
      if (new URL(url).searchParams.get('idmunicipio') === '48027') throw new Error('HTTP 503')
      return municipalHTML
    } })).rejects.toThrow(/DURANGO.*503/)
    await expect(recogerGuardiasBizkaia(dia, { esperar: async () => {}, descargarHtml: async url => new URL(url).searchParams.get('idmunicipio') ? vacio() : municipalHTML })).rejects.toThrow(/demasiados municipios/)
  })
  it('conserva una derivación fuera de Bizkaia y su zona, sin asignarle una dirección vizcaína', () => {
    const doc = parse(municipalHTML)
    const fila = doc.querySelector('table tbody tr')!
    fila.querySelector('[data-label=Municipio]')!.set_content('EIBAR')
    fila.querySelector('[data-label=Zona]')!.set_content('ERMUA')
    expect(parseGuardiasBizkaia(doc.toString(), dia, '48034')[0].slice(8)).toEqual(['20', 'ERMUA'])
  })
  it.each([new DOMException('The operation was aborted due to timeout', 'TimeoutError'), Object.assign(new Error('HTTP 503'), { status: 503 })])('recupera un corte transitorio con una sola pausa y vuelve a verificar todas las opciones: %s', async error => {
    let intentos = 0
    const esperar = vi.fn(async (_ms: number) => {})
    const resultado = await recogerGuardiasBizkaia(dia, { esperar, descargarHtml: async url => {
      if (new URL(url).searchParams.get('idmunicipio') === '48027' && ++intentos === 1) throw error
      return municipalHTML
    } })
    expect(intentos).toBe(2)
    expect(esperar.mock.calls.filter(([ms]) => ms === 2000)).toHaveLength(1)
    expect(resultado.municipios).toBe(84)
    expect(resultado.filas).toHaveLength(2)
  })
  it('un timeout persistente se intenta dos veces y rechaza la copia parcial', async () => {
    let intentos = 0
    const esperar = vi.fn(async (_ms: number) => {})
    await expect(recogerGuardiasBizkaia(dia, { esperar, descargarHtml: async url => {
      if (new URL(url).searchParams.get('idmunicipio') === '48027') { intentos++; throw new DOMException('Tiempo agotado', 'TimeoutError') }
      return municipalHTML
    } })).rejects.toThrow(/DURANGO.*Tiempo agotado/)
    expect(intentos).toBe(2)
    expect(esperar.mock.calls.filter(([ms]) => ms === 2000)).toHaveLength(1)
  })
  it.each([403, 429])('la descarga real no repite HTTP%d ni completa una copia sin ese municipio', async status => {
    let intentos = 0
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      if (new URL(String(url)).searchParams.get('idmunicipio') === '48027') { intentos++; return new Response('Rechazo', { status }) }
      return new Response(municipalHTML)
    })
    const esperar = vi.fn(async (_ms: number) => {})
    try {
      await expect(recogerGuardiasBizkaia(dia, { esperar })).rejects.toThrow('HTTP ' + status)
      expect(intentos).toBe(1)
      expect(esperar.mock.calls.filter(([ms]) => ms === 2000)).toHaveLength(0)
    } finally { fetcher.mockRestore() }
  })
  it('recupera también el timeout del cuerpo de una respuesta HTTP200', async () => {
    let intentos = 0
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      if (new URL(String(url)).searchParams.get('idmunicipio') === '48027' && ++intentos === 1) {
        return new Response(new ReadableStream({ start(controller) { controller.error(new DOMException('Body timeout', 'TimeoutError')) } }))
      }
      return new Response(municipalHTML)
    })
    try {
      const resultado = await recogerGuardiasBizkaia(dia, { esperar: async () => {} })
      expect(intentos).toBe(2)
      expect(resultado.municipios).toBe(84)
    } finally { fetcher.mockRestore() }
  })
})
