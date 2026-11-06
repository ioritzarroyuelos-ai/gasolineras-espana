import { desplazaFecha, texto } from './guardias-fetch.mjs'

export function turnosCadiz(horarios, fecha) {
  const turnos = []
  for (const h of Array.isArray(horarios) ? horarios : []) {
    const desde = /^((?:[01]\d|2[0-3]):[0-5]\d)(?::00)?$/.exec(h.hora_apertura)?.[1]
    const hasta = /^((?:[01]\d|2[0-3]):[0-5]\d)(?::00)?$/.exec(h.hora_cierre)?.[1]
    const valida = desde && hasta && (h.cierre_dia_siguiente === true || (h.cierre_dia_siguiente === false && hasta > desde))
    const intervalo = valida ? fecha + ' ' + desde + '-' + (h.cierre_dia_siguiente ? desplazaFecha(fecha,1) : fecha) + ' ' + hasta : ''
    const nota = texto(h.tipo)
    const mixta = /^DIURNO\s*\(De (\d{1,2})(?:[,:](\d{2}))? a (\d{1,2})(?:[,:](\d{2}))?\s*h\)\s*\/\s*NOCTURNO\s*:\s*LOCALIZADA$/i.exec(nota)
    if (mixta) {
      const hora = (h, m) => h.padStart(2, '0') + ':' + (m || '00')
      const coincide = desde === hora(mixta[1],mixta[2]) && hasta === hora(mixta[3],mixta[4]) && h.cierre_dia_siguiente === false
      turnos.push({ horario: coincide ? intervalo : '', nota: 'Guardia diurna' })
      turnos.push({ horario: '', nota: 'Guardia nocturna localizada. Llama antes de acudir. Hora de fin por confirmar.' })
    } else {
      turnos.push({ horario: intervalo, nota })
    }
  }
  return turnos.length ? turnos : [{ horario:'', nota:'Horario por confirmar' }]
}
