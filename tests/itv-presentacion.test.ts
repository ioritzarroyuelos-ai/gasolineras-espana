import { describe, it, expect, vi, afterEach } from 'vitest'
import { parse } from 'node-html-parser'
import { telefonosItv, mapsHref, enlaceOficialItv, type EstacionITV } from '../src/lib/itv'
import { tarjetaItv, avisoDirectorio, buildItvMunicipioPage, buildItvPreciosPage, itvHeaders } from '../src/html/itv'
import { TARIFAS, desglosa } from '../src/lib/itv-tarifas'
import type { EstadoTarifasItv } from '../src/lib/itv-tarifas-estado'

function estadoTarifas(): EstadoTarifasItv {
  const checkedAt = new Date().toISOString()
  const ids = [...TARIFAS.filter(t => t.estado === 'verificada').map(t => t.slug), 'tasa-dgt']
  return { v:1, estado:'verificada', checkedAt,
    fuentes:ids.map(id=>({id,url:'https://example.com/',checkedAt,estado:'verificada'})),
    tarifas:ids.filter(id=>id!=='tasa-dgt').map(slug=>({slug,estado:'verificada',fuentes:[slug,'tasa-dgt']})),
  }
}

const estacion: EstacionITV = {
  id: 'test', prov: '50', mun: 'UTEBO', dir: 'C/ de la prueba, 1', cp: '50180',
  tel: '976 78 54 74 // 976 78 56 67', op: 'Operador', lat: 41.7, lng: -0.98,
  lineas: 2, horario: '', fuente: 'dgt',
}
afterEach(() => vi.useRealTimers())

describe('fichas ITV con datos fiables', () => {
  it('separa los teléfonos de Utebo y conserva sólo números completos', () => {
    expect(telefonosItv(estacion.tel).map(x => x.href)).toEqual(['tel:976785474', 'tel:976785667'])
    expect(telefonosItv('924 00 98 00/ 01/ 02').map(x => x.href)).toEqual(['tel:924009800'])
    expect(telefonosItv('+34 945 29 27 72;0034 945292772')).toHaveLength(1)
    expect(telefonosItv('976785474976785667')).toEqual([])
    const root = parse(tarjetaItv(estacion, 'Utebo'))
    expect(root.querySelectorAll('a[href^="tel:"]')).toHaveLength(2)
    expect(root.textContent).toContain('confírmalo con la estación')
    expect(root.textContent).not.toContain('Abierta')
  })
  it('las coordenadas imposibles no generan un destino equivocado', () => {
    for (const coords of [{ lat: NaN, lng: -1 }, { lat: 40, lng: Infinity }, { lat: 0, lng: 0 }, { lat: 55, lng: 1 }]) {
      expect(mapsHref({ ...estacion, ...coords })).toContain('/maps/search/')
    }
  })
  it('solo enlaza citas y fuentes https y escapa los datos externos', () => {
    expect(enlaceOficialItv('javascript:alert(1)')).toBe('')
    expect(enlaceOficialItv('https://user:pass@example.com')).toBe('')
    const html = tarjetaItv({ ...estacion, nombre: '<img onerror=alert(1)>', citaUrl: 'javascript:alert(1)', fuenteUrl: 'data:text/html,test', verificadoEn: '2026-08-01' }, 'Utebo')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('<img')
    const cita = parse(tarjetaItv({ ...estacion, citaUrl: 'https://example.com/reserva' }, 'Utebo')).querySelector('a[href="https://example.com/reserva"]')
    expect(cita?.textContent).toBe('Pedir cita')
  })
  it('muestra la antigüedad de los contactos aunque el registro se consulte hoy', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-11-07T12:00:00Z'))
    const html = tarjetaItv({ ...estacion, publicadoEn: '2026-07', verificadoEn: '2026-11-07', contactoVerificadoEn: '2026-08-01' }, 'Utebo')
    expect(html).toContain('Documento de julio de 2026')
    expect(html).toContain('Consultado el 7 de noviembre')
    expect(html).toContain('Teléfono y ubicación de la copia del 1 de agosto')
  })
  it('un fallo de fuente conserva la fecha y no lo presenta como actualización completa', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-11-07T12:00:00Z'))
    const html = avisoDirectorio('2026-11-07', Date.now(), [
      { id: 'dgt', nombre: 'DGT', url: 'https://www.dgt.es/', estado: 'conservada', consultado: '2026-11-07', ultimoExito: '2026-08-01' },
      { id: 'gva', nombre: 'Generalitat', url: 'https://gva.es/', estado: 'actualizada', consultado: '2026-11-07', publicado: '2026-10-31' },
    ])
    expect(html).toContain('Parte del directorio sigue pendiente')
    expect(parse(html).textContent).toContain('copia anterior del 1 de agosto')
    expect(parse(html).textContent).toContain('Documento de 31 de octubre')
  })
  it('separa la localidad buscada de las estaciones cercanas', () => {
    const html = buildItvMunicipioPage('n', {
      provinciaSlug: 'bizkaia', provinciaName: 'Bizkaia', municipioName: 'Durango', estaciones: [], otrosMunicipios: [],
      canonical: 'https://example.com/itv/bizkaia/durango',
      cercanas: [{ estacion: { ...estacion, mun: 'ABADIÑO' }, distanciaKm: 4.2 }],
      origenCercanas: { nombre: 'Durango', lat: 43.17, lng: -2.63 },
    })
    expect(html).toContain('ITV cerca de Durango')
    expect(html).toContain('ITV de Abadiño')
    expect(html).toContain('4,2 km en línea recta')
    expect(html).not.toContain('application/ld+json">{"@context":"https://schema.org","@type":"ItemList"')
  })
  it('un directorio caído no se convierte en ausencia de estaciones', () => {
    const html = buildItvMunicipioPage('n', {
      directorioDisponible: false, provinciaSlug: 'madrid', provinciaName: 'Madrid', municipioName: 'Madrid',
      estaciones: [], otrosMunicipios: [], canonical: 'https://example.com/itv/madrid/madrid',
    })
    expect(html).toContain('Ahora no podemos cargar')
    expect(html).not.toContain('No tenemos una estación')
  })
})

describe('comparación de precios', () => {
  it('la caché no conserva un precio al cambiar el día, también con horario de verano', () => {
    for (const ahora of ['2026-12-31T22:59:30Z', '2026-07-01T21:59:30Z']) {
      expect(itvHeaders('n', Date.parse(ahora))['Cache-Control']).toBe('public, max-age=30, s-maxage=30')
    }
  })
  it.each(['gasolina', 'diesel'] as const)('ordena por %s y deja pendientes sin inventar importes', combustible => {
    vi.useFakeTimers().setSystemTime(new Date('2026-11-07T12:00:00Z'))
    const root = parse(buildItvPreciosPage('nonce', 'https://example.com/itv/precios', combustible, estadoTarifas()))
    expect(root.querySelector('option[selected]')?.getAttribute('value')).toBe(combustible)
    const cifras = root.querySelectorAll('.precios .precio-linea b').map(el => Number(el.textContent.replace(' €', '').replace(',', '.')))
    expect(cifras.length).toBeGreaterThan(0)
    expect(cifras).toEqual([...cifras].sort((a, b) => a - b))
    expect(root.querySelectorAll('table')).toHaveLength(0)
    for (const t of TARIFAS.filter(t => t.estado === 'verificada' && t[combustible] != null)) {
      expect(cifras).toContain(desglosa(t, t[combustible]!).total)
    }
  })
  it('deja de anunciar tarifas caducadas aunque aún estén en el fichero', () => {
    vi.useFakeTimers().setSystemTime(new Date('2031-01-01T12:00:00Z'))
    const root = parse(buildItvPreciosPage('nonce', 'https://example.com/itv/precios'))
    for (const t of TARIFAS.filter(t => t.vigenteHasta && t.vigenteHasta < '2031-01-01')) {
      const card = root.querySelectorAll('.precio-box').find(el => el.querySelector('h3')?.textContent === t.nombre)
      expect(card?.querySelector('.precio-linea b')).toBeNull()
      expect(card?.textContent).toContain('El precio necesita una nueva revisión')
      expect(card?.textContent).not.toContain(t.condiciones || 'importe antiguo')
    }
  })
})

