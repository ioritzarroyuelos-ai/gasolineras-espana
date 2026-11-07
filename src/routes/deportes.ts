import type { Context, Hono } from 'hono'
import type { Env } from '../index'
import { loadSnapshot, genNonce, canonicalBase, pageHeaders } from '../lib/runtime'
import { filtraCompeticiones, esDeporte, idDeportivo, diaDeporte, normalizaDeporte, type IndiceDeportes, type EventoAgenda, type CompeticionDeportiva, type Deporte } from '../lib/deportes'
import { fechaDeportiva, validarCompeticionDeportiva, validarIndiceDeportes, validarAgendaDeportes } from '../../scripts/lib/deportes.mjs'
import { buildDeportesPage, buildCompeticionDeportesPage } from '../html/deportes'

export function registerDeportesRoutes(app: Hono<{ Bindings: Env }>): void {
  // Solo datos públicos e inmutables; las claves desaparecen al salir de la caché de snapshots.
  const indicesValidados = new WeakMap<object, IndiceDeportes>()
  app.get('/deportes', c => c.redirect('/deportes/', 301))
  async function portada(c: Context<{ Bindings: Env }>, deporte?: Deporte) {
    const url = new URL(c.req.url), nonce = genNonce()
    const raw = await loadSnapshot<IndiceDeportes>(c.req.url, 'deportes/index.json', c.env.ASSETS)
    let indice: IndiceDeportes | null = null
    if (raw && typeof raw === 'object') {
      try { indice = indicesValidados.get(raw) || validarIndiceDeportes(raw); indicesValidados.set(raw, indice) } catch { /* Copia incompleta: aviso 503. */ }
    }
    const zonaHoraria = c.req.query('horario') === 'canarias' ? 'canarias' : 'madrid'
    const dia = fechaDeportiva(c.req.query('fecha')) ? c.req.query('fecha')! : diaDeporte(Date.now(), zonaHoraria)
    const q = (c.req.query('q') || '').trim().slice(0, 80), zona = (c.req.query('zona') || '').slice(0, 100), categoria = (c.req.query('categoria') || '').slice(0, 100)
    const genero = ['masculino', 'femenino', 'mixto'].includes(c.req.query('genero') || '') ? c.req.query('genero')! : ''
    const competiciones = filtraCompeticiones(indice?.competiciones || [], { deporte, q, zona, categoria, genero })
    const ids = new Set(competiciones.map(co => co.id))
    const consulta = normalizaDeporte(q)
    const competicionesCompletas = new Set(competiciones.filter(co => co.deporte === 'motor' || normalizaDeporte([co.nombre, co.grupo, co.temporada].join(' ')).includes(consulta)).map(co => co.id))
    const agenda = indice?.dias.includes(dia) ? await loadSnapshot<{ eventos: EventoAgenda[] }>(c.req.url, `deportes/agenda/${zonaHoraria}/${dia}.json`, c.env.ASSETS) : null
    let eventosDelDia: EventoAgenda[] | null = null
    if (indice && agenda) { try { eventosDelDia = validarAgendaDeportes(agenda, indice, dia, zonaHoraria) } catch { /* No presentar una agenda corrupta como vacía. */ } }
    const agendaDisponible = eventosDelDia !== null
    const eventos = (eventosDelDia || []).filter(e => ids.has(e.competicionId) && (!q || competicionesCompletas.has(e.competicionId) || normalizaDeporte([e.nombre, e.local, e.visitante].join(' ')).includes(consulta)))
    const pagina = Math.min(Math.max(1, Math.trunc(Number(c.req.query('p'))) || 1), Math.max(1, Math.ceil(competiciones.length / 24)))
    const paginaAgenda = Math.min(Math.max(1, Math.trunc(Number(c.req.query('a'))) || 1), Math.max(1, Math.ceil(eventos.length / 24)))
    return new Response(buildDeportesPage({ indice, competiciones, eventos, agendaDisponible, deporte, url, zonaHoraria, dia, pagina, paginaAgenda, q, zona, categoria, genero }, nonce, canonicalBase(c) + (deporte ? '/deportes/' + deporte : '/deportes/')), { status: indice && (!indice.dias.includes(dia) || agendaDisponible) ? 200 : 503, headers: pageHeaders(nonce, false) })
  }
  app.get('/deportes/', c => portada(c))
  app.get('/deportes/competicion/:id', async c => {
    const id = c.req.param('id')
    if (!idDeportivo(id)) return c.notFound()
    const file = await loadSnapshot<CompeticionDeportiva>(c.req.url, 'deportes/' + id + '.json', c.env.ASSETS)
    if (!file) return c.notFound()
    let competicion: CompeticionDeportiva
    try { competicion = validarCompeticionDeportiva(file) } catch { return c.text('No se pueden comprobar los datos de esta competición. Inténtalo más tarde.', 503, { 'Cache-Control': 'no-store' }) }
    if (competicion.id !== id || !competicion.agenda.verificadoEn && !competicion.clasificacion.verificadoEn) return c.notFound()
    const nonce = genNonce(), zona = c.req.query('horario') === 'canarias' ? 'canarias' : 'madrid'
    return new Response(buildCompeticionDeportesPage(competicion, nonce, canonicalBase(c) + '/deportes/competicion/' + id, new URL(c.req.url), zona), { headers: pageHeaders(nonce, false) })
  })
  app.get('/deportes/:deporte', c => esDeporte(c.req.param('deporte')) ? portada(c, c.req.param('deporte') as Deporte) : c.notFound())
  app.get('/deportes/:deporte/', c => esDeporte(c.req.param('deporte')) ? c.redirect('/deportes/' + c.req.param('deporte'), 301) : c.notFound())
}
