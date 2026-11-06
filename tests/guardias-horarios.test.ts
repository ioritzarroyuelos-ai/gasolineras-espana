import { describe, expect, it } from 'vitest'
import { turnosLasPalmas } from '../scripts/lib/guardias-fuentes.mjs'
import { estadoGuardia, textoHorarioGuardia, tipoAtencionGuardia } from '../src/lib/guardias'

const fecha = '2026-11-06'
const captura = fecha + 'T07:30:00Z'
const ahora = new Date(fecha + 'T15:00:00Z')
const canarias = 'Atlantic/Canary'
function farmacia(territorio: string, horario: string, nota = '', fechaTurno: string | undefined = fecha, completos = true) {
  return { territorio, fechaTurno, horarioCompleto: completos, direccion: 'Farmacia', municipio: '', telefono: '', cp: '', lat: 0, lng: 0, horario, horarioDesc: nota }
}

describe('horarios completos de los colegios', () => {
  it('Zaragoza capital confirma las urgencias de 24 h dentro del tramo común y pide llamar durante el relevo', () => {
    const aviso = 'GUARDIAS TODO EL DÍA · DE 9:30 DE HOY A 9:30 DE MAÑANA. DE 12 DE LA NOCHE A 9:15 DE LA MAÑANA, CONSULTE LAS FARMACIAS DE GUARDIA DE AYER'
    const f = { ...farmacia('zaragoza',aviso), municipio: 'Zaragoza' }
    expect(estadoGuardia(f,captura,new Date(fecha+'T08:29Z')).conocida).toBe(false)
    expect(estadoGuardia(f,captura,new Date(fecha+'T08:30Z'))).toEqual({conocida:true, abierta:true, todoElDia:true})
    expect(estadoGuardia(f,captura,new Date('2026-11-07T08:14Z')).abierta).toBe(true)
    expect(estadoGuardia(f,captura,new Date('2026-11-07T08:15Z')).conocida).toBe(false)
    expect(estadoGuardia(f,captura,new Date('2026-11-07T08:30Z')).abierta).toBe(false)
    expect(textoHorarioGuardia(f,captura,ahora)).toContain('llama para confirmar el relevo')
    expect(estadoGuardia({...f,municipio:'Otro municipio'},captura,ahora).conocida).toBe(false)
  })
  it('Burgos respeta la hora de relevo del colegio aunque el título diga 24 horas', () => {
    const exacta = farmacia('burgos', 'GUARDIAS TODO EL DÍA · DE 9:50 A 9:50 (24 HORAS)')
    expect(estadoGuardia(exacta, captura, new Date('2026-11-06T08:49Z')).abierta).toBe(false)
    expect(estadoGuardia(exacta, captura, new Date('2026-11-07T08:49Z')).todoElDia).toBe(true)
    expect(estadoGuardia(exacta, captura, new Date('2026-11-07T08:50Z')).abierta).toBe(false)
    const relevo = farmacia('burgos', 'GUARDIAS TODO EL DÍA · DE 9:30 DE HOY A 10:15 DE MAÑANA (24 HORAS)')
    expect(estadoGuardia(relevo, captura, new Date('2026-11-07T09:14Z')).abierta).toBe(true)
    expect(estadoGuardia(relevo, captura, new Date('2026-11-07T09:15Z')).abierta).toBe(false)
  })
  it('reconoce los horarios explícitos de Jaén y Pontevedra si concuerdan con el turno', () => {
    const noche = farmacia('jaen','Nocturna 22:00-9:30')
    expect(estadoGuardia(noche,captura,new Date(fecha+'T20:59Z')).abierta).toBe(false)
    expect(estadoGuardia(noche,captura,new Date(fecha+'T21:00Z')).abierta).toBe(true)
    expect(estadoGuardia(noche,captura,new Date('2026-11-07T08:30Z')).abierta).toBe(false)
    expect(estadoGuardia(farmacia('jaen','Diurna 9:30-22:00'),captura,ahora).abierta).toBe(true)
    const dia = farmacia('pontevedra','Turno diurno','De 9:30 h. a 22 h.')
    expect(estadoGuardia(dia,captura,new Date(fecha+'T20:59Z')).abierta).toBe(true)
    expect(estadoGuardia(dia,captura,new Date(fecha+'T21:00Z')).abierta).toBe(false)
    const redondela = farmacia('pontevedra','Turno nocturno','Estando de guardia desde las 22:00 hasta las 9:30.')
    expect(estadoGuardia(redondela,captura,new Date('2026-11-07T08:29Z')).abierta).toBe(true)
    expect(estadoGuardia(redondela,captura,new Date('2026-11-07T08:30Z')).abierta).toBe(false)
    expect(estadoGuardia(farmacia('pontevedra','Turno diurno','Desde las 9:30 h hasta las 22 h. Cambio de turno: sábados a las 9:30.'),captura,ahora).abierta).toBe(true)
    expect(estadoGuardia(farmacia('pontevedra','Turno nocturno','De 9:30 h. a 22 h.'),captura,ahora).conocida).toBe(false)
    expect(estadoGuardia(farmacia('pontevedra','Turno diurno y nocturno','De 9:30 h. a 22 h.'),captura,ahora).conocida).toBe(false)
  })
  it('las etiquetas de duración sin relevo, las aperturas ordinarias y las localizadas siguen fuera de los filtros de guardia', () => {
    for (const f of [farmacia('badajoz','GUARDIAS TODO EL DÍA · DE 24 HORAS'), farmacia('valladolid','Día y noche (24 horas)'),
      farmacia('jaen','Guardia de 24 horas. Consulta el horario de relevo del calendario.'), farmacia('teruel','De guardia 24 horas'),
      farmacia('huelva','24 horas','Horario habitual'), farmacia('burgos','GUARDIAS TODO EL DÍA · DE 10 A 10 (24 HORAS) - GUARDIA LOCALIZADA')]) {
      expect(estadoGuardia(f,captura,ahora).abierta).toBe(false)
    }
  })
  it('en Corvera el domingo comienza a las diez y una mañana laborable con posible festivo conserva la duda hasta esa hora', () => {
    const nota = 'Lunes a sábado de 9,30 de la mañana a 10 de la noche. Domingos y festivos: de 10 de la mañana a 10 de la noche'
    const domingo = farmacia('asturias','',nota,'2026-11-01')
    expect(estadoGuardia(domingo,'2026-11-01T07:00Z',new Date('2026-11-01T08:45Z')).abierta).toBe(false)
    expect(estadoGuardia(domingo,'2026-11-01T07:00Z',new Date('2026-11-01T09:00Z')).abierta).toBe(true)
    expect(estadoGuardia(farmacia('asturias','',nota),captura,new Date(fecha+'T08:45Z')).conocida).toBe(false)
    expect(estadoGuardia(farmacia('asturias','',nota),captura,ahora).abierta).toBe(true)
  })
  it('en Soria una posibilidad de atención localizada no asegura que la farmacia atienda a puerta cerrada ni que esté abierta', () => {
    const g = farmacia('soria','09:00-22:00','El colegio indica que la atención puede ser localizada. Llama antes de acudir.')
    expect(tipoAtencionGuardia(g)).toBe('guardia')
    expect(estadoGuardia(g,captura,ahora).conocida).toBe(false)
  })
  it('entiende los dos extremos publicados en Córdoba y por el Consejo, y conserva las excepciones sin dar por abierta la farmacia', () => {
    const dia = farmacia('cordoba', 'DE 9:30 DE LA MAÑANA A 22:00 DE LA NOCHE')
    expect(estadoGuardia(dia, captura, ahora).abierta).toBe(true)
    expect(estadoGuardia(dia, captura, new Date(fecha + 'T21:00Z')).abierta).toBe(false)
    const continua = farmacia('malaga', 'GUARDIAS TODO EL DÍA · DE 9.30 DE HOY A 9.30 DE MAÑANA')
    expect(estadoGuardia(continua, captura, new Date('2026-11-07T06:00Z')).todoElDia).toBe(true)
    for (const h of ['HASTA LAS 22:00 HORAS', 'GUARDIAS DE NOCHE · DE 01.00 A 09.30', 'DE 9:00 A 21:00 SALVO FESTIVOS']) {
      expect(estadoGuardia(farmacia('malaga', h), captura, ahora).conocida).toBe(false)
    }
  })
  it('Almenara abre exactamente desde las 9 hasta las 9 del día siguiente', () => {
    const g = farmacia('castellon', '06/11/2026 De 9 a 9 del día siguiente')
    expect(estadoGuardia(g, captura, new Date('2026-11-06T07:59Z')).abierta).toBe(false)
    expect(estadoGuardia(g, captura, new Date('2026-11-07T07:59Z'))).toEqual({ conocida: true, abierta: true, todoElDia: true })
    expect(estadoGuardia(g, captura, new Date('2026-11-07T08:00Z')).abierta).toBe(false)
    expect(textoHorarioGuardia(g, captura, ahora)).toContain('del día siguiente')
    const noche = farmacia('castellon', '06/11/2026 De 21:00 h a 9:00 h. del día siguiente.', 'Quedan 6 horas y 43 minutos para el inicio de la guardia')
    expect(estadoGuardia(noche, captura, new Date('2026-11-07T01:30Z'))).toEqual({ conocida: true, abierta: true, todoElDia: false })
    expect(textoHorarioGuardia(noche, captura, ahora)).not.toMatch(/Quedan/)
  })

  it('Barcelona conserva ambos tramos y las notas, y respeta el descanso de mediodía', () => {
    const completa = farmacia('barcelona', '09:00-22:00, 22:00-09:00', 'MHDA')
    expect(textoHorarioGuardia(completa, captura, ahora)).toBe('09:00-22:00, 22:00-09:00 · MHDA')
    expect(estadoGuardia(completa, captura, ahora).todoElDia).toBe(true)
    const partida = farmacia('barcelona', '09:00-13:30, 16:30-20:00, 22:00-09:00')
    for (const h of ['12:30','15:29','19:00','20:59']) expect(estadoGuardia(partida, captura, new Date(fecha + 'T' + h + 'Z')).abierta).toBe(false)
    for (const h of ['12:29','15:30','21:00']) expect(estadoGuardia(partida, captura, new Date(fecha + 'T' + h + 'Z'))).toMatchObject({ abierta: true, todoElDia: false })
  })

  it('en Adeje escoge viernes local, incluye el turno anterior sólo si sigue abierto y nunca el jueves completo como horario del viernes', () => {
    const g = farmacia('tenerife', 'Jueves: Desde las 09:00 hasta las 09:00 del viernes\r\nViernes: Desde las 09:00 hasta las 21:00\r\nSábado: Desde las 09:00 hasta las 21:00')
    expect(tipoAtencionGuardia(g)).toBe('apertura')
    const manana = new Date(fecha + 'T08:30Z')
    expect(textoHorarioGuardia(g, captura, manana, canarias)).toMatch(/Turno del jueves hasta las 09:00.+viernes: Desde las 09:00 hasta las 21:00/)
    expect(estadoGuardia(g, captura, manana, canarias).abierta).toBe(true)
    expect(textoHorarioGuardia(g, captura, ahora, canarias)).toBe('viernes: Desde las 09:00 hasta las 21:00')
    expect(estadoGuardia(g, captura, new Date(fecha + 'T20:59Z'), canarias).abierta).toBe(true)
    expect(estadoGuardia(g, captura, new Date(fecha + 'T21:00Z'), canarias).abierta).toBe(false)
    expect(estadoGuardia(g, captura, new Date('2026-11-07T06:00Z'), canarias).conocida).toBe(false)
  })

  it('distingue el jueves anterior del siguiente y mantiene solamente la noche publicada tras medianoche', () => {
    const g = farmacia('tenerife', 'Jueves: Desde las 08:00 hasta las 01:00 del viernes\r\nViernes: Desde las 08:00 hasta las 01:00 del sábado\r\nSábado: Desde las 09:00 hasta las 21:00\r\nJueves: Desde las 08:00 hasta las 22:00')
    expect(estadoGuardia(g, fecha+'T00:01Z', new Date(fecha+'T00:30Z'), canarias).abierta).toBe(true)
    const madrugada = new Date('2026-11-07T00:30Z')
    expect(estadoGuardia(g, captura, madrugada, canarias).abierta).toBe(true)
    expect(textoHorarioGuardia(g, captura, madrugada, canarias)).toBe('Turno del viernes hasta las 01:00')
    expect(estadoGuardia(g, captura, new Date('2026-11-07T12:00Z'), canarias).conocida).toBe(false)
  })

  it('una última línea antigua truncada o un viernes sin horas completas sólo sale en todas', () => {
    const antiguo = 'Jueves: Desde las 08:30 hasta las 14:00 y desde las 16:30 hasta las 20:30\r\nViernes: Desde las 08:30 '.slice(0,100)
    expect(antiguo.length).toBe(100)
    const g = farmacia('tenerife', antiguo, '', fecha, false)
    expect(textoHorarioGuardia(g, captura, ahora, canarias)).toMatch(/por confirmar/)
    expect(estadoGuardia(g, captura, ahora, canarias).conocida).toBe(false)
    const sin = farmacia('tenerife', 'Jueves: Desde las 09:00 hasta las 21:00')
    expect(textoHorarioGuardia(sin, captura, ahora, canarias)).not.toContain('09:00')
  })

  it('usa las dos horas de Tenerife antes y después del descanso sin inventar una apertura continua', () => {
    const g = farmacia('tenerife', 'Viernes: Desde las 08:30 hasta las 14:00 y desde las 16:30 hasta las 20:30')
    expect(estadoGuardia(g, captura, ahora, canarias)).toEqual({ conocida: true, abierta: false, todoElDia: false })
    expect(estadoGuardia(g, captura, new Date(fecha+'T16:30Z'), canarias).abierta).toBe(true)
    expect(textoHorarioGuardia(g, captura, ahora, canarias)).toContain('16:30')
  })

  it('Valencia con horas de apertura no acredita toda la jornada como guardia de urgencias', () => {
    const g = farmacia('valencia', '08:30-22:00 (incluye horario de urgencias)', 'Abierta')
    expect(tipoAtencionGuardia(g)).toBe('apertura')
    expect(estadoGuardia(g, captura, ahora).abierta).toBe(true)
    expect(estadoGuardia(g, captura, new Date(fecha+'T21:30Z')).abierta).toBe(false)
    expect(textoHorarioGuardia(g, captura, ahora)).toContain('incluye horario de urgencias')
  })

  it('Almería, Teruel, Palencia, Huesca y las visitas previa llamada no dan falsos positivos', () => {
    const casos = [
      farmacia('almeria', '', 'Horario por confirmar: llama antes de acudir'),
      farmacia('teruel', 'De guardia 24 horas'),
      farmacia('laspalmas', '9:00-9:00'),
      farmacia('palencia', 'Rotación zonal — consultar cofpalencia.org'),
      farmacia('huesca', '', 'FARMACIA DE LA LOCALIDAD EN BARBASTRO'),
      farmacia('asturias', '2026-11-06 09:00-2026-11-07 09:00', 'Guardia localizada'),
      farmacia('otro', '09:00-22:00 salvo festivos'),
    ]
    for (const g of casos) expect(estadoGuardia(g, captura, ahora)).toEqual({ conocida: false, abierta: false, todoElDia: false })
    expect(textoHorarioGuardia(casos[2], captura, ahora)).toContain('Fin del turno por confirmar')
    expect(tipoAtencionGuardia(casos[3])).toBe('sin_confirmar')
    expect(tipoAtencionGuardia(casos[4])).toBe('sin_confirmar')
    expect(tipoAtencionGuardia(casos[5])).toBe('localizada')
    expect(textoHorarioGuardia({...casos[1], fechaTurno: undefined}, captura, ahora)).toMatch(/Horario por confirmar/)
  })

  it('Las Palmas conserva las fechas de los dos extremos y separa la visita presencial de la localizada', () => {
    const guardia = { tipo_guardia: 'presencial', guardia_horario_fecha_inicio: '2026-11-06 09:00:00', guardia_horario_fecha_fin: '2026-11-07 09:00:00' }
    const filas = turnosLasPalmas([guardia, { ...guardia, tipo_guardia: 'localizada' }, { ...guardia, guardia_horario_fecha_fin: guardia.guardia_horario_fecha_inicio }])
    const estados = filas.map(f => estadoGuardia(farmacia('laspalmas', f.horario, f.nota), captura, ahora, canarias))
    expect(estados).toEqual([{ conocida: true, abierta: true, todoElDia: true }, { conocida: false, abierta: false, todoElDia: false }, { conocida: false, abierta: false, todoElDia: false }])
    const slots = '2026-11-06 09:00-2026-11-06 12:00 / 2026-11-06 16:00-2026-11-06 21:00'
    expect(estadoGuardia(farmacia('laspalmas', slots, 'Guardia presencial'), captura, ahora, canarias).abierta).toBe(false)
    expect(estadoGuardia(farmacia('laspalmas', slots, 'Guardia presencial'), captura, new Date(fecha+'T17:00Z'), canarias).abierta).toBe(true)
  })

  it('respeta el cambio de hora y la vigencia de los datos en Canarias', () => {
    const g = farmacia('laspalmas', '2026-10-24 09:00-2026-10-25 09:00')
    expect(estadoGuardia(g, '2026-10-24T06:00Z', new Date('2026-10-25T08:59Z'), canarias).todoElDia).toBe(true)
    expect(estadoGuardia(g, '2026-10-24T06:00Z', new Date('2026-10-25T09:00Z'), canarias).abierta).toBe(false)
    expect(estadoGuardia(g, '2026-10-22T06:00Z', new Date('2026-10-25T08:59Z'), canarias).conocida).toBe(false)
  })
})
