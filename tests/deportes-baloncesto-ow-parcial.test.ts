import { describe, expect, it } from 'vitest'
import raw from './fixtures/deportes-baloncesto/bizkaia-grupo.json?raw'
import { obtieneBaloncestoFbcv } from '../scripts/lib/deportes-baloncesto-fbcv.mjs'
import { obtieneBaloncestoFbcyl } from '../scripts/lib/deportes-baloncesto-fbcyl.mjs'
const ahora = Date.parse('2026-11-07T15:00:00Z')
const codifica = (v: unknown) => btoa(JSON.stringify({ result: 'OK', messageData: v }).replace(/[^\u0000-\u007f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')))
describe('OW: fallo parcial de la jornada anterior', () => {
  it.each(['fbcv', 'fbcyl'])('%s conserva la tabla verificada y deja la agenda incompleta sin fecha nueva', async fuente => {
    const estado = { version: 1, catalogo: { temporada: { codigo: '2026', nombre: '2026-2027' }, verificadoEn: new Date(ahora).toISOString(), categorias: [{ codigo: '02650', nombre: 'SENIOR FEMENINA', familia: 'F/2', grupos: [{ codigo: '2830', nombre: 'GRUPO ÚNICO' }] }] } }
    const actual = JSON.parse(raw); actual.lastRound = 2
    const lector = fuente === 'fbcv' ? obtieneBaloncestoFbcv : obtieneBaloncestoFbcyl
    const r = await lector({ relojFbcv: () => ahora, relojFbcyl: () => ahora, duermeFbcv: async () => {}, duermeFbcyl: async () => {}, estadoNovanet: { ['basket-' + fuente]: estado }, fetcher: async url => {
      const u = String(url)
      if (u.endsWith('/calendario-resultados-y-clasificacion/')) return new Response('<script>var owbasket = {"owbasket-apis":[{"esb":{"url":"https://esb.optimalwayconsulting.com/fbcv/1/configPublicaDePrueba"},"fede":{"url":"fbcv"},"system":{"url":"esb"}}],"owbasket-urls":[{"es":{"group":{"url":"https://www.fbcv.es/competiciones/competicion"}}}]};</script>')
      if (u.endsWith('/buscar_competicion')) return new Response('<select id="temporada"><option selected value="2026">Temporada 2026-2027</option></select><select id="territorial"><option value="2">Provincia</option></select><select id="genere"><option value="M">M</option><option value="F">F</option><option value="X">X</option></select>')
      if (u.endsWith('/competiciones/resultados/2830')) return new Response('<script>const env={"REACT_APP_URL_ESB":"https://esb.optimalwayconsulting.com/fbcyl/1/configPublicaDePrueba"}</script>')
      if (u.endsWith('/Season/getActiveWebVisibility')) return new Response(codifica([{ idSeason: '2026', name: '2026-2027', active: '1', beginDate: '2026-07-01', finalDate: '2027-06-30' }]))
      if (u.endsWith('/Zone/getVisibleWeb')) return new Response(codifica([{ idZone: '2', name: 'Provincia', visibleWeb: '1' }]))
      if (u.endsWith('/resultats/2830')) return new Response(codifica(actual))
      if (u.endsWith('/resultats/2830/1')) return new Response('', { status: 503 })
      throw Error('Consulta inesperada: ' + u)
    } })
    expect(r.competiciones).toHaveLength(1)
    expect(r.competiciones[0].agenda).toMatchObject({ estado: 'no_disponible', eventos: [] })
    expect(r.competiciones[0].agenda.verificadoEn).toBeUndefined()
    expect(r.competiciones[0].clasificacion.estado).toBe('actualizado')
    expect(r.competiciones[0].clasificacion.tablas[0].filas.length).toBeGreaterThan(1)
    expect(r.incidencias.some(i => i.motivo.includes('jornada anterior'))).toBe(true)
  })
})
