import { describe, expect, it, vi } from 'vitest'
import { transporteFixture as archive } from './fixtures/transporte-fixture.mjs'
import { descargaCatalogoMetro, TRANSPORTE_GTFS_URL } from '../scripts/fetch-transporte.mjs'
import { validaCatalogoMetro } from '../src/lib/metro-bilbao'

const now = Date.parse('2026-11-21T00:30:00Z')
const download = (body: Uint8Array<ArrayBuffer>, stamp = now - 3600000) => vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response(body, { headers: { 'Last-Modified': new Date(stamp).toUTCString() } }))
describe('robot GTFS Metro Bilbao', () => {
  it('extrae estaciones y paradas por ID, conserva fechas y no incluye accesos ni horarios inventados', async () => {
    const fetcher = download(archive()), result = await descargaCatalogoMetro({ fetcher, now })
    expect(result).toMatchObject({ schema: 1, redId: 'metro-bilbao', fechaDatos: '2026-11-20T23:30:00.000Z', ts: '2026-11-21T00:30:00.000Z', licencia: 'CC-BY-4.0' })
    expect(result.estaciones).toEqual({ '7': { id: 'metro-bilbao-7', nombre: 'Abando', lat: 43.2614, lon: -2.92761 } })
    expect(result.paradas).toEqual({ '7.0': '7' }); expect(result.viajes).toEqual({ '123': { destino: 'Plentzia', servicio: 'diario' } })
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/); expect(validaCatalogoMetro(result, now).redId).toBe('metro-bilbao')
    expect(fetcher.mock.calls[0][0]).toBe(TRANSPORTE_GTFS_URL); expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual')
  })
  it.each(['zero', 'parent', 'duplicate', 'service', 'route', 'date', 'nested', 'large', 'missing'])('no publica un ZIP no verificable: %s', async mode => {
    await expect(descargaCatalogoMetro({ fetcher: download(archive(mode)), now })).rejects.toThrow()
  })
  it.each(['old', 'future', 'empty', 'redirect'])('rechaza origen o fecha incomprobables: %s', async mode => {
    const fetcher = mode === 'old' ? download(archive(), now - 72 * 3600000) : mode === 'future' ? download(archive(), now + 1000) : mode === 'redirect' ? async () => new Response(null, { status: 302 }) : async () => new Response(archive())
    await expect(descargaCatalogoMetro({ fetcher, now })).rejects.toThrow()
  })
})
