import { describe, it, expect } from 'vitest'
import { anotaDestinoRioja, corrigeZonaCervera, municipioOficinaRioja } from '../scripts/lib/guardias-rioja.mjs'
import { avisosDelMunicipio } from '../src/html/guardia-municipio'
import { parseGuardias } from '../src/lib/guardias'

const hoy = new Date('2026-11-06T21:30:00Z')
const zona = 'Cervera del Río Alhama'
const calle = 'Ldo. Cardona Montoya ((Plaza España, s/n) AGUILAR)'
const finca = (direccion: string, municipio: string) => [0,0,direccion,municipio,'','','2026-11-06 00:00-2026-11-06 23:59','']
const antiguo = { territorio: 'rioja', ts: hoy.toISOString(), fecha: '2026-11-06', guardiasVerificadas: true, guardias: [finca(calle,zona)] }
function oficina(nombre: string, municipio: string, via: string, portal: string) {
  return { DENOMINACION:nombre, DESC_POBLACION:municipio, VIA:via, NUMERO_VIA:portal }
}

describe('ubicación de las farmacias de Rioja Salud', () => {
  it('sirve el fichero anterior en el municipio físico y explica la remisión en la cabecera', () => {
    expect(parseGuardias(antiguo,hoy).map(f=>f.municipio)).toEqual(['Aguilar del Río Alhama'])
    expect(avisosDelMunicipio('la-rioja','cervera-del-rio-alhama',antiguo,hoy)).toContain('se atiende en Aguilar del Río Alhama')
    expect(avisosDelMunicipio('la-rioja','cervera-del-rio-alhama',antiguo,new Date('2026-11-07T12:00Z'))).toBe('')
    expect(antiguo.guardias[0][3]).toBe(zona)
  })
  it('mantiene la oficina de Cervera y aparta la que no se puede situar sin usar la cabecera', () => {
    const raw = {...antiguo,guardias:[finca('Farmacia (calle) CERVERA',zona),finca('Farmacia sin localidad comprobable',zona)]}
    expect(parseGuardias(raw,hoy).map(f=>[f.direccion,f.municipio])).toEqual([['Farmacia (calle) CERVERA',zona]])
    expect(avisosDelMunicipio('la-rioja','cervera-del-rio-alhama',raw,hoy)).toContain('pendiente de confirmar')
    const reciente = {...antiguo,guardias:[finca(calle,'Aguilar del Río Alhama')],avisosMunicipales:{}}
    expect(corrigeZonaCervera(reciente)).toBe(reciente)
  })
  it('resuelve homónimos por la calle o el rótulo y no adivina el destino si faltan ambos', () => {
    const registro = [oficina('ROLDAN YANGUAS, JAVIER. FARMACIA EL RASO','Calahorra','Grande','1'),
      oficina('ROLDAN YANGUAS, GUILLERMO. FARMACIA VIGON','Logroño','Solidaridad','22')]
    expect(municipioOficinaRioja('Ldo. Roldán Yanguas (Paseo del Raso, 2)',registro,'Calahorra')).toBe('Calahorra')
    expect(municipioOficinaRioja('Ldo. Roldán Yanguas (Farmacia Vigón) (Avda Solidaridad, 19)',registro,'Calahorra')).toBe('Logroño')
    expect(municipioOficinaRioja('Ldo. Roldán Yanguas (Dirección desconocida)',registro,'Calahorra')).toBeNull()
    expect(municipioOficinaRioja('Farmacia sin identificar (calle Grande, 1)',registro,'Calahorra')).toBeNull()
    expect(municipioOficinaRioja(calle,[oficina('JUAN PABLO CARDONA MONTOYA','Aguilar del Río Alhama','Plaza España','s/n')],zona)).toBe('Aguilar del Río Alhama')
    const avisos = {}
    anotaDestinoRioja(avisos,zona,calle,'Aguilar del Río Alhama')
    anotaDestinoRioja(avisos,zona,calle,'Aguilar del Río Alhama')
    expect(Object.values(avisos)[0]).toHaveLength(1)
  })
})
