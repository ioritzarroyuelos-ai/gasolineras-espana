import {describe,it,expect} from 'vitest'
import {compruebaTextoTarifa,compruebaFuenteTarifa,textoTarifas,COMPROBACIONES_TARIFAS} from '../scripts/lib/itv-tarifas-check.mjs'
import {tarifaComprobadaHoy,comprobacionItvReciente,type EstadoTarifasItv} from '../src/lib/itv-tarifas-estado'
import {buildItvPreciosPage} from '../src/html/itv'
import {TARIFAS,desglosa} from '../src/lib/itv-tarifas'
const ahora = new Date('2026-11-10T12:00:00Z')
const asturias = 'Servicios ITVASA 2026. IVA actualmente vigente del 21%. Importe actual 4,18 euros. Turismos (incluido transporte escolar) 34 € (51€)'
describe('verificación diaria de las tarifas',()=>{
  it('contrasta los componentes de la fila, no sólo que la web responda',()=>{
    expect(compruebaTextoTarifa('asturias',asturias,ahora)).toBe(true)
    expect(compruebaTextoTarifa('asturias',asturias.replace('34 €','35 €')+' Otro trámite 34 €',ahora)).toBe(false)
    expect(compruebaTextoTarifa('asturias',asturias.replace('21%','22%'),ahora)).toBe(false)
    expect(compruebaTextoTarifa('asturias',asturias.replace('4,18','4,20'),ahora)).toBe(false)
    expect(compruebaTextoTarifa('asturias',asturias,new Date('2027-01-01'))).toBe(false)
  })
  it('ignora cambios de menús y conserva los signos de las tablas PDF',()=>{
    expect(compruebaTextoTarifa('asturias','<nav>Noticias nuevas</nav><p>'+asturias+'</p>',ahora)).toBe(true)
    expect(textoTarifas('MMA <3500 kg, año >2020')).toBe('mma <3500 kg, ano >2020')
  })
  it('decodifica entidades en una sola pasada y no acepta capas anidadas',()=>{
    expect(textoTarifas('&amp;#65; &#38;#65; &#x26;#65; &amp;nbsp;')).toBe('&#65; &#65; &#65; &nbsp;')
    expect(textoTarifas('&#65; &#x41; &Aacute; &euro; &amp;')).toBe('a a a € &')
    expect(textoTarifas('&#1114112; &#55296;')).toBe('\ufffd \ufffd')
    expect(compruebaTextoTarifa('asturias',asturias.replace('34 €','34 &#x26;euro;'),ahora)).toBe(false)
  })
  it('todas las cifras comparables tienen comprobación de componentes y total',()=>{
    for(const t of TARIFAS.filter(t=>t.estado==='verificada')) {
      expect(COMPROBACIONES_TARIFAS[t.slug].total).toEqual([desglosa(t,t.gasolina!).total,desglosa(t,t.diesel!).total])
    }
  })
  it('señala una fuente caída y una página de error HTTP200 sin confirmar precios',async()=>{
    const f = {id:'asturias',url:'https://sede.asturias.es/tarifa.pdf'}
    expect((await compruebaFuenteTarifa(f,ahora,async()=>{throw Error('caída')})).estado).toBe('no_disponible')
    expect((await compruebaFuenteTarifa(f,ahora,async()=>'<h1>Error</h1>')).estado).toBe('cambiada')
    expect((await compruebaFuenteTarifa(f,ahora,async()=>asturias)).estado).toBe('verificada')
  })
  it('no confirma sin revisión reciente de la tarifa y todos sus suplementos',()=>{
    const estado: EstadoTarifasItv = {v:1,checkedAt:ahora.toISOString(),estado:'verificada',
      fuentes:['asturias','tasa-dgt'].map(id=>({id,url:'https://example.com',checkedAt:ahora.toISOString(),estado:'verificada'})),
      tarifas:[{slug:'asturias',estado:'verificada',fuentes:['asturias','tasa-dgt']}]}
    expect(tarifaComprobadaHoy('asturias',estado,ahora.getTime())).toBe(true)
    expect(tarifaComprobadaHoy('asturias',estado,ahora.getTime()+31*3600000)).toBe(false)
    estado.fuentes[1].estado='cambiada'
    expect(tarifaComprobadaHoy('asturias',estado,ahora.getTime())).toBe(false)
    expect(comprobacionItvReciente('2099-01-01',ahora.getTime())).toBe(false)
    expect(tarifaComprobadaHoy('asturias',null,ahora.getTime())).toBe(false)
    const html=buildItvPreciosPage('n','https://example.com/itv/precios','gasolina',null)
    expect(html).toContain('Comprobación diaria pendiente')
    expect(html).not.toContain('<b>45,32 €</b>')
    expect(html).not.toContain('Para 1.600 cc o más, 43,52 €')
  })
})
