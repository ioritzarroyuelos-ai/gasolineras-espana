import { describe, expect, it } from 'vitest'
import { calendarioGipuzkoa, clasificacionGipuzkoa, descubreGipuzkoa, gruposGipuzkoa, horaGipuzkoa, obtieneBaloncestoTerritorial } from '../scripts/lib/deportes-baloncesto-territorial.mjs'
import { validarCompeticionDeportiva } from '../scripts/lib/deportes.mjs'

// Estructuras mínimas de las respuestas públicas comprobadas el 7/11/2026.
// Se omiten logotipos, seguimiento y enlaces de responsables/árbitros.
const ahora = Date.parse('2026-11-07T10:00:00Z')
const grupo = { temporadaId: '29', referencia: '618', referenciaNombre: 'PROVINCIAL FEDERADO Y ESCOLAR 2026-27', categoria: '1', grupo: '2', nombre: 'Senior Mas. 1ª Div. - Senior Mas. 1ª Div. - G-2' }
const query = '?temporada=29&referencia=618&categoria=1&grupo=2'
const portada = `<ul id="detalle_f_temporada"><li class="active" data-val="29">2026/2027</li></ul>
<div id="filterbar" data-templateslug="ligas" data-template="https://www.gisaski.eus/site/contenido/themes/fgb/core/public/content/competicion/ajax-"></div>
<ul id="detalle_f_referencia"><li data-val="618">PROVINCIAL FEDERADO Y ESCOLAR 2026-27</li><li data-val="621">COMPETICIÓN ESTATAL 2026-27</li></ul>
<input id="f_ultjornada" value="2026-11-01"><input id="f_proxjornada" value="2026-11-08">`
const agrupacion = '<div class="agrupacion" data-temporada="29" data-referencia="618" data-categoria="1" data-grupo="2"><div class="competi">Senior Mas. 1ª Div. - Senior Mas. 1ª Div. - G-2</div></div>'
function partido({ fecha = '31/10/2026 (Sábado)', hora = '16:00', local = '77', visitante = '79', nota = '', id = '3289900' } = {}) {
  return `<div class="card__partidos"><header class="card__header"><a href="${query}&jornada=2026-11-01">Jornada 5 (01/11/2026)</a></header><div class="results_list">
  <div class="row date">${fecha}</div><div class="row metas"><div class="time"><span>${hora}</span></div><div class="loc"><span>pol. hernani (HERNANI)</span></div><a data-partido="${id}"></a></div>
  ${nota ? `<div class="row partidoVinculado">${nota}</div>` : ''}<div class="row partido"><div class="left"><a class="fichaEquipo" href="${query}&equipo=70"><div class="equipo">HERNANI K.E.</div></a></div><div class="marcador"><span class="local">${local}</span><span>-</span><span class="visitante">${visitante}</span></div><div class="right"><div class="equipo">ASTIGARRAGAKO MUNDARRO K.E.</div></div></div></div></div>`
}
const tabla = '<table><thead><tr>' + ['Pos', 'Equipo', 'PTOS', 'PJ', 'PG', 'PE', 'PP', 'NP', 'TF', 'TC'].map(x => `<th>${x}</th>`).join('') + '</tr></thead><tbody><tr><td>01</td><td><a href="' + query + '&equipo=39"><div class="equipo">ASTIGARRAGAKO MUNDARRO K.E.</div></a></td>' + [10, 5, 5, 0, 0, 0, 384, 293].map(n => `<td>${n}</td>`).join('') + '</tr></tbody></table>'

describe('Baloncesto territorial: identidad y calendario oficiales', () => {
  it('descubre los grupos de la temporada real y evita una cobertura nacional parcial duplicada', () => {
    expect(descubreGipuzkoa(portada, ahora)).toMatchObject({ temporada: '2026/2027', temporadaId: '29', referencias: [{ id: '618', nombre: grupo.referenciaNombre }] })
    expect(() => descubreGipuzkoa(portada.replace('2026/2027', '2025/2026'), ahora)).toThrow(/temporada/)
    expect(gruposGipuzkoa(agrupacion, '29', { id: '618', nombre: grupo.referenciaNombre })).toEqual([grupo])
    expect(() => gruposGipuzkoa(agrupacion.replace('data-temporada="29"', 'data-temporada="28"'), '29', { id: '618', nombre: grupo.referenciaNombre })).toThrow(/Identidad/)
    expect(gruposGipuzkoa('La referencia seleccionada no tiene configurada ninguna competición.', '29', { id: '618', nombre: grupo.referenciaNombre })).toEqual([])
  })

  it('convierte la hora peninsular respetando el verano y el invierno', () => {
    expect(horaGipuzkoa('2026-10-24', '18:00')).toBe('2026-10-24T16:00:00.000Z')
    expect(horaGipuzkoa('2026-10-31', '18:00')).toBe('2026-10-31T17:00:00.000Z')
    expect(horaGipuzkoa('2026-10-25', '02:30')).toBeNull()
    expect(horaGipuzkoa('2027-03-28', '02:30')).toBeNull()
    expect(horaGipuzkoa('2026-11-07', '00:00')).toBeNull()
    expect(horaGipuzkoa('2026-11-07', 'Por confirmar')).toBeNull()
  })

  it('lee el marcador publicado y conserva el nombre, la jornada y la hora de cada partido', () => {
    expect(calendarioGipuzkoa(partido(), grupo, '2026/2027', ahora)[0]).toMatchObject({ id: 'gip-3289900', estado: 'finalizado', inicio: '2026-10-31T15:00:00.000Z', resultado: { local: 77, visitante: 79 }, local: 'HERNANI K.E.', visitante: 'ASTIGARRAGAKO MUNDARRO K.E.', jornada: 'Jornada 5 (01/11/2026)' })
    expect(calendarioGipuzkoa(partido({ fecha: '07/11/2026 (Sábado)', hora: '15:30', local: '', visitante: '' }), grupo, '2026/2027', ahora)[0]).toMatchObject({ estado: 'programado', inicio: '2026-11-07T14:30:00.000Z' })
  })

  it('no convierte un partido sin marcador o un 0-0 en un resultado final', () => {
    for (const valor of ['', '0']) {
      const e = calendarioGipuzkoa(partido({ local: valor, visitante: valor }), grupo, '2026/2027', ahora)[0]
      expect(e.estado).toBe('por_confirmar'); expect(e.resultado).toBeUndefined()
    }
    expect(() => calendarioGipuzkoa(partido({ visitante: '' }), grupo, '2026/2027', ahora)).toThrow(/Marcador/)
    expect(() => calendarioGipuzkoa(partido({ fecha: '07/11/2026 (Sábado)' }), grupo, '2026/2027', ahora)).toThrow(/futura/)
    expect(() => calendarioGipuzkoa(partido({ fecha: '08/11/2026 (Domingo)', hora: '00:00' }), grupo, '2026/2027', ahora)).toThrow(/futura/)
    expect(() => calendarioGipuzkoa(partido({ fecha: '08/11/2026 (Domingo)', hora: '' }), grupo, '2026/2027', ahora)).toThrow(/futura/)
  })

  it('no presenta como fecha real la jornada original ni la de destino de un aplazamiento', () => {
    const nota = 'Partido aplazado a la jornada 25/10/2026.'
    const e = calendarioGipuzkoa(partido({ nota, local: '', visitante: '' }), grupo, '2026/2027', ahora)[0]
    expect(e).toMatchObject({ estado: 'aplazado', inicio: null, fecha: null, detalle: nota })
    expect(calendarioGipuzkoa(partido({ nota }), grupo, '2026/2027', ahora)[0]).toMatchObject({ estado: 'finalizado', inicio: null, fecha: null, resultado: { local: 77, visitante: 79 } })
    expect(calendarioGipuzkoa(partido({ nota }) + partido(), grupo, '2026/2027', ahora)).toHaveLength(1)
    expect(calendarioGipuzkoa(partido({ fecha: '28/11/2026 (Sábado)', nota: 'Partido adelantado a la jornada 01/11/2026.' }), grupo, '2026/2027', ahora)[0]).toMatchObject({ estado: 'finalizado', inicio: null, fecha: null })
    expect(calendarioGipuzkoa(partido({ fecha: '28/11/2026 (Día sin definir)', hora: '', local: '', visitante: '' }), grupo, '2026/2027', ahora)[0]).toMatchObject({ estado: 'por_confirmar', inicio: null, fecha: null })
  })

  it('rechaza calendarios de otro grupo, otra temporada y fechas imposibles', () => {
    expect(() => calendarioGipuzkoa(partido().replaceAll('grupo=2', 'grupo=3'), grupo, '2026/2027', ahora)).toThrow(/otro|otra/)
    expect(() => calendarioGipuzkoa(partido({ fecha: '31/10/2025 (Sábado)' }), grupo, '2026/2027', ahora)).toThrow(/temporada/)
    expect(() => calendarioGipuzkoa(partido({ fecha: '31/02/2027 (Sábado)' }), grupo, '2026/2027', ahora)).toThrow(/Fecha/)
  })

  it('lee las columnas oficiales de clasificación sin sustituirlas por valores inventados', () => {
    expect(clasificacionGipuzkoa(tabla, grupo)[0].filas[0]).toMatchObject({ posicion: 1, nombre: 'ASTIGARRAGAKO MUNDARRO K.E.', valores: { puntos: 10, pj: 5, pg: 5, pe: 0, pp: 0, np: 0, pf: 384, pc: 293 } })
    expect(() => clasificacionGipuzkoa(tabla.replace('<td>384</td>', '<td>-</td>'), grupo)).toThrow(/Puntuación/)
    expect(clasificacionGipuzkoa('No hay clasificación disponible.', grupo)).toEqual([])
    expect(() => clasificacionGipuzkoa('<main>Acceso denegado</main>', grupo)).toThrow()
  })

  it('mantiene el calendario si falla la tabla y no supera tres peticiones simultáneas', async () => {
    let activas = 0, maximo = 0
    const fetcher = (async (_url: string, init?: RequestInit) => {
      activas++; maximo = Math.max(maximo, activas)
      await new Promise(resolve => setTimeout(resolve, 1))
      const p = new URLSearchParams(init?.body as URLSearchParams)
      let respuesta = portada
      if (init?.method === 'POST') {
        if (!p.get('templateName')) respuesta = [2, 3, 4, 5, 6].map(n => agrupacion.replace('data-grupo="2"', `data-grupo="${n}"`)).join('')
        else if (p.get('templateName') === 'jornadas') respuesta = partido().replaceAll('grupo=2', `grupo=${p.get('f_grupo')}`)
        else { activas--; return new Response('no disponible', { status: 403 }) }
      }
      activas--; return new Response(respuesta)
    }) as typeof fetch
    const r = await obtieneBaloncestoTerritorial({ fetcher, ahora })
    expect(r.competiciones).toHaveLength(5); expect(r.incidencias).toHaveLength(5); expect(maximo).toBeLessThanOrEqual(3)
    for (const c of r.competiciones) {
      expect(c.agenda.estado).toBe('actualizado'); expect(c.clasificacion.estado).toBe('no_disponible')
      expect(() => validarCompeticionDeportiva(c, ahora)).not.toThrow()
    }
  })

  it('respeta el límite de consultas de la federación y no reintenta un HTTP 429', async () => {
    let llamadas = 0
    const fetcher = (async () => { llamadas++; return new Response('Demasiadas consultas', { status: 429, headers: { 'Retry-After': '3600' } }) }) as typeof fetch
    const r = await obtieneBaloncestoTerritorial({ fetcher, ahora })
    expect(llamadas).toBe(1)
    expect(r.competiciones).toEqual([])
    expect(r.incidencias[0].motivo).toContain('429')
  })

  it('no inicia más consultas de grupo después de recibir HTTP 429', async () => {
    let limitadas = 0
    const fetcher = (async (_url: string, init?: RequestInit) => {
      const p = new URLSearchParams(init?.body as URLSearchParams)
      if (init?.method !== 'POST') return new Response(portada)
      if (!p.get('templateName')) return new Response([2, 3, 4, 5, 6].map(n => agrupacion.replace('data-grupo="2"', `data-grupo="${n}"`)).join(''))
      limitadas++
      return new Response('Demasiadas consultas', { status: 429, headers: { 'Retry-After': '3600' } })
    }) as typeof fetch
    const r = await obtieneBaloncestoTerritorial({ fetcher, ahora })
    expect(limitadas).toBeLessThanOrEqual(3)
    expect(r.competiciones).toHaveLength(5)
    expect(r.competiciones.every(c => c.agenda.estado === 'no_disponible' && c.clasificacion.estado === 'no_disponible')).toBe(true)
  })
})
