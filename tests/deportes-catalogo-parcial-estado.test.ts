import { describe, expect, it } from 'vitest'
import { normalizaEstadoNovanet, checkpointNovanet, recuperaEstadoNovanet } from '../scripts/lib/deportes-novanet-estado.mjs'

const sello = '2026-11-07T16:48:00.000Z'
const parcial = () => normalizaEstadoNovanet({ version: 1,
  noConsultarAntes: '2026-11-07T17:38:00Z', ventana: { desde: '2026-11-07T16:38:00Z', peticiones: 120 },
  ultimoExito: sello, verificados: { '10-102': sello }, completos: { '10-102': sello },
  descubrimientoGes: { fuenteUrl: 'https://www.fbm.es/es/horarios-y-resultados', iniciadoEn: '2026-11-07T16:38:00Z', temporada: { codigo: '2026', nombre: '2026-2027' },
    pendientes: [{ tipo: 'raiz', ruta: '/es/horarios-y-resultados', delegacion: '10' }], categoria: 1, grupo: 1,
    categorias: [
      { codigo: '9', nombre: 'Categoría pendiente', familia: '{"categoria":"9"}', grupos: null },
      { codigo: '10', nombre: 'Categoría comprobada', familia: '{"categoria":"10"}', grupos: [{ codigo: '101', nombre: '1|Grupo A' }, { codigo: '102', nombre: '1|Grupo B' }] },
    ],
  },
})

describe('continuación del catálogo parcialmente comprobado', () => {
  it('conserva grupos, cursor y verificaciones al guardar, recuperar y ampliar un descanso', () => {
    const anterior = checkpointNovanet(parcial(), Date.parse(sello))
    const pausa = { version: 1, guardadoEn: '2026-11-07T16:50:00Z', noConsultarAntes: '2026-11-07T18:00:00Z' }
    const recuperado = recuperaEstadoNovanet([anterior, pausa])
    expect(recuperado.catalogo).toBeNull()
    expect(recuperado.descubrimientoGes).toEqual(anterior.descubrimientoGes)
    expect(recuperado.descubrimientoGes).not.toHaveProperty('verificadoEn')
    expect(recuperado.verificados['10-102']).toBe(sello)
    expect(recuperado.completos['10-102']).toBe(sello)
    expect(recuperado.ultimoExito).toBe(sello)
    expect(recuperado.ventana.peticiones).toBe(120)
    expect(recuperado.noConsultarAntes).toBe('2026-11-07T18:00:00.000Z')
  })

  it('recuperar el catálogo completo anterior no borra el avance parcial ni renueva su fecha', () => {
    const antiguo = checkpointNovanet(normalizaEstadoNovanet({ version: 1,
      catalogo: { temporada: { codigo: '2026', nombre: '2026-2027' }, verificadoEn: '2026-10-20T00:00:00Z',
        categorias: [{ codigo: '8', nombre: 'Catálogo anterior', familia: 'anterior', grupos: [{ codigo: '80', nombre: 'Grupo anterior' }] }] },
      verificados: { '8-80': '2026-11-07T15:00:00Z' },
    }), Date.parse('2026-11-07T15:00:00Z'))
    const reciente = checkpointNovanet(parcial(), Date.parse(sello))
    const recuperado = recuperaEstadoNovanet([antiguo, reciente])
    expect(recuperado.catalogo).toEqual(antiguo.catalogo)
    expect(recuperado.descubrimientoGes).toEqual(reciente.descubrimientoGes)
    expect(recuperado.verificados).toEqual({ '8-80': '2026-11-07T15:00:00.000Z', '10-102': sello })
    expect(recuperado.ultimoExito).toBe(sello)
  })

  it('rechaza grupos corruptos y acota los cursores sin anunciar completado el catálogo', () => {
    const estado = parcial()
    estado.descubrimientoGes!.categoria = 999
    estado.descubrimientoGes!.grupo = 999
    expect(normalizaEstadoNovanet(estado).descubrimientoGes).toMatchObject({ categoria: 0, grupo: 0 })
    estado.descubrimientoGes!.categorias[1].grupos!.push({ codigo: '102', nombre: 'Duplicado' })
    expect(normalizaEstadoNovanet(estado).descubrimientoGes).toBeUndefined()
  })
})
