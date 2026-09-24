import { describe, it, expect } from 'vitest'
import {
  inSpain, mapConnector, kwFromWatts, parseSites, normalizeOcm, dedup, toCompactRows, SCHEMA,
} from '../scripts/lib/electrolineras.mjs'

// Fixture DATEX2 mínimo con la MISMA estructura namespaced que el feed real de
// la DGT: dos sitios en España (uno con operador y varios conectores/puntos,
// otro sin operador) + uno fuera de bbox que debe descartarse.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<d2:payload xsi:type="egi:EnergyInfrastructureTablePublication">
  <com:feedDescription><com:values><com:value lang="es">Publicación de electrolineras</com:value></com:values></com:feedDescription>
  <egi:energyInfrastructureTable id="ELECTROLINERAS" version="20260924">
    <egi:energyInfrastructureSite id="A1" version="">
      <fac:name><com:values><com:value lang="es">Estación Centro</com:value></com:values></fac:name>
      <fac:locationReference xsi:type="loc:PointLocation">
        <loc:_locationReferenceExtension><loc:facilityLocation>
          <loc:coordinatesForDisplay><loc:latitude>40.4168</loc:latitude><loc:longitude>-3.7038</loc:longitude></loc:coordinatesForDisplay>
        </loc:facilityLocation></loc:_locationReferenceExtension>
      </fac:locationReference>
      <fac:operator xsi:type="fac:OrganisationSpecification" id="ES*IBD" version="">
        <fac:name><com:values><com:value lang="es">IBERDROLA CLIENTES S.A.U</com:value></com:values></fac:name>
        <fac:organisationUnit/>
      </fac:operator>
      <egi:energyInfrastructureStation id="A1S" version="">
        <egi:refillPoint id="p1"><egi:connector><egi:connectorType>iec62196T2</egi:connectorType><egi:maxPowerAtSocket>22000.0</egi:maxPowerAtSocket></egi:connector></egi:refillPoint>
        <egi:refillPoint id="p2"><egi:connector><egi:connectorType>iec62196T2COMBO</egi:connectorType><egi:maxPowerAtSocket>150000.0</egi:maxPowerAtSocket></egi:connector></egi:refillPoint>
      </egi:energyInfrastructureStation>
    </egi:energyInfrastructureSite>
    <egi:energyInfrastructureSite id="A2" version="">
      <fac:name><com:values><com:value lang="es">Punto Sin Operador</com:value></com:values></fac:name>
      <fac:locationReference xsi:type="loc:PointLocation">
        <loc:_locationReferenceExtension><loc:facilityLocation>
          <loc:coordinatesForDisplay><loc:latitude>41.3874</loc:latitude><loc:longitude>2.1686</loc:longitude></loc:coordinatesForDisplay>
        </loc:facilityLocation></loc:_locationReferenceExtension>
      </fac:locationReference>
      <egi:energyInfrastructureStation id="A2S" version="">
        <egi:refillPoint id="q1"><egi:connector><egi:connectorType>chademo</egi:connectorType><egi:maxPowerAtSocket>50000.0</egi:maxPowerAtSocket></egi:connector></egi:refillPoint>
      </egi:energyInfrastructureStation>
    </egi:energyInfrastructureSite>
    <egi:energyInfrastructureSite id="A3" version="">
      <fac:name><com:values><com:value lang="es">Fuera de España</com:value></com:values></fac:name>
      <fac:locationReference xsi:type="loc:PointLocation">
        <loc:_locationReferenceExtension><loc:facilityLocation>
          <loc:coordinatesForDisplay><loc:latitude>48.85</loc:latitude><loc:longitude>2.35</loc:longitude></loc:coordinatesForDisplay>
        </loc:facilityLocation></loc:_locationReferenceExtension>
      </fac:locationReference>
      <egi:energyInfrastructureStation id="A3S" version="">
        <egi:refillPoint id="r1"><egi:connector><egi:connectorType>iec62196T2</egi:connectorType><egi:maxPowerAtSocket>11000.0</egi:maxPowerAtSocket></egi:connector></egi:refillPoint>
      </egi:energyInfrastructureStation>
    </egi:energyInfrastructureSite>
  </egi:energyInfrastructureTable>
</d2:payload>`

describe('mapConnector', () => {
  it('mapea el enum DATEX2', () => {
    expect(mapConnector('iec62196T2')).toBe('T2')
    expect(mapConnector('iec62196T2COMBO')).toBe('CCS')
    expect(mapConnector('chademo')).toBe('CHAdeMO')
    expect(mapConnector('domesticF')).toBe('Schuko')
    expect(mapConnector('iec60309x2single16')).toBe('CEE')
    expect(mapConnector('iec62196T1')).toBe('T1')
  })
  it('mapea títulos de Open Charge Map', () => {
    expect(mapConnector('CCS (Type 2)')).toBe('CCS')
    expect(mapConnector('Type 2 (Socket Only)')).toBe('T2')
    expect(mapConnector('CHAdeMO')).toBe('CHAdeMO')
    expect(mapConnector('Tesla (Model S/X)')).toBe('Tesla')
  })
  it('vacío/desconocido', () => {
    expect(mapConnector('')).toBe('')
    expect(mapConnector(null)).toBe('')
  })
})

describe('kwFromWatts', () => {
  it('vatios → kW enteros', () => {
    expect(kwFromWatts('22000.0')).toBe(22)
    expect(kwFromWatts(50000)).toBe(50)
    expect(kwFromWatts('150000')).toBe(150)
  })
  it('valores ya en kW (<400) o inválidos', () => {
    expect(kwFromWatts('22')).toBe(22)
    expect(kwFromWatts('')).toBe(0)
    expect(kwFromWatts('0')).toBe(0)
    expect(kwFromWatts('abc')).toBe(0)
  })
})

describe('inSpain', () => {
  it('acepta España, rechaza (0,0), extranjero y no-números', () => {
    expect(inSpain(40.41, -3.70)).toBe(true)
    expect(inSpain(28.1, -15.4)).toBe(true) // Canarias
    expect(inSpain(0, 0)).toBe(false)
    expect(inSpain(48.85, 2.35)).toBe(false) // París
    expect(inSpain(NaN, 2)).toBe(false)
  })
})

describe('parseSites (DATEX2)', () => {
  const sites = parseSites(XML)
  it('parsea solo los sitios dentro de España (descarta el extranjero)', () => {
    expect(sites.length).toBe(2)
  })
  it('extrae nombre, operador, potencia máx, conectores y nº de puntos', () => {
    const s = sites[0]
    expect(s.title).toBe('Estación Centro')
    expect(s.operator).toBe('IBERDROLA CLIENTES S.A.U')
    expect(s.maxKw).toBe(150) // máx de 22 y 150
    expect(s.connectors).toEqual(['T2', 'CCS'])
    expect(s.points).toBe(2)
    expect(s.fuente).toBe('dgt')
  })
  it('el operador ausente queda en cadena vacía', () => {
    const s = sites[1]
    expect(s.title).toBe('Punto Sin Operador')
    expect(s.operator).toBe('')
    expect(s.connectors).toEqual(['CHAdeMO'])
    expect(s.points).toBe(1)
  })
})

describe('normalizeOcm', () => {
  const pois = [
    {
      AddressInfo: { Title: 'Parking Norte', Latitude: 43.26, Longitude: -2.93 },
      OperatorInfo: { Title: 'Zunder' },
      NumberOfPoints: 4,
      Connections: [
        { PowerKW: 50, ConnectionType: { Title: 'CCS (Type 2)' } },
        { PowerKW: 22, ConnectionType: { Title: 'Type 2 (Socket Only)' } },
      ],
    },
    { AddressInfo: { Title: 'Fuera', Latitude: 48.85, Longitude: 2.35 }, Connections: [] }, // descartado
  ]
  it('normaliza POIs de España y descarta extranjeros', () => {
    const out = normalizeOcm(pois)
    expect(out.length).toBe(1)
    expect(out[0]).toMatchObject({
      title: 'Parking Norte', operator: 'Zunder', maxKw: 50, points: 4, fuente: 'ocm',
    })
    expect(out[0].connectors).toEqual(['CCS', 'T2'])
  })
})

describe('dedup', () => {
  const dgt = parseSites(XML) // Madrid + Barcelona
  it('descarta el punto OCM pegado a uno oficial y conserva el lejano', () => {
    const ocm = normalizeOcm([
      { AddressInfo: { Title: 'Casi Madrid', Latitude: 40.4169, Longitude: -3.7039 }, Connections: [] }, // ~15 m del oficial → dup
      { AddressInfo: { Title: 'Lejos', Latitude: 37.3891, Longitude: -5.9845 }, Connections: [] }, // Sevilla → se queda
    ])
    const merged = dedup(dgt, ocm)
    expect(merged.length).toBe(dgt.length + 1)
    expect(merged.some(s => s.title === 'Lejos')).toBe(true)
    expect(merged.some(s => s.title === 'Casi Madrid')).toBe(false)
  })
})

describe('toCompactRows', () => {
  it('produce filas en el orden de SCHEMA', () => {
    const rows = toCompactRows(parseSites(XML))
    expect(SCHEMA).toEqual(['lat', 'lng', 'title', 'operator', 'maxKw', 'connectors', 'points', 'fuente'])
    const r = rows[0]
    expect(r.length).toBe(SCHEMA.length)
    expect(r[2]).toBe('Estación Centro')
    expect(r[5]).toBe('T2,CCS') // connectors como CSV
    expect(r[7]).toBe('dgt')
  })
})
