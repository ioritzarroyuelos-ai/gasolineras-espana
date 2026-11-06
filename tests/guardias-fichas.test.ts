import { parse } from 'node-html-parser'
import { describe, expect, it, vi } from 'vitest'
import { buildGuardiaMunicipioPage, buildGuardiaProvinciaFlatPage, type GuardiaPageData } from '../src/html/guardia-municipio'
import { fuenteGuardia, municipiosConGuardia, parseGuardias, type Guardia } from '../src/lib/guardias'

const ahora = new Date('2026-11-05T11:00:00Z')
const base = {
  provinciaName: 'Madrid', provinciaSlug: 'madrid', municipioName: 'Alcalá de Henares', municipioSlug: 'alcala-de-henares',
  actualizado: ahora.toISOString(), ahora, otrosMunicipios: [], canonical: 'https://example.test/farmacias/madrid/alcala-de-henares',
}
const ficha: Guardia = {
  direccion: 'Calle Mayor 1', telefono: '', horario: '2026-11-05 09:00-2026-11-06 09:00', horarioDesc: '',
  municipio: 'Alcalá de Henares', territorio: 'madrid', cp: '28801', lat: 0, lng: 0,
}
function pagina(guardias: Guardia[], opciones: Partial<GuardiaPageData> = {}) {
  return parse(buildGuardiaMunicipioPage('prueba', { ...base, guardias, ...opciones }))
}

describe('acciones de la ficha de farmacia', () => {
  it.each([
    ['945607191 - 646546692', ['+34945607191', '+34646546692']],
    ['608293089 / 920340020 / 670640335', ['+34608293089', '+34920340020', '+34670640335']],
    ['927220667927627302', ['+34927220667', '+34927627302']],
    ['927347731927347731', ['+34927347731']],
    ['+34 942 59 60 14, 0034 942596014', ['+34942596014']],
    ['92751527267709821', []],
    ['722 261 05', []],
  ] as const)('convierte %s en botones independientes de llamada', (texto, esperados) => {
    const html = pagina([{ ...ficha, telefono: texto }])
    expect(html.querySelectorAll('.g-acciones a[href^="tel:"]').map(a => a.getAttribute('href')?.slice(4))).toEqual(esperados)
    expect(JSON.parse(html.querySelector('script[type="application/ld+json"]')!.rawText).itemListElement[0].item.telephone).toEqual(esperados)
  })

  it('abre itinerario sólo con coordenadas verificadas, y busca por dirección y zona cuando faltan', () => {
    const html = pagina([ficha, { ...ficha, lat: 40.48, lng: -3.36, coordenadasFiables: true }, { ...ficha, direccion: '' }])
    const tarjetas = html.querySelectorAll('.g-card')
    const busqueda = new URL(tarjetas[0].querySelector('a')!.getAttribute('href')!)
    expect(busqueda.pathname).toBe('/maps/search/')
    expect(busqueda.searchParams.get('query')).toBe('Calle Mayor 1, 28801, Alcalá de Henares, Madrid, España')
    expect(tarjetas[0].querySelector('a')?.text).toBe('Buscar dirección en el mapa')
    const itinerario = new URL(tarjetas[1].querySelector('a')!.getAttribute('href')!)
    expect(itinerario.pathname).toBe('/maps/dir/')
    expect(itinerario.searchParams.get('destination')).toBe('40.48,-3.36')
    expect(tarjetas[2].querySelector('a')).toBeNull()
  })

  it('incluye la provincia de Huesca en el mapa aunque el colegio omita el municipio', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(ahora)
      const html = parse(buildGuardiaProvinciaFlatPage('xx', 'huesca', 'Huesca',
        [{ ...ficha, municipio: '', cp: '', direccion: 'Plaza España 1' }], base.actualizado, 'https://example.test/farmacias/huesca'))
      const href = html.querySelector('.g-card a')!.getAttribute('href')!
      expect(new URL(href).searchParams.get('query')).toBe('Plaza España 1, Huesca, España')
    } finally { vi.useRealTimers() }
  })

  it('muestra todos los tramos, mantiene separadas las notas del horario y explica cuándo no puede filtrar', () => {
    const guardia = { ...ficha, territorio: 'barcelona', horario: '09:00-14:00, 16:30-20:30, 22:00-09:00', horarioDesc: 'Servicio del barrio' }
    const html = pagina([guardia])
    const horario = html.querySelector('.g-hora')!.text
    for (const publicado of ['09:00','14:00','16:30','20:30','22:00','Servicio del barrio']) expect(horario).toContain(publicado)
    const dudosa = { ...ficha, horario: '', horarioDesc: 'Horario por confirmar' }
    const desconocida = pagina([dudosa])
    expect(desconocida.querySelector('.g-card')).not.toBeNull()
    expect(desconocida.querySelector('.g-filtros')).toBeNull()
    expect(desconocida.querySelector('main')?.text).toContain('No podemos confirmar')
    const filtrada = pagina([dudosa], { turno: 'ahora' })
    expect(filtrada.querySelector('.g-card')).toBeNull()
    expect(filtrada.querySelector('.g-vacio a')?.getAttribute('href')).toBe('?turno=todas')
  })

  it('distingue apertura y guardia localizada y oculta teléfonos, rutas y datos estructurados caducados', () => {
    const html = pagina([{ ...ficha, territorio: 'valencia' }, { ...ficha, horarioDesc: 'Guardia no presencial' }])
    expect(html.querySelector('h1')?.text).toBe('Farmacias y turnos en Alcalá de Henares')
    expect(html.querySelectorAll('.g-tipo')[0].text).toContain('Guardia localizada')
    expect(html.querySelectorAll('.g-tipo')[0].text).not.toContain('Abierta ahora')
    expect(html.querySelectorAll('.g-tipo')[1].text).toContain('guardia sin confirmar')
    const antigua = pagina([{ ...ficha, telefono: '945607191' }], { ahora: new Date('2026-11-08T12:00:00Z') })
    expect(antigua.querySelector('.g-caducado')).not.toBeNull()
    expect(antigua.querySelector('.g-card')).toBeNull()
    expect(antigua.querySelector('a[href^="tel:+34945607191"]')).toBeNull()
    expect(antigua.toString()).not.toContain('"@type":"Pharmacy"')
  })

  it.each(['valencia', 'tenerife'])('presenta como horarios el listado de %s cuando sólo se publica apertura', territorio => {
    const html = pagina([{ ...ficha, territorio }])
    expect(html.querySelector('h1')?.text).toBe('Horarios de farmacias en Alcalá de Henares')
    expect(html.querySelector('title')?.text).toContain('Horarios de farmacias')
    expect(html.querySelector('.g-tipo')?.text).toContain('Horario de apertura · guardia sin confirmar')
  })
})

describe('guardia oficial de Durango al cambiar el día', () => {
  const ayer = [0, 0, 'Campillo · Avda. Montevideo, 24', 'Durango', '946811809', '', '2026-11-05 09:00-2026-11-06 09:00', '']
  const hoy = [0, 0, 'Navarro Aranda · Artecalle, 6', 'Durango', '946810223', '', '2026-11-06 09:00-2026-11-07 09:00', '']
  const fichero = { territorio: 'bizkaia', guardiasVerificadas: true, source: 'cofbizkaia.eus', fecha: '2026-11-06', ts: '2026-11-06T05:45:00Z', guardias: [hoy, ayer] }
  function durango(instante: string, turno: GuardiaPageData['turno'] = 'todas') {
    const visita = new Date(instante)
    return pagina(parseGuardias(fichero, visita), { provinciaSlug: 'bizkaia', provinciaName: 'Bizkaia', municipioName: 'Durango',
      municipioSlug: 'durango', actualizado: fichero.ts, metadatos: fichero, ahora: visita, turno })
  }

  it('descarta el directorio antiguo de todas las listas y enlaza al calendario del colegio para la fecha local', () => {
    const visita = new Date('2026-11-05T23:30:00Z')
    for (const source of ['cofbizkaia.net', undefined]) {
      const antigua = { ...fichero, source, guardias: [[0, 0, 'Farmacia A', 'Durango', '', '', '09:00 - 13:30 y 16:00 - 19:30', '']] }
      expect(municipiosConGuardia(parseGuardias(antigua, visita))).toEqual([])
      expect(fuenteGuardia('bizkaia', antigua, visita)).toBe('https://www.cofbizkaia.eus/farmacia_de_guardia/?fecha_guardia=06%2F11%2F2026')
    }
    expect(parseGuardias({ ...fichero, fecha: undefined }, visita)).toEqual([])
    expect(parseGuardias({ ...fichero, fecha: '2026-11-31' }, visita)).toEqual([])
  })

  it('prioriza al de noche a las 08:59 y conserva el turno válido durante la madrugada anterior a la nueva descarga', () => {
    const antes = durango('2026-11-06T07:59:59Z')
    expect(antes.querySelectorAll('.g-dir').map(h => h.text)).toEqual([ayer[2], hoy[2]])
    expect(antes.querySelector('.g-tipo')?.text).toBe('De guardia ahora')
    expect(antes.querySelectorAll('.g-tipo')[1].text).not.toContain('De guardia ahora')
    const madrugada = new Date('2026-11-06T02:00:00Z')
    const copiaDelJueves = { ...fichero, fecha: '2026-11-05', ts: '2026-11-05T08:00:00Z', guardias: [ayer] }
    expect(parseGuardias(copiaDelJueves, madrugada).map(g => g.direccion)).toEqual([ayer[2]])
    expect(fuenteGuardia('bizkaia', copiaDelJueves, madrugada)).toContain('fecha_guardia=05%2F11%2F2026')
    expect(parseGuardias(copiaDelJueves, new Date('2026-11-06T08:00:00Z'))).toEqual([])
    expect(fuenteGuardia('bizkaia', copiaDelJueves, new Date('2026-11-06T08:00:00Z'))).toContain('fecha_guardia=06%2F11%2F2026')
    expect(fuenteGuardia('bizkaia', copiaDelJueves, new Date('2026-11-08T12:00:00Z'))).toContain('fecha_guardia=08%2F11%2F2026')
  })

  it.each(['todas', 'ahora', '24h'] as const)('retira al saliente a las 09:00 de %s y señala la guardia hasta las 09:00 del día siguiente', turno => {
    const despues = durango('2026-11-06T08:00:00Z', turno)
    expect(despues.querySelectorAll('.g-dir').map(h => h.text)).toEqual([hoy[2]])
    expect(despues.querySelector('.g-tipo strong')?.text).toBe('De guardia ahora')
    expect(despues.querySelector('.g-hora')?.text).toContain('hasta las 09:00 del 07/11/2026')
    expect(despues.querySelector('a[href="tel:+34946810223"]')).not.toBeNull()
    expect(despues.querySelector('a[href="?turno=ahora"]')?.text).toBe('Abierta ahora')
    expect(despues.querySelector('#g-fuente a')?.getAttribute('href')).toContain('fecha_guardia=06%2F11%2F2026')
  })
})
