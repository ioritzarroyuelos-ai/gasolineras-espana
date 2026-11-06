import { describe, expect, it, vi } from 'vitest'
import { consultaAvisos } from '../src/lib/tiempo-avisos'

const ahora = Date.parse('2026-11-07T00:15:00Z')
function ficha(ine: string, zona: string, nombre: string, slug = 'pueblo') {
  return '<link rel="canonical" href="https://www.aemet.es/es/eltiempo/prediccion/municipios/' + slug + '-id' + ine + '"/>'
    + '<span class="font_bold">Zona de avisos</span>:&nbsp;' + nombre + '<br/>'
    + '<a href="/es/eltiempo/prediccion/avisos?w=mna&amp;l=' + zona + '">Consulta</a>'
}
const mapa = {
  elaborado: '2026-11-07T01:02:00', validez_ini_pen: '2026-11-07T01:00:00', validez_fin_pen: '2026-11-09T23:59:59',
  validez_ini_can: '2026-11-07T00:00:00', validez_fin_can: '2026-11-09T23:59:59',
  f_hoy: '2026-11-07T01:00:00', f_can_hoy: '2026-11-07T00:00:00',
  f_hoy_disp: 's', f_mna_disp: 's', f_pmna_disp: 's',
  f_can_hoy_disp: 's', f_can_mna_disp: 's', f_can_pmna_disp: 's', areas: {},
}
function cliente(html: string, mapaPrueba: unknown, avisos?: unknown) {
  return vi.fn(async (entrada: RequestInfo | URL) => {
    const url = String(entrada)
    if (url.includes('/municipios/')) return new Response(html, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } })
    if (url.includes('/avisos-horas/')) return Response.json(mapaPrueba)
    if (url.includes('/resumen-lista-avisos/') && avisos) return Response.json(avisos)
    throw Error('Fuente no disponible')
  })
}
const html = ficha('48027', '754802', 'Bizkaia interior')
function cachePrueba() {
  const datos = new Map<string, Response>()
  return {
    match: async (clave: Request) => datos.get(clave.url)?.clone(),
    put: async (clave: Request, valor: Response) => { datos.set(clave.url, valor.clone()) },
  } as Cache
}
function hora(dia: string, utc: string, tipo: string, id: string) {
  return { horas: [{ validez_ini: dia, validez_ini_utc: utc, fenomenos: [{ id, tipo }] }] }
}
function boletin(zona: string, parametro: string, nivel: string, inicio: string, fin: string) {
  const clave = '2PR-3AM-' + parametro + '-0000000000-' + zona
  return [clave, { Codigo: clave, FemParam: parametro, Severity: nivel, Onset: inicio, Expire: fin }]
}

describe('avisos publicados por AEMET para la zona del municipio', () => {
  it('sólo anuncia la ausencia de avisos cuando concuerdan la ficha, el mapa reciente y los días disponibles', async () => {
    const fetcher = cliente(html, { ...mapa, f_pmna_disp: 'n' })
    expect(await consultaAvisos('48027', { slug: 'pueblo', ahora, fetcher })).toEqual({
      estado: 'verificado', zona: 'Bizkaia interior', consultado: '2026-11-07T00:15:00.000Z',
      url: 'https://www.aemet.es/es/eltiempo/prediccion/avisos?l=754802', hasta: '2026-11-08T22:59:59.000Z', avisos: [],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('usa el minuto exacto de vigencia en Canarias, incluye su costa y no repite avisos equivalentes', async () => {
    const horas = hora('2026-11-07T02:00:00', '2026-11-07T02:00:00', 'Costeros', 'CO')
    const aviso = boletin('659101C', 'COC1', 'Naranja', '2026-11-07T02:12:00+00:00', '2026-11-07T03:45:00+00:00')
    const fetcher = cliente(ficha('35004', '659101', 'Lanzarote'), { ...mapa, areas: { '659101C': horas } }, { orden_avisos: [aviso, aviso] })
    const r = await consultaAvisos('35004', { slug: 'pueblo', ahora, fetcher })
    expect(r.hasta).toBe('2026-11-09T23:59:59.000Z')
    expect(r.avisos).toEqual([{ fenomeno: 'Costeros', nivel: 'naranja', inicio: '2026-11-07T02:12:00.000Z', fin: '2026-11-07T03:45:00.000Z' }])
    expect(String(fetcher.mock.calls[2][0])).toContain('/CAN/2026-11-07T12:00:00+00:00/D+0/659101')
  })
  it('respeta la fecha canaria cuando la Península ya ha cambiado de día', async () => {
    const reloj = Date.parse('2026-11-06T23:10:00Z')
    const parte = { ...mapa, elaborado: '2026-11-07T00:01:00', validez_ini_can: '2026-11-06T23:00:00', f_can_hoy: '2026-11-06T23:00:00',
      areas: { '659101': hora('2026-11-07T03:00:00', '2026-11-07T03:00:00', 'Vientos', 'VI') } }
    const aviso = boletin('659101', 'VIRM', 'Amarillo', '2026-11-07T03:15:00Z', '2026-11-07T03:55:00Z')
    const fetcher = cliente(ficha('35004', '659101', 'Lanzarote'), parte, { orden_avisos: [aviso] })
    const r = await consultaAvisos('35004', { ahora: reloj, slug: 'pueblo', fetcher })
    expect(r.avisos).toHaveLength(1)
    expect(String(fetcher.mock.calls[2][0])).toContain('/CAN/2026-11-07T12:00:00+00:00/D+1/659101')
  })
  it.each([{ ...mapa, elaborado: '2026-11-06T09:00:00' }, { ...mapa, validez_fin_pen: '2026-11-07T00:59:59' }])(
    'distingue un mapa caducado de uno sin avisos', async parte => {
      const r = await consultaAvisos('48027', { slug: 'pueblo', ahora, fetcher: cliente(html, parte) })
      expect(r.estado).toBe('desactualizado')
      expect(r.hasta).toBeNull()
      expect(r.zona).toBe('Bizkaia interior')
    })
  it.each([
    [{}, undefined],
    [{ ...mapa, areas: { '754801': hora('2026-11-07T01:00:00', '2026-11-07T00:00:00', 'Lluvias', 'PR') } }, undefined],
    [{ ...mapa, areas: { '754802': hora('2026-11-07T01:00:00', '2026-11-07T00:00:00', 'Lluvias', 'PR') } }, { orden_avisos: [] }],
    [{ ...mapa, areas: { '754802': hora('2026-11-07T01:00:00', '2026-11-07T00:00:00', 'Lluvias', 'PR') } },
      { orden_avisos: [boletin('754801', 'PRP1', 'Rojo', '2026-11-07T01:00:00+01:00', '2026-11-07T05:00:00+01:00')] }],
  ])('no declara ausencia cuando falla el detalle o corresponde a otra zona', async (parte, avisos) => {
    const r = await consultaAvisos('48027', { slug: 'pueblo', ahora, fetcher: cliente(html, parte, avisos) })
    expect(r.estado).toBe('no_disponible')
    expect(r.url).toContain('l=754802')
  })
  it('no sustituye un municipio desconocido por otro e incluye el mapa oficial de referencia', async () => {
    const fetcher = cliente(html, mapa)
    const r = await consultaAvisos('48999', { slug: 'municipio-desconocido', ahora, fetcher })
    expect(r.zona).toBeNull()
    expect(r.url).toBe('https://www.aemet.es/es/eltiempo/prediccion/avisos')
    expect(r.estado).toBe('no_disponible')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['11903', '611101'], ['14901', '611402'], ['14902', '611402'], ['18077', '611801'],
    ['18916', '611804'], ['21902', '612102'], ['41904', '614102'], ['48916', '754802'],
  ])('consulta la zona cartográfica del núcleo %s incluso sin ficha municipal', async (ine, codigo) => {
    const fetcher = cliente('<html></html>', mapa)
    const r = await consultaAvisos(ine, { ahora, fetcher })
    expect(r.estado).toBe('verificado')
    expect(r.url).toBe('https://www.aemet.es/es/eltiempo/prediccion/avisos?l=' + codigo)
    expect(r.zona).toContain('(núcleo urbano)')
    expect(String(fetcher.mock.calls[1][0])).toContain('/avisos-horas/PB/9/' + codigo)
  })
  it('reutiliza los boletines de la zona sin confundir el alcance de Usansolo y Durango', async () => {
    const opciones = { ahora, slug: 'pueblo', cache: cachePrueba(), fetcher: cliente(html, mapa) }
    expect((await consultaAvisos('48916', opciones)).zona).toBe('Bizkaia interior (núcleo urbano)')
    expect((await consultaAvisos('48027', opciones)).zona).toBe('Bizkaia interior')
    expect(opciones.fetcher).toHaveBeenCalledTimes(3)
  })
  it('mantiene en caché la comprobación original y retira un aviso en cuanto expira', async () => {
    const fetcher = cliente(html, { ...mapa, areas: { '754802': hora('2026-11-07T01:00:00', '2026-11-07T00:00:00', 'Tormentas', 'TO') } },
      { orden_avisos: [boletin('754802', 'TOTO', 'Rojo', '2026-11-07T01:02:00+01:00', '2026-11-07T01:15:59+01:00')] })
    const opciones = { slug: 'pueblo', ahora, cache: cachePrueba(), fetcher, origenCache: 'https://ejemplo.test/tiempo/bizkaia/durango' }
    const activo = await consultaAvisos('48027', opciones)
    expect(activo.avisos).toHaveLength(1)
    const vencido = await consultaAvisos('48027', { ...opciones, ahora: ahora + 60_000 })
    expect(vencido.estado).toBe('verificado')
    expect(vencido.consultado).toBe(activo.consultado)
    expect(vencido.avisos).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
