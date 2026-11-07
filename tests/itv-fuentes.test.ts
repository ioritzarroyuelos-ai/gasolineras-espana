import { describe, expect, it, vi } from 'vitest'
import {
  FUENTES_ITV, actualizaFuenteItv, combinaFuentesItv, coordenadasItv, estacionesGva,
  estacionesIndustria, leeCsvItv, migraCopiaDgt,
} from '../scripts/lib/itv-fuentes.mjs'
import type { MetaItv, EstacionFuente } from '../scripts/lib/itv-fuentes.mjs'
import { actualizaOperadoresItv } from '../scripts/lib/itv-operadores.mjs'

const ahora = Date.parse('2026-11-07T10:00:00Z')
const consulta = new Date(ahora).toISOString()
const antigua = '2026-08-01T06:22:56.815Z'
const meta = (id:'industria'|'gva'|'dgt'):MetaItv => ({ ...FUENTES_ITV.find(f=>f.id===id)!, consultado:consulta, ultimoExito:consulta, publicado:'2026-07' })
const cabecera = ['RAZÓN SOCIAL','CÓDIGO ESTACIÓN','RÉGIMEN','COM AUTON','PROVINCIA','MUNICIPIO','DIRECCIÓN POSTAL','C. P.','L.T.','LIGEROS','PESADOS','UNIVERSALES','ESPECIALES','SUSPENSIÓN INICIO','SUSPENSIÓN FIN']

function fila(cod:number, municipio:string, cp:number, dir='Polígono La Fábrica, parcela 7'): unknown[] {
  return ['ITVASA',cod,'Empresa pública','Asturias','Asturias',municipio,dir,cp,3,2,1,0,0]
}
function dgt(cod:string, mun:string, cp:string, dir:string): EstacionFuente {
  return { id:'dgt-'+cod, codigo:cod, prov:'33', mun, cp, dir, op:'ITVASA',tel:'985 00 00 00',lat:43.2,lng:-5.8,
    lineas:3,horario:'',fuente:'dgt',verificadoEn:antigua,fuenteUrl:FUENTES_ITV[0].url }
}

describe('ingesta independiente y procedencia ITV', () => {
  it('lee puntos y coma, comillas y saltos dentro de un CSV oficial', () => {
    expect(leeCsvItv('municipio;direccion\n"ONDA";"Calle; ""doblada"""\n')).toEqual([{municipio:'ONDA',direccion:'Calle; "doblada"'}])
    expect(leeCsvItv('a;b\n"uno";"calle ""dos""\ntres"')).toEqual([{a:'uno',b:'calle "dos"\ntres'}])
  })

  it('una caída de DGT conserva su fecha y permite actualizar el directorio GVA', async () => {
    const prev = migraCopiaDgt({ generatedAt:antigua, estaciones:[dgt('3303','MIERES','33600','Parcela 7')] })
    const cab = 'tipo_estacion;provincia;municipio;cp;direccion;num_estacion;horarios;email'
    const csv = cab+'\n'+Array.from({length:20},(_,i)=>['ESTACIÓN FIJA','CASTELLÓN','Municipio '+i,'12006','Calle '+i,String(1201+i),'L.V. 7:00-21:00',''].join(';')).join('\n')
    const fetcher = vi.fn(async (input: RequestInfo|URL) => {
      if (String(input).includes('arcgis')) return new Response('error',{status:403})
      return new Response(csv,{headers:{'Last-Modified':'Sat, 31 Oct 2026 11:58:03 GMT'}})
    }) as typeof fetch
    const [caida, nueva] = await Promise.all([
      actualizaFuenteItv(FUENTES_ITV[0],prev,{ahora,fetcher}),
      actualizaFuenteItv(FUENTES_ITV[2],null,{ahora,fetcher}),
    ])
    expect(caida.estado).toBe('conservada')
    expect(caida.ultimoExito).toBe(antigua)
    expect(caida.estaciones[0].verificadoEn).toBe(antigua)
    expect(nueva.estado).toBe('actualizada')
    expect(nueva.estaciones).toHaveLength(20)
    expect(nueva.estaciones[0]).toMatchObject({verificadoEn:consulta,publicadoEn:'2026-10-31T11:58:03.000Z'})
  })

  it('una respuesta vacía conserva el último catálogo propio sin rejuvenecerlo', async () => {
    const prev = { ...meta('gva'), estado:'actualizada' as const, estaciones:[dgt('1201','CASTELLÓN','12006','Calle')], excluidas:[], ultimoExito:antigua }
    const resultado = await actualizaFuenteItv(FUENTES_ITV[2],prev,{ahora,fetcher:async()=>new Response('tipo_estacion;municipio\n')})
    expect(resultado.estado).toBe('conservada')
    expect(resultado.estaciones).toEqual(prev.estaciones)
    expect(resultado.ultimoExito).toBe(antigua)
  })

  it('incluye fijas valencianas y omite las móviles y agrícolas aunque compartan código', () => {
    const csv = 'tipo_estacion;provincia;municipio;cp;direccion;num_estacion;horarios\n'
      +'ESTACIÓN FIJA;CASTELLÓN;ONDA;12549;CARRETERA APEADERO DE BETXI;1205;7:00-20:30\n'
      +'ESTACIÓN AGRÍCOLA;CASTELLÓN;ONDA;12549;Calle;1205;VARIABLE\n'
      +'ESTACIÓN MÓVIL;CASTELLÓN;VINARÒS;12500;Calle;1251;VARIABLE\n'
    const datos = estacionesGva(csv,meta('gva'))
    expect(datos.estaciones).toHaveLength(1)
    expect(datos.estaciones[0]).toMatchObject({mun:'ONDA',codigo:'1205',horario:'7:00-20:30',lat:null,lng:null})
  })

  it('separa fijas, unidades móviles y suspensiones del registro nacional', () => {
    const suspendida = fila(3304,'SUSPENDIDA',33000)
    suspendida[13] = new Date('2026-07-01T00:00:00Z')
    const datos = estacionesIndustria([cabecera,fila(3302,'RIBADESELLA/RIBESEYA',33569),
      fila(3302,'(MÓVIL)',33569),suspendida],meta('industria'),ahora)
    expect(datos.estaciones.map(e=>e.codigo)).toEqual(['3302'])
    expect(datos.excluidas).toHaveLength(2)
    const combinado = combinaFuentesItv([{id:'industria',...datos},{id:'dgt',excluidas:[],estaciones:[dgt('3304','SUSPENDIDA','33000','Calle')]}])
    expect(combinado.map(e=>e.codigo)).toEqual(['3302'])
  })

  it('corrige la colisión de Mieres y Ribadesella por municipio y CP, conservando la fecha de sus teléfonos', () => {
    const datos = estacionesIndustria([cabecera,fila(3303,'MIERES',33600),
      fila(3302,'RIBADESELLA/RIBESEYA',33569,'Polígono Guadamía')],meta('industria'),ahora)
    const estaciones = combinaFuentesItv([{id:'industria',...datos},{id:'dgt',excluidas:[],estaciones:[
      {...dgt('3302','MIERES','33600','Polígono La Fábrica, parcela 7'),tel:'985451815'},
      {...dgt('3302','RIBADESELLA','33569','Polígono Guadamía'),tel:'985860004'},
    ]}])
    expect(estaciones).toHaveLength(2)
    expect(estaciones.find(e=>e.codigo==='3303')).toMatchObject({tel:'985451815',contactoVerificadoEn:antigua})
    expect(estaciones.find(e=>e.codigo==='3302')).toMatchObject({tel:'985860004',contactoVerificadoEn:antigua})
    expect(new Set(estaciones.map(e=>e.id)).size).toBe(2)
  })

  it('una dirección distinta no hereda coordenadas de la sede anterior', () => {
    const datos = estacionesIndustria([cabecera,fila(3303,'MIERES',33600,'Calle Nueva, 2')],meta('industria'),ahora)
    const estaciones = combinaFuentesItv([{id:'industria',...datos},{id:'dgt',excluidas:[],estaciones:[dgt('3303','MIERES','33600','Calle Vieja, 7')]}])
    expect(estaciones[0]).toMatchObject({dir:'Calle Nueva, 2',lat:null,lng:null})
    expect(coordenadasItv(null,0)).toEqual({lat:null,lng:null})
    expect(coordenadasItv(0,0)).toEqual({lat:null,lng:null})
    expect(coordenadasItv(28.9,-13.5)).toEqual({lat:28.9,lng:-13.5})
  })

  it('conserva los nombres municipales conciliados sin perder el literal de Industria', () => {
    const nuevo = {...dgt('4804','AMOREBIETA','48340','Zubieta'),prov:'48',fuente:'industria'}
    const viejo = {...nuevo,fuente:'dgt',mun:'AMOREBIETA-ETXANO'}
    const [e] = combinaFuentesItv([{id:'industria',estaciones:[nuevo],excluidas:[]},{id:'dgt',estaciones:[viejo],excluidas:[]}])
    expect(e).toMatchObject({mun:'AMOREBIETA-ETXANO',municipioFuente:'AMOREBIETA',aliasMunicipios:['AMOREBIETA','AMOREBIETA-ETXANO']})
  })

  it('un listado autonómico no revoca una suspensión nacional ni abre una estación policial', () => {
    const s={...dgt('1201','CASTELLÓN','12006','Calle'),prov:'12'}
    expect(combinaFuentesItv([{id:'industria',estaciones:[],excluidas:[{codigo:'1201',prov:'12',motivo:'suspendida o no operativa'}]},
      {id:'gva',estaciones:[s],excluidas:[]},{id:'dgt',estaciones:[s],excluidas:[]}])).toEqual([])
    const policial=fila(4820,'ERANDIO',48950)
    policial[4]='VIZCAYA'
    const datos=estacionesIndustria([cabecera,policial],meta('industria'),ahora)
    expect(datos.estaciones).toEqual([])
    expect(datos.excluidas[0].motivo).toContain('flota de Seguridad')
  })

  it('no reabre una estación durante la fecha final de su suspensión', () => {
    const s=fila(3303,'MIERES',33600)
    s[13]=new Date('2026-10-31T00:00:00Z')
    s[14]=new Date('2026-11-07T00:00:00Z')
    expect(estacionesIndustria([cabecera,s],meta('industria'),ahora).estaciones).toEqual([])
    expect(estacionesIndustria([cabecera,s],meta('industria'),ahora+86400000).estaciones).toHaveLength(1)
  })
})

describe('canales propios de cita y fichas del operador', () => {
  const sgs={...dgt('4804','AMOREBIETA-ETXANO','48340','Polígono Zubieta'),prov:'48',op:'INSPECCIÓN TÉCNICA LINK, S.A.'}
  const url='https://www.serviciositv.es/cita-previa-itv/vizcaya/amorebieta'
  const pagina=(cp='48340')=>'<title>SGS ITV Amorebieta - Cita previa</title><script type="application/ld+json">'+JSON.stringify({
    '@type':['LocalBusiness','AutomotiveBusiness'],url,name:'ITV Amorebieta',
    address:{postalCode:cp,streetAddress:'San Miguel Dudea Auzoa, 19',addressLocality:'Amorebieta-Etxano'},
    geo:{latitude:43.20055,longitude:-2.7069},telephone:'+34946308833',
  })+'</script><div class="field--name-horarios">Lunes a viernes 7–20:30. Agosto 7–14, sábados cerrado.</div>'

  it('recoge coordenadas, horario completo y teléfono de la estación exacta', async () => {
    const res=await actualizaOperadoresItv([sgs],{}, {ahora,fetcher:async()=>new Response(pagina())})
    expect(res.estaciones[0]).toMatchObject({nombre:'ITV Amorebieta',lat:43.20055,lng:-2.7069,tel:'+34946308833',
      contactoVerificadoEn:consulta,citaVerificadoEn:consulta,fuenteUrl:url,citaUrl:url})
    expect(res.estaciones[0].horario).toContain('Agosto')
    const caida=await actualizaOperadoresItv([sgs],res.perfiles,{ahora:ahora+86400000,fetcher:async()=>new Response('',{status:403})})
    expect(caida.estaciones[0].contactoVerificadoEn).toBe(consulta)
    expect(caida.estaciones[0].citaVerificadoEn).toBe(consulta)
    expect(caida.estaciones[0].lat).toBe(43.20055)
    const traslado=await actualizaOperadoresItv([{...sgs,dir:'Otra calle'}],res.perfiles,{ahora,fetcher:async()=>new Response('',{status:403})})
    expect(traslado.estaciones[0].dir).toBe('Otra calle')
    expect(traslado.estaciones[0].fuenteUrl).not.toBe(url)
  })

  it('rechaza una ficha con CP diferente y un HTTP 200 que sólo muestra un login', async () => {
    const distinta=await actualizaOperadoresItv([sgs],{},{ahora,fetcher:async()=>new Response(pagina('48950'))})
    expect(distinta.estaciones[0].citaUrl).toBeUndefined()
    const login=await actualizaOperadoresItv([dgt('3303','MIERES','33600','Calle')],{},{
      ahora,fetcher:async()=>new Response('<title>Login - ITVASA</title><p>Cita previa</p>')})
    expect(login.estaciones[0].citaUrl).toBeUndefined()
  })

  it('verifica una sola vez cada canal y no asigna citas a otro operador o provincia', async () => {
    const fetcher=vi.fn(async()=>new Response('<title>ITVASA Cita previa</title>'))
    const res=await actualizaOperadoresItv([dgt('3302','RIBADESELLA','33569','Calle'),dgt('3303','MIERES','33600','Calle'),
      {...dgt('0101','VITORIA','01015','Calle'),prov:'01'},{...sgs,op:'Otra empresa'}],{},{ahora,fetcher})
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(res.estaciones.filter(e=>e.citaUrl)).toHaveLength(2)
    expect(res.estaciones[2].citaUrl).toBeUndefined()
    expect(res.estaciones[3].citaUrl).toBeUndefined()
  })

  it('rechaza una redirección hacia una web ajena aunque incluya el nombre del operador', async () => {
    const respuesta=new Response('<title>ITVASA Cita previa</title>')
    Object.defineProperty(respuesta,'url',{value:'https://tercero.example/citas'})
    const res=await actualizaOperadoresItv([dgt('3303','MIERES','33600','Calle')],{},{ahora,fetcher:async()=>respuesta})
    expect(res.estaciones[0].citaUrl).toBeUndefined()
  })
})
