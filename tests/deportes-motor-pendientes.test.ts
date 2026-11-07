import { describe, expect, it } from 'vitest'
import datos from './fixtures/deportes-motor-pendientes/datos.json'
import { ampliaSupercars, fuenteSupercars, interpretaIndiceSupercars, interpretaPuntosSupercars, interpretaSesionesCronoJerez, interpretaResultadoCronoJerez } from '../scripts/lib/deportes-motor-supercars.mjs'
import { ampliaFerrari, interpretaResultadoFerrariPorClase } from '../scripts/lib/deportes-motor-ferrari.mjs'
import { interpretaCalendarioFrec, interpretaSesionesFrec, obtieneFrec } from '../scripts/lib/deportes-motor-frec.mjs'
import { tablaTcrRevisada } from '../scripts/lib/deportes-motor-tcr-revisados.mjs'
import { conservaCompeticionDeportiva, validarCompeticionDeportiva } from '../scripts/lib/deportes.mjs'
import type { CompeticionDeportiva, IncidenciaDeportes } from '../scripts/lib/deportes.mjs'

const sello = '2026-11-07T22:00:00.000Z', antiguo = '2026-11-07T18:00:00.000Z', ahora = Date.parse(sello)
const competicion = (id = 'rfeda-supercars-espana'): CompeticionDeportiva => ({ id, deporte: 'motor', nombre: 'Prueba motor', temporada: '2026', categoria: 'Motor', zona: 'España', genero: 'mixto', fuente: { nombre: 'Oficial', url: fuenteSupercars }, comprobadoEn: sello,
  agenda: { estado: 'actualizado', consultado: antiguo, verificadoEn: antiguo, fuenteUrl: fuenteSupercars, eventos: [{ id: 'sesion-antigua', nombre: 'Jerez · Carrera 1', fecha: '2026-11-07', inicio: null, estado: 'por_confirmar', fuenteUrl: fuenteSupercars }] },
  clasificacion: { estado: 'no_disponible', consultado: antiguo, fuenteUrl: fuenteSupercars, tablas: [] } })

describe('Supercars: fuentes españolas actuales y tablas generales reales', () => {
  const indice = interpretaIndiceSupercars(datos.indiceSupercars, 2026), sesiones = interpretaSesionesCronoJerez(datos.indiceJerez, indice.rondas[3], 2026)
  it('distingue temporada 2026 y campeonato español de los otros documentos', () => {
    expect(indice.rondas).toHaveLength(4)
    expect(indice.puntosUrl).toContain('005f41ab25ed4de184d3f227ef7b0105')
    expect(() => interpretaIndiceSupercars(datos.indiceSupercars, 2025)).toThrow('incompletos')
    expect(() => interpretaIndiceSupercars(datos.indiceSupercars.replace('06/08 Nov 2026', '06/08 Nov 2025'), 2026)).toThrow('temporada')
  })
  it('conserva 15 cuadros, los empates de copilotos y los puntos totales publicados', () => {
    const tablas = interpretaPuntosSupercars(datos.puntosSupercars, indice.puntosUrl, sello)
    expect(tablas).toHaveLength(15)
    expect(tablas[0].filas.slice(0, 2)).toEqual([{ posicion: 1, nombre: 'Francisco Mora', valores: { puntos: 98 } }, { posicion: 1, nombre: 'Rodrigo Almeida', valores: { puntos: 98 } }])
    expect(tablas.find(t => t.id === 'equipos-gt')?.filas[0].valores.puntos).toBe(158)
    expect(() => interpretaPuntosSupercars(datos.puntosSupercars.split('\n').filter(l => !/^2\s*\t/.test(l)).join('\n'), indice.puntosUrl, sello)).toThrow('incompletas')
    expect(() => interpretaPuntosSupercars(datos.puntosSupercars.replace('GT4 PRO TOTAL', 'CABECERA ROTA'), indice.puntosUrl, sello)).toThrow()
    expect(() => interpretaPuntosSupercars(datos.puntosSupercars.replaceAll('JEREZ', 'ESTORIL'), indice.puntosUrl, sello)).toThrow('español')
  })
  it('lee las 12 sesiones y no inventa Carrera 2 de domingo sin enlace', () => {
    expect(sesiones).toHaveLength(12)
    expect(sesiones.some(s => s.tipo === 'ra' && s.numero === 2)).toBe(false)
    expect(() => interpretaSesionesCronoJerez(datos.indiceJerez.replace('Festival - Jerez 2026', 'Festival - Jerez 2025'), indice.rondas[3], 2026)).toThrow('temporada')
    expect(() => interpretaSesionesCronoJerez(datos.indiceJerez.replace('Friday, November 6th', 'Friday, October 6th'), indice.rondas[3], 2026)).toThrow('fuera')
    expect(() => interpretaSesionesCronoJerez(datos.indiceJerez.replaceAll('./2026/JIRF/', 'x/2026/JIRF/'), indice.rondas[3], 2026)).toThrow('No hay sesiones')
  })
  it('comprueba todas las actas capturadas, sin sumar tablas repetidas de otras páginas', () => {
    const cantidades = [15, 16, 18, 21, 20, 20, 26, 27, 27, 27, 27, 26]
    for (const [i, s] of sesiones.entries()) {
      const f = s.tipo === 'ra' ? `super-jerez-${s.grupo === 'tc' ? 0 : 1}.pdf.txt` : `super-${s.fuenteUrl!.split('/').at(-1)}.txt`
      const texto = datos.sesionesJerez[f as keyof typeof datos.sesionesJerez], t = interpretaResultadoCronoJerez(texto, s, 2026, sello)
      expect(t.filas).toHaveLength(cantidades[i])
      expect(() => interpretaResultadoCronoJerez(texto, { ...s, fecha: '2026-11-08' }, 2026, sello)).toThrow('fecha')
      if (s.grupo === 'gt4' && s.tipo === 'ra') {
        expect(t.filas.slice(-5).map(f => f.posicion)).toEqual([null, null, null, null, null])
        expect(t.filas[0]).toMatchObject({ nombre: 'Tomás TEIXEIRA', valores: { vueltas: 23, tiempo: '50:00.833' } })
      }
      if (s.grupo === 'gt4' && s.tipo === 'li' && s.numero === 3) expect(t.filas.at(-1)?.valores.tiempo).toBe('Sin tiempo publicado')
    }
  })
  it('rechaza una última fila ilegible, en vez de publicar una tabla recortada', () => {
    const s = sesiones.find(s => s.grupo === 'gt4' && s.tipo === 'q' && s.numero === 2)!
    const texto = datos.sesionesJerez['super-gt4q2.pdf.txt'].replace('\t27 24 am', '\t??? 24 am')
    expect(() => interpretaResultadoCronoJerez(texto, s, 2026, sello)).toThrow('ambigua')
    expect(() => interpretaResultadoCronoJerez(datos.sesionesJerez['super-gt4q2.pdf.txt'].replace('Pág 1 de 1', 'Pág 1 de 2'), s, 2026, sello)).toThrow('página')
  })
  it.each(['catalogo', 'sesiones'])('si falla %s conserva la agenda completa anterior y su fecha', async fallo => {
    const anterior = competicion(), actual = competicion(), incidencias: IncidenciaDeportes[] = []
    await ampliaSupercars(actual, async url => { if (fallo === 'sesiones' && url === fuenteSupercars) return datos.indiceSupercars; throw Error('HTTP 503') }, 2026, ahora, sello, incidencias)
    expect(actual.agenda.estado).toBe('no_disponible')
    const conservada = conservaCompeticionDeportiva(actual, anterior)
    expect(conservada.agenda.estado).toBe('conservado')
    expect(conservada.agenda.verificadoEn).toBe(antiguo)
    expect(conservada.agenda.eventos[0].id).toBe('sesion-antigua')
    expect(() => validarCompeticionDeportiva(conservada, ahora)).not.toThrow()
  })
})

describe('FREC: enlaces finales sin asumir revisiones ni horas', () => {
  const datosCalendario = { anno: 2026, count: 1, items: [{ id: 212, titolo: 'IMOLA', data_inizio: '20260904', data_fine: '20260906', round: 7, stato: 'Italia', permalink: 'https://fiafrec.com/race/imola/' }] }
  const rondas = interpretaCalendarioFrec(datosCalendario, 2026)
  const doc = (titulo: string, archivo: string) => `<div><h3>${titulo}</h3><a href="https://fiafrec.com/wp-content/uploads/2026/09/${archivo}.pdf">PDF</a></div>`
  const bloque = (ano: number, documentos: string) => `<section><h2>IMOLA RESULTS</h2><p>4 - 6 September ${ano}</p>${documentos}</section>`
  it('no inventa número para sesión única ni elige prioridad entre dos revisiones', () => {
    const html = bloque(2027, '') + bloque(2026, doc('Qualifying - Final classification', 'unica') + doc('Race 2 - Confirmed Final Classification', 'confirmed') + doc('Race 2 - Amended Final Classification', 'amended'))
    const eventos = interpretaSesionesFrec(html, rondas, 2026)
    expect(eventos).toHaveLength(3)
    expect(eventos[0].nombre).toBe('IMOLA · Clasificación')
    expect(eventos.filter(e => /Carrera 2/.test(e.nombre))).toHaveLength(2)
    expect(eventos[1].detalle).toContain('sin afirmar cuál sustituye')
    expect(eventos.every(e => !e.inicio && e.finFecha === '2026-09-06')).toBe(true)
  })
  it('un bloque 2027 vacío no toma documentos de otra ronda y rechaza fechas contradictorias', () => {
    expect(() => interpretaSesionesFrec(bloque(2027, ''), rondas, 2026)).toThrow('No se encuentran')
    expect(() => interpretaSesionesFrec(bloque(2026, doc('Race 1 - Final classification', 'r1')).replace('4 - 6', '5 - 7'), rondas, 2026)).toThrow('contradice')
  })
  it('fallo del índice de actas conserva sesiones anteriores y su sello original', async () => {
    const actual = await obtieneFrec(async url => { if (url.includes('/wp-json/')) return JSON.stringify(datosCalendario); throw Error('HTTP 503') }, 2026, sello, [])
    const anterior = { ...competicion(actual.id), nombre: actual.nombre }
    const conservada = conservaCompeticionDeportiva(actual, anterior)
    expect(actual.agenda.estado).toBe('no_disponible')
    expect(conservada.agenda.estado).toBe('conservado')
    expect(conservada.agenda.verificadoEn).toBe(antiguo)
    expect(conservada.agenda.eventos[0].id).toBe('sesion-antigua')
  })
  it('no publica actas finales atribuidas a una ronda futura', async () => {
    const futuro = structuredClone(datosCalendario)
    futuro.items[0].data_inizio = '20261204'; futuro.items[0].data_fine = '20261206'
    const html = bloque(2026, doc('Race 1 - Final classification', 'r1')).replace('September', 'December')
    const incidencias: IncidenciaDeportes[] = []
    const c = await obtieneFrec(async url => { if (url.includes('/wp-json/')) return JSON.stringify(futuro); if (url.endsWith('/races-results/')) return html; throw Error('HTTP 503') }, 2026, sello, incidencias)
    expect(c.agenda.estado).toBe('no_disponible')
    expect(incidencias.some(i => i.motivo.includes('ronda futura'))).toBe(true)
  })
})

describe('Ferrari: alternativa oficial de la misma sesión', () => {
  const base = 'https://files.alkamelcloud.com/', ruta = 'ferrarichallenge/results/05_Europe/14_2026/05_PORTIMAO/396_COPPA%20SHELL/202607170900_Test/', normal = base + ruta + '03_Classification_Test.CSV', clase = base + ruta + '05_ClassificationByClass_Test.CSV'
  it('lee 18 pilotos reales por puesto general POS, conservando el distinto PIC de categoría', () => {
    const t = interpretaResultadoFerrariPorClase(datos.ferrariPorClase, clase, sello)
    expect(t.filas).toHaveLength(18)
    expect(t.filas[0]).toMatchObject({ nombre: 'Sven SCHÖMER', valores: { numero: 175, vueltas: 39 } })
    expect(t.filas.at(-1)?.nombre).toBe('Luis PERUSQUIA')
    expect(t.filas.map(f => f.posicion)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
    expect(() => interpretaResultadoFerrariPorClase(datos.ferrariPorClase.replace('POS;', 'OTRA;'), clase, sello)).toThrow('columnas')
  })
  it.each([false, true])('usa CSV alternativo sólo tras parseo fallido; bloqueo HTTP=%s', async bloqueado => {
    const llamadas: string[] = [], c = competicion('rfeda-ferrari-challenge-trofeo-pirelli')
    await ampliaFerrari(c, async url => {
      llamadas.push(url)
      if (url.endsWith('/manifests/results.json')) return JSON.stringify({ series: [{ id: '05_Europe', name: 'Europe', indexUrl: 'ferrarichallenge/manifests/series.json' }] })
      if (url.endsWith('/series.json')) return JSON.stringify({ seasons: [{ id: '14_2026', name: '2026', manifestUrl: 'ferrarichallenge/manifests/season.json' }] })
      if (url.endsWith('/season.json')) return JSON.stringify({ folders: [{ url: normal }, { url: clase }] })
      if (url === normal) { if (bloqueado) throw Error('HTTP 403'); return '' }
      if (url === clase) return datos.ferrariPorClase
      throw Error('Fuente inesperada')
    }, 2026, ahora, sello, [])
    expect(llamadas.includes(clase)).toBe(!bloqueado)
    expect(c.agenda.eventos.find(e => e.fecha === '2026-07-17')?.resultados?.[0].filas.length).toBe(bloqueado ? undefined : 18)
  })
})

describe('TCR: actas escaneadas revisadas y ligadas a sus bytes exactos', () => {
  const url = 'https://spain.tcr-series.com/docs/2026/r3-ricardo-tormo/TCR%20Spain%20-%20Final%20Result%20Race%202.pdf', hash = '7d7b094bca976ce1bb9b7a82863d987dc472ce4095a735d7dc3a5c1603d6f89f'
  it('conserva 11 clasificados y 2 DNC sin inventar posiciones ni tiempos', () => {
    const t = tablaTcrRevisada(hash, 'Carrera 2', 2026, url, sello)!
    expect(t.filas).toHaveLength(13)
    expect(t.filas.slice(-2).map(f => f.posicion)).toEqual([null, null])
    expect(t.columnas.some(c => c.clave === 'tiempo')).toBe(false)
  })
  it('documento modificado, año o sesión distintos requieren revisión nueva', () => {
    expect(() => tablaTcrRevisada('bytes-modificados', 'Carrera 2', 2026, url, sello)).toThrow('ha cambiado')
    expect(() => tablaTcrRevisada(hash, 'Carrera 1', 2026, url, sello)).toThrow('sesión')
    expect(() => tablaTcrRevisada(hash, 'Carrera 2', 2027, url, sello)).toThrow('sesión')
    expect(tablaTcrRevisada(hash, 'Carrera 2', 2026, url + '?otro', sello)).toBeNull()
  })
})
