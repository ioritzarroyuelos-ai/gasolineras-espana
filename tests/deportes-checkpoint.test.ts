import { describe, expect, it } from 'vitest'
import { checkpointFFCV, HORARIO_DEPORTES_COMPLETO, recuperaEstadoFFCV, seleccionaFuentesDeportes } from '../scripts/lib/deportes-checkpoint.mjs'
import { creaEstadoFFCV } from '../scripts/lib/deportes-futbol.mjs'

const fecha = '2026-11-07T12:00:00.000Z'
const semilla = () => creaEstadoFFCV([{ codigo: '100', nombre: 'Liga oficial', grupos: [{ codigo: '101', nombre: 'Grupo 1' }, { codigo: '102', nombre: 'Grupo 2' }] }], { cod_temporada: '22', nombre: '2026-2027' }, fecha)

describe('continuación de deportes después de un fallo', () => {
  it('recupera el cursor del último checkpoint sin acortar la pausa publicada', () => {
    const publicado = checkpointFFCV(semilla(), Date.parse(fecha))
    publicado.noConsultarAntes = '2026-11-07T14:00:00.000Z'
    const interrumpido = checkpointFFCV({ ...semilla(), cursor: 1 }, Date.parse('2026-11-07T12:10:00Z'))
    interrumpido.noConsultarAntes = '2026-11-07T13:00:00.000Z'
    const estado = recuperaEstadoFFCV([publicado, interrumpido])
    expect(estado.cursor).toBe(1)
    expect(estado.noConsultarAntes).toBe(publicado.noConsultarAntes)
    expect(estado.catalogo?.verificadoEn).toBe(fecha)
  })
  it('no pierde consultas reservadas aunque una copia de la misma hora tenga un contador menor', () => {
    const anterior = { ...semilla(), ventana: { desde: fecha, peticiones: 119 }, guardadoEn: fecha }
    const reciente = { ...semilla(), ventana: { desde: fecha, peticiones: 20 }, guardadoEn: '2026-11-07T12:20:00.000Z' }
    expect(recuperaEstadoFFCV([anterior, reciente]).ventana.peticiones).toBe(119)
    const otraHora = { ...reciente, ventana: { desde: '2026-11-07T13:01:00.000Z', peticiones: 2 } }
    expect(recuperaEstadoFFCV([anterior, otraHora]).ventana).toEqual(otraHora.ventana)
  })
  it('un input manual amplía el descanso pero nunca lo reduce', () => {
    const estado = { ...semilla(), noConsultarAntes: '2026-11-07T14:00:00.000Z' }
    expect(recuperaEstadoFFCV([estado], '2026-11-07T13:00:00Z').noConsultarAntes).toBe(estado.noConsultarAntes)
    expect(recuperaEstadoFFCV([estado], '2026-11-07T16:00:00+01:00').noConsultarAntes).toBe('2026-11-07T15:00:00.000Z')
    expect(() => recuperaEstadoFFCV([estado], 'mañana')).toThrow('fecha ISO')
    expect(() => recuperaEstadoFFCV([estado], '2026-11-07T16:00:00')).toThrow('zona horaria')
  })
  it('una ampliación de pausa sin catálogo no borra el catálogo auténtico', () => {
    const pausa = checkpointFFCV(null, Date.parse('2026-11-07T12:30:00Z'))
    pausa.noConsultarAntes = '2026-11-07T14:00:00.000Z'
    const estado = recuperaEstadoFFCV([{ ...semilla(), cursor: 1 }, pausa])
    expect(estado.cursor).toBe(1)
    expect(estado.catalogo?.categorias[0].grupos).toHaveLength(2)
    expect(estado.noConsultarAntes).toBe(pausa.noConsultarAntes)
  })
  it('el checkpoint contiene sólo metadatos públicos y admite la semilla sin guardadoEn', () => {
    const estado = recuperaEstadoFFCV([null, { ...semilla(), cookie: 'sesion', token: 'privado' }])
    const copia = checkpointFFCV(estado, Date.parse(fecha))
    expect(copia.guardadoEn).toBe(fecha)
    expect(copia.catalogo?.completo).toBe(true)
    expect(JSON.stringify(copia)).not.toMatch(/cookie|sesion|token|privado/)
  })
})

describe('selección de las actualizaciones deportivas', () => {
  it('comprueba todos los deportes en cada pasada horaria', () => {
    expect([...seleccionaFuentesDeportes('', HORARIO_DEPORTES_COMPLETO)]).toEqual(['futbol', 'baloncesto', 'motor'])
    expect(HORARIO_DEPORTES_COMPLETO).toBe('23 * * * *')
  })
  it('admite las selecciones manuales y rechaza las que no existen antes de descargar', () => {
    expect([...seleccionaFuentesDeportes('motor')]).toEqual(['motor'])
    expect([...seleccionaFuentesDeportes('futbol,baloncesto')]).toEqual(['futbol', 'baloncesto'])
    expect([...seleccionaFuentesDeportes('todos')]).toHaveLength(3)
    expect([...seleccionaFuentesDeportes()]).toHaveLength(3)
    expect(() => seleccionaFuentesDeportes('futbol,otro')).toThrow('Selección')
    expect(() => seleccionaFuentesDeportes('', 'horario desconocido')).toThrow('Horario')
  })
})
