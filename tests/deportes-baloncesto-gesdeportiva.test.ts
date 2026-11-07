import { describe, expect, it, vi } from 'vitest'
import ligaMadrid from './fixtures/deportes-baloncesto/gesdeportiva/madrid-liga.html?raw'
import copaMelilla from './fixtures/deportes-baloncesto/gesdeportiva/melilla-copa.html?raw'
import madrid from './fixtures/deportes-baloncesto/gesdeportiva/madrid.html?raw'
import asturias from './fixtures/deportes-baloncesto/gesdeportiva/asturias.html?raw'
import murcia from './fixtures/deportes-baloncesto/gesdeportiva/murcia.html?raw'
import extremadura from './fixtures/deportes-baloncesto/gesdeportiva/extremadura.html?raw'
import canarias from './fixtures/deportes-baloncesto/gesdeportiva/canarias.html?raw'
import { documentoGesdeportiva, formularioGesdeportiva, grupoGesdeportiva, obtieneBaloncestoGesdeportiva, PORTALES_GESDEPORTIVA } from '../scripts/lib/deportes-baloncesto-gesdeportiva.mjs'
import { normalizaEstadoNovanet, checkpointNovanet, recuperaEstadoNovanet, type EstadoNovanet } from '../scripts/lib/deportes-novanet-estado.mjs'
import { validarCompeticionDeportiva } from '../scripts/lib/deportes.mjs'

const ahora = Date.parse('2026-11-07T15:15:00Z')
const capturas = { madrid, asturias, murcia, extremadura, canarias }
function lee(id: keyof typeof capturas, html = capturas[id]) {
  const portal = PORTALES_GESDEPORTIVA.find(p => p.id === id)!
  const grupo = documentoGesdeportiva(html).querySelector('select[id$=DDLGrupos] option[selected]')!.getAttribute('value')!
  return grupoGesdeportiva(html, { portal, url: portal.url, grupo }, ahora)
}
describe('baloncesto Gesdeportiva público', () => {
  it.each(Object.keys(capturas) as Array<keyof typeof capturas>)('valida calendario y temporada real de %s', id => {
    const c = lee(id)
    expect(() => validarCompeticionDeportiva(c, ahora)).not.toThrow()
    expect(c.temporada).toBe('2026-2027')
    expect(c.agenda.eventos.length).toBeGreaterThan(0)
    expect(c.agenda.eventos.some(e => e.resultado)).toBe(true)
    expect(c.agenda.eventos.some(e => /decodificar/.test(e.nombre))).toBe(false)
  })
  it('lee los empates de la tabla de Madrid y mantiene el calendario si esa tabla falla', () => {
    const c = lee('madrid', ligaMadrid)
    expect(c.clasificacion.tablas[0].columnas.some(col => col.clave === 'pe')).toBe(true)
    expect(c.clasificacion.tablas[0].filas[0].valores.pe).toBe(0)
    const rota = ligaMadrid.replace('<td class="text-center">6</td>', '<td class="text-center">999</td>')
    const parcial = lee('madrid', rota)
    expect(parcial.agenda.estado).toBe('actualizado'); expect(parcial.agenda.eventos.length).toBeGreaterThan(0)
    expect(parcial.clasificacion.estado).toBe('no_disponible')
    expect(parcial.clasificacion.aviso).toContain('No hemos podido comprobar')
  })
  it('mantiene separadas dos eliminatorias de Melilla con equipos todavía por determinar', () => {
    const portal = PORTALES_GESDEPORTIVA.find(p => p.id === 'melilla')!
    const c = grupoGesdeportiva(copaMelilla, { portal, url: portal.url, grupo: '1347' }, ahora)
    const sinEquipo = c.agenda.eventos.filter(e => /POR DETERMINAR/.test(e.nombre))
    expect(sinEquipo.length).toBeGreaterThan(1)
    expect(new Set(c.agenda.eventos.map(e => e.id)).size).toBe(c.agenda.eventos.length)
    expect(sinEquipo.every(e => e.estado === 'por_confirmar' && !e.resultado)).toBe(true)
    expect(c.agenda.eventos.some(e => e.jornada?.includes('CUARTOS DE FINAL'))).toBe(true)
  })
  it('lee los literales sin ejecutar scripts e impide interpretar otro código', () => {
    expect(documentoGesdeportiva('<td><script>decodificar("&#65;&#66;")</script></td>').text).toBe('AB')
    expect(() => documentoGesdeportiva('<td><script>decodificar(fetch("https://example.com"))</script></td>')).toThrow()
    expect(() => documentoGesdeportiva('<td><script>window.location="https://example.com"</script></td>')).toThrow()
  })
  it('no inventa un resultado0–0 ni un partido contra un equipo que descansa', () => {
    const c = lee('murcia')
    expect(c.agenda.eventos.some(e => e.estado === 'cancelado' && /RETIRAD/.test(e.nombre))).toBe(true)
    expect(c.agenda.eventos.filter(e => e.estado === 'cancelado').every(e => !e.resultado)).toBe(true)
    expect(c.agenda.eventos.some(e => e.resultado?.local === 0 && e.resultado.visitante === 0)).toBe(false)
    expect(lee('asturias').agenda.eventos.some(e => /DESCANSA/.test(e.nombre))).toBe(false)
  })
  it('respeta la hora canaria y las columnas de clasificación que llevan un escudo', () => {
    const c = lee('canarias')
    expect(c.clasificacion.tablas[0].filas[0].nombre).toBe('C. B. Roque Grande Valsequillo')
    const partido = c.agenda.eventos.find(e => e.local === 'EBFA Terraza Aguaviva' && e.visitante === 'SBT Maspalomas')!
    expect(partido.inicio).toBe('2026-10-17T15:00:00.000Z')
  })
  it('no confunde un tanteo de hoy con el resultado final aunque haya pasado la hora de inicio', () => {
    const html = madrid.replace('11/09/2026<br>19:00', '07/11/2026<br>10:00').replace('class="puntos_locales">60', 'class="puntos_locales">20').replace('class="puntos_visitantes">38', 'class="puntos_visitantes">10')
    const partido = lee('madrid', html).agenda.eventos.find(e => e.local === 'MAJADAHONDA' && e.visitante === 'FEMENINO ALCORCON')!
    expect(partido.inicio).toBe('2026-11-07T09:00:00.000Z')
    expect(partido.estado).toBe('por_confirmar'); expect(partido.resultado).toBeUndefined()
    const portal = PORTALES_GESDEPORTIVA[0], grupo = documentoGesdeportiva(html).querySelector('select[id$=DDLGrupos] option[selected]')!.getAttribute('value')!
    const noche = Date.parse('2026-11-07T23:30:00Z')
    const obtiene = (reloj: string) => grupoGesdeportiva(html, { portal: { ...portal, reloj }, url: portal.url, grupo }, noche).agenda.eventos.find(e => e.id === partido.id)!
    expect(obtiene('Europe/Madrid').resultado).toEqual({ local: 20, visitante: 10 })
    expect(obtiene('Atlantic/Canary').resultado).toBeUndefined()
  })
  it('rechaza un grupo equivocado y evita mezclar temporadas', () => {
    const portal = PORTALES_GESDEPORTIVA[0]
    expect(() => grupoGesdeportiva(madrid, { portal, url: portal.url, grupo: '999' }, ahora)).toThrow('otro grupo')
    expect(() => lee('madrid', madrid.replace('12/09/2026', '12/09/2025'))).toThrow('temporada')
  })
  it('deja sin fecha un error de año de la fuente, manteniendo los demás partidos', () => {
    const portal = PORTALES_GESDEPORTIVA[0], doc = documentoGesdeportiva(madrid)
    const grupo = doc.querySelector('select[id$=DDLGrupos] option[selected]')!.getAttribute('value')!
    const c = grupoGesdeportiva(madrid.replace('12/09/2026', '12/09/2025'), { portal, url: portal.url, grupo, temporada: { codigo: '2026', nombre: '2026-2027' } }, ahora)
    const dudoso = c.agenda.eventos.find(e => e.detalle?.startsWith('Fecha incoherente'))!
    expect(dudoso.estado).toBe('por_confirmar'); expect(dudoso.fecha).toBeUndefined(); expect(dudoso.inicio).toBeUndefined(); expect(dudoso.resultado).toBeUndefined()
    expect(c.agenda.eventos.some(e => e.resultado)).toBe(true)
  })
  it('solo envía opciones existentes y conserva los campos normales del formulario', () => {
    const form = formularioGesdeportiva(madrid, 'DDLCategorias', '17017')
    expect(form.get('__VIEWSTATE')).toBe('prueba')
    const target = form.get('__EVENTTARGET')!
    expect(target.endsWith('DDLCategorias')).toBe(true)
    expect(form.get(target)).toBe('17017')
    expect(() => formularioGesdeportiva(madrid, 'DDLCategorias', '999999')).toThrow('no está publicado')
  })
  it('respeta un descanso guardado y conserva429 antes de terminar', async () => {
    const estado = normalizaEstadoNovanet({ version: 1, noConsultarAntes: new Date(ahora + 3600000).toISOString() })
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } }))
    const guardar = vi.fn()
    const opciones = { fetcher, relojGesdeportiva: () => ahora, portalesGesdeportiva: [PORTALES_GESDEPORTIVA[0]], guardarEstadoNovanet: guardar }
    await obtieneBaloncestoGesdeportiva({ ...opciones, estadoNovanet: { 'basket-madrid': estado } })
    expect(fetcher).not.toHaveBeenCalled()
    await obtieneBaloncestoGesdeportiva(opciones)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(guardar.mock.calls.at(-1)?.[1].noConsultarAntes).toBe(estado.noConsultarAntes)
  })
  function portalSimulado(fallaDelegacion?: string) {
    const inicial = documentoGesdeportiva(madrid)
    // Una competición por delegación basta para comprobar que el cursor recorre todas las raíces.
    for (const o of inicial.querySelector('select[id$=DDLCompeticiones]')!.querySelectorAll('option')) if (o.getAttribute('value') !== '15657') o.remove()
    let documento = documentoGesdeportiva(inicial.outerHTML)
    const peticiones: Array<{ delegacion?: string; esPost: boolean }> = []
    const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body ? new URLSearchParams(String(init.body)) : null
      if (!form) documento = documentoGesdeportiva(inicial.outerHTML)
      const delegacion = form && [...form].find(([k]) => k.endsWith('DDLDelegacion'))?.[1]
      peticiones.push({ ...(delegacion ? { delegacion } : {}), esPost: !!form })
      if (delegacion === fallaDelegacion) return new Response('', { status: 503 })
      if (form) for (const select of documento.querySelectorAll('select')) {
        const codigo = form.get(select.getAttribute('name')!)
        if (codigo) for (const o of select.querySelectorAll('option')) { o.removeAttribute('selected'); if (o.getAttribute('value') === codigo) o.setAttribute('selected', 'selected') }
      }
      return new Response(documento.outerHTML)
    }
    return { fetcher, peticiones, delegaciones: inicial.querySelector('select[id$=DDLDelegacion]')!.querySelectorAll('option').map(o => o.getAttribute('value')!) }
  }
  it('continúa un catálogo interrumpido por presupuesto sin sellarlo completo ni reiniciar las primeras delegaciones', async () => {
    const portal = PORTALES_GESDEPORTIVA[0], fuente = portalSimulado()
    let estado = normalizaEstadoNovanet({ version: 1, ventana: { desde: new Date(ahora).toISOString(), peticiones: 114 } })
    const guardarEstadoNovanet = (_id: string, e: EstadoNovanet) => { estado = checkpointNovanet(e, ahora) }
    const opciones = { portalesGesdeportiva: [portal], fetcher: fuente.fetcher, guardarEstadoNovanet, duermeGesdeportiva: async () => {} }
    await obtieneBaloncestoGesdeportiva({ ...opciones, relojGesdeportiva: () => ahora, estadoNovanet: { 'basket-madrid': estado } })
    expect(estado.catalogo).toBeNull()
    expect(estado.descubrimientoGes?.categorias.length).toBeGreaterThan(0)
    expect(estado.descubrimientoGes?.pendientes.length).toBeGreaterThan(0)
    expect(estado.descubrimientoGes).not.toHaveProperty('verificadoEn')
    const yaLeidas = new Set(estado.descubrimientoGes!.categorias.map(c => JSON.parse(c.familia).delegacion))
    fuente.peticiones.length = 0
    await obtieneBaloncestoGesdeportiva({ ...opciones, relojGesdeportiva: () => ahora + 3600001, estadoNovanet: { 'basket-madrid': estado } })
    expect(estado.descubrimientoGes).toBeUndefined()
    expect([...new Set(estado.catalogo!.categorias.map(c => JSON.parse(c.familia).delegacion))].sort()).toEqual([...fuente.delegaciones].sort())
    expect(estado.catalogo!.verificadoEn).toBe(new Date(ahora + 3600001).toISOString())
    const primerCambio = fuente.peticiones.find(p => p.esPost)?.delegacion
    expect(yaLeidas.has(primerCambio)).toBe(false)
  })
  it('mantiene el catálogo anterior y su fecha cuando una delegación falla; la siguiente tanda completa solo lo pendiente', async () => {
    const portal = PORTALES_GESDEPORTIVA[0], fuente = portalSimulado('11'), antiguo = new Date(ahora - 8 * 86400000).toISOString()
    let estado = normalizaEstadoNovanet({ version: 1, catalogo: { temporada: { codigo: '2026', nombre: '2026-2027' }, verificadoEn: antiguo,
      categorias: [{ codigo: '100', nombre: 'Catálogo anterior', familia: JSON.stringify({ ruta: '/es/horarios-y-resultados', delegacion: '1', competicion: '15657', categoria: '17019' }), grupos: [] }] } })
    const guardarEstadoNovanet = (_id: string, e: EstadoNovanet) => { estado = checkpointNovanet(e, ahora) }
    const opciones = { portalesGesdeportiva: [portal], guardarEstadoNovanet, duermeGesdeportiva: async () => {} }
    await obtieneBaloncestoGesdeportiva({ ...opciones, fetcher: fuente.fetcher, relojGesdeportiva: () => ahora, estadoNovanet: { 'basket-madrid': estado } })
    expect(estado.catalogo!.verificadoEn).toBe(antiguo)
    expect(estado.catalogo!.categorias[0].nombre).toBe('Catálogo anterior')
    expect(estado.descubrimientoGes?.pendientes).toHaveLength(1)
    expect(estado.descubrimientoGes!.pendientes[0].delegacion).toBe('11')
    expect(estado.descubrimientoGes!.categorias.some(c => JSON.parse(c.familia).delegacion === fuente.delegaciones.at(-1))).toBe(true)
    const recuperada = recuperaEstadoNovanet([estado, { version: 1, guardadoEn: new Date(ahora + 1).toISOString(), noConsultarAntes: new Date(ahora + 2).toISOString() }])
    expect(recuperada.descubrimientoGes).toEqual(estado.descubrimientoGes)
    const recuperado = portalSimulado()
    await obtieneBaloncestoGesdeportiva({ ...opciones, fetcher: recuperado.fetcher, relojGesdeportiva: () => ahora + 3600001, estadoNovanet: { 'basket-madrid': recuperada } })
    expect(estado.descubrimientoGes).toBeUndefined()
    expect(new Set(estado.catalogo!.categorias.map(c => JSON.parse(c.familia).delegacion)).size).toBe(fuente.delegaciones.length)
    expect(recuperado.peticiones.find(p => p.esPost)?.delegacion).toBe('11')
    const terminada = checkpointNovanet(estado, ahora + 3600001)
    const pausaPosterior = { version: 1, guardadoEn: new Date(ahora + 3600002).toISOString(), noConsultarAntes: new Date(ahora + 7200000).toISOString() }
    expect(recuperaEstadoNovanet([recuperada, terminada, pausaPosterior]).descubrimientoGes).toBeUndefined()
    expect(normalizaEstadoNovanet({ version: 1, descubrimientoGes: { ...recuperada.descubrimientoGes, pendientes: [{ tipo: 'raiz', ruta: '//otro-host.example/' }] } }).descubrimientoGes).toBeUndefined()
  })

  // Dos categorías y dos grupos distintos permiten seguir el cursor sin depender
  // de toda la respuesta de Madrid. Los fallos se simulan en sus filtros públicos.
  function portalReducido(fallo?: (campo: string, codigo: string, categoria: string) => number | undefined, dosFases = false) {
    const inicial = documentoGesdeportiva(madrid)
    const permitidas: Record<string, string[]> = { DDLDelegacion: ['1', '11'], DDLCompeticiones: ['15657'], DDLCategorias: ['17017', '17019'], DDLFases: dosFases ? ['7878', '7805'] : ['7878'] }
    for (const [campo, valores] of Object.entries(permitidas)) for (const o of inicial.querySelector(`select[id$=${campo}]`)!.querySelectorAll('option')) if (!valores.includes(o.getAttribute('value')!)) o.remove()
    let documento = documentoGesdeportiva(inicial.outerHTML)
    const llamadas: Array<{ campo: string; codigo: string; categoria: string }> = []
    const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body || '')), campo = form.get('__EVENTTARGET')?.split(/[$_]/).at(-1) || 'GET', codigo = form.get(form.get('__EVENTTARGET') || '') || ''
      if (!init?.body) documento = documentoGesdeportiva(inicial.outerHTML)
      const categoria = [...form].find(([k]) => k.endsWith('DDLCategorias'))?.[1] || '17019'
      llamadas.push({ campo, codigo, categoria })
      const status = fallo?.(campo, codigo, categoria)
      if (status) return new Response('', { status, ...(status === 429 ? { headers: { 'Retry-After': '3600' } } : {}) })
      if (init?.body) for (const select of documento.querySelectorAll('select')) {
        const valor = form.get(select.getAttribute('name')!)
        if (valor) for (const o of select.querySelectorAll('option')) { o.removeAttribute('selected'); if (o.getAttribute('value') === valor) o.setAttribute('selected', 'selected') }
      }
      const fase = documento.querySelector('select[id$=DDLFases] option[selected]')!.getAttribute('value')
      const grupo = documento.querySelector('select[id$=DDLGrupos]')!
      grupo.set_content(`<option selected value="${(fase === '7805' ? 18570 : 17570) + (categoria === '17019' ? 1 : 0)}">COPA VIPS</option>`)
      return new Response(documento.outerHTML)
    }
    return { fetcher, llamadas }
  }
  function categoriasReducidas() {
    return ['17017', '17019'].map((categoria, i) => ({ codigo: '001001565700' + categoria, nombre: i ? 'Liga VIPS Femenina' : 'Liga VIPS Masculina',
      familia: JSON.stringify({ ruta: '/es/horarios-y-resultados', delegacion: '1', competicion: '15657', categoria }), grupos: null }))
  }
  function estadoParcial(peticiones = 0) {
    return normalizaEstadoNovanet({ version: 1, ventana: { desde: new Date(ahora).toISOString(), peticiones },
      descubrimientoGes: { fuenteUrl: PORTALES_GESDEPORTIVA[0].url, iniciadoEn: new Date(ahora).toISOString(), temporada: { codigo: '2026', nombre: '2026-2027' }, categorias: categoriasReducidas(),
        pendientes: [{ tipo: 'raiz', ruta: '/es/horarios-y-resultados', delegacion: '11' }], categoria: 0, grupo: 0 } })
  }
  it('publica grupos del catálogo parcial aunque una raíz falle, guarda el cursor y continúa sin renovar un catálogo completo', async () => {
    let estado = estadoParcial(112)
    const fuente = portalReducido((campo, codigo) => campo === 'DDLDelegacion' && codigo === '11' ? 503 : undefined)
    const opciones = { portalesGesdeportiva: [PORTALES_GESDEPORTIVA[0]], fetcher: fuente.fetcher, duermeGesdeportiva: async () => {},
      guardarEstadoNovanet: (_id: string, e: EstadoNovanet) => { estado = checkpointNovanet(e, ahora) } }
    const primera = await obtieneBaloncestoGesdeportiva({ ...opciones, relojGesdeportiva: () => ahora, estadoNovanet: { 'basket-madrid': estado } })
    expect(primera.competiciones.map(c => c.id)).toEqual(['basket-madrid-1-17570'])
    expect(estado.catalogo).toBeNull()
    expect(estado.descubrimientoGes?.pendientes).toHaveLength(1)
    expect(estado.descubrimientoGes?.categoria).toBe(1)
    expect(estado.descubrimientoGes?.categorias[0].grupos).toHaveLength(1)
    expect(estado.descubrimientoGes).not.toHaveProperty('verificadoEn')
    expect(primera.incidencias.some(i => i.motivo.startsWith('Catálogo parcial'))).toBe(true)
    expect(estado.ventana.peticiones).toBeLessThanOrEqual(120)
    const anterior = { temporada: { codigo: '2026', nombre: '2026-2027' }, verificadoEn: new Date(ahora - 8 * 86400000).toISOString(), categorias: categoriasReducidas() }
    estado.catalogo = anterior; estado.categoria = 1; estado.grupo = 0
    fuente.llamadas.length = 0
    const segunda = await obtieneBaloncestoGesdeportiva({ ...opciones, relojGesdeportiva: () => ahora + 3600001, estadoNovanet: { 'basket-madrid': estado } })
    expect(segunda.competiciones[0].id).toBe('basket-madrid-1-17571')
    expect(estado.catalogo).toEqual(anterior)
    expect(estado.categoria).toBe(1)
    expect(estado.descubrimientoGes?.pendientes).toHaveLength(1)
    for (const c of segunda.competiciones) expect(() => validarCompeticionDeportiva(c, ahora + 3600001)).not.toThrow()
  })
  it('promueve el catálogo completo conservando el siguiente grupo del recorrido parcial', async () => {
    let estado = estadoParcial(114)
    estado.descubrimientoGes!.pendientes[0] = { ...estado.descubrimientoGes!.pendientes[0], tipo: 'competicion', competicion: '15657' }
    estado.descubrimientoGes!.categoria = 1
    estado.descubrimientoGes!.categorias[1].grupos = [{ codigo: '17571', nombre: '7878|COPA VIPS' }]
    const salida = await obtieneBaloncestoGesdeportiva({ portalesGesdeportiva: [PORTALES_GESDEPORTIVA[0]], fetcher: portalReducido().fetcher, relojGesdeportiva: () => ahora, duermeGesdeportiva: async () => {}, estadoNovanet: { 'basket-madrid': estado },
      guardarEstadoNovanet: (_id, e) => { estado = checkpointNovanet(e, ahora) } })
    expect(salida.competiciones).toHaveLength(0)
    expect(estado.descubrimientoGes).toBeUndefined()
    expect(estado.catalogo?.categorias).toHaveLength(4)
    expect(estado.catalogo?.verificadoEn).toBe(new Date(ahora).toISOString())
    expect(estado.catalogo?.categorias[estado.categoria].codigo).toBe('00100156570017019')
    expect(estado.catalogo?.categorias[estado.categoria].grupos?.[estado.grupo].codigo).toBe('17571')
  })
  it('al promover otra temporada conserva los grupos nuevos comprobados durante el catálogo parcial', async () => {
    let estado = estadoParcial(114)
    estado.descubrimientoGes!.pendientes[0] = { ...estado.descubrimientoGes!.pendientes[0], tipo: 'competicion', competicion: '15657' }
    estado.catalogo = { temporada: { codigo: '2025', nombre: '2025-2026' }, verificadoEn: new Date(ahora - 8 * 86400000).toISOString(), categorias: categoriasReducidas() }
    const nueva = '00100156570017019-17571', antigua = '00100156570017017-17570', sello = new Date(ahora).toISOString()
    estado.verificados = { [nueva]: sello, [antigua]: new Date(ahora - 86400000).toISOString() }
    estado.completos = { ...estado.verificados }
    await obtieneBaloncestoGesdeportiva({ portalesGesdeportiva: [PORTALES_GESDEPORTIVA[0]], fetcher: portalReducido().fetcher, relojGesdeportiva: () => ahora, duermeGesdeportiva: async () => {}, estadoNovanet: { 'basket-madrid': estado },
      guardarEstadoNovanet: (_id, e) => { estado = checkpointNovanet(e, ahora) } })
    expect(estado.catalogo?.temporada.nombre).toBe('2026-2027')
    expect(estado.verificados).toEqual({ [nueva]: sello })
    expect(estado.completos).toEqual({ [nueva]: sello })
  })
  it.each(['abrir', 'fases'] as const)('el fallo al %s una categoría deja pasar la siguiente y se reintenta en otra tanda', async fallo => {
    let estado = normalizaEstadoNovanet({ version: 1, catalogo: { temporada: { codigo: '2026', nombre: '2026-2027' }, verificadoEn: new Date(ahora).toISOString(), categorias: categoriasReducidas() } })
    estado.catalogo!.categorias[1].grupos = [{ codigo: '17571', nombre: '7878|COPA VIPS' }]
    const fuente = portalReducido((campo, codigo, categoria) => fallo === 'abrir' ? campo === 'DDLCategorias' && codigo === '17017' ? 503 : undefined : campo === 'DDLFases' && codigo === '7805' && categoria === '17017' ? 503 : undefined, fallo === 'fases')
    const opciones = { portalesGesdeportiva: [PORTALES_GESDEPORTIVA[0]], fetcher: fuente.fetcher, duermeGesdeportiva: async () => {}, guardarEstadoNovanet: (_id: string, e: EstadoNovanet) => { estado = checkpointNovanet(e, ahora) } }
    for (const desplazamiento of [0, 3600001]) {
      const salida = await obtieneBaloncestoGesdeportiva({ ...opciones, relojGesdeportiva: () => ahora + desplazamiento, estadoNovanet: { 'basket-madrid': estado } })
      expect(salida.competiciones.map(c => c.id)).toEqual(['basket-madrid-1-17571'])
      expect(salida.incidencias.some(i => i.motivo.includes('categoría Liga VIPS Masculina'))).toBe(true)
      expect(estado.catalogo?.categorias[0].grupos).toBeNull()
    }
    expect(fuente.llamadas.filter(p => fallo === 'abrir' ? p.campo === 'DDLCategorias' && p.codigo === '17017' : p.campo === 'DDLFases' && p.codigo === '7805' && p.categoria === '17017')).toHaveLength(2)
  })
  it('un429 al abrir una categoría no adelanta el cursor ni consulta la siguiente', async () => {
    let estado = normalizaEstadoNovanet({ version: 1, catalogo: { temporada: { codigo: '2026', nombre: '2026-2027' }, verificadoEn: new Date(ahora).toISOString(), categorias: categoriasReducidas() } })
    const fuente = portalReducido(campo => campo === 'DDLCategorias' ? 429 : undefined)
    const salida = await obtieneBaloncestoGesdeportiva({ portalesGesdeportiva: [PORTALES_GESDEPORTIVA[0]], fetcher: fuente.fetcher, relojGesdeportiva: () => ahora, duermeGesdeportiva: async () => {}, estadoNovanet: { 'basket-madrid': estado },
      guardarEstadoNovanet: (_id, e) => { estado = checkpointNovanet(e, ahora) } })
    expect(salida.competiciones).toHaveLength(0)
    expect(fuente.llamadas).toHaveLength(2)
    expect(estado.categoria).toBe(0)
    expect(estado.grupo).toBe(0)
    expect(estado.noConsultarAntes).toBe(new Date(ahora + 3600000).toISOString())
  })
})
