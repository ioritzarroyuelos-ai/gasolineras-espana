import { desplazaFecha } from './guardias-fetch.mjs'

export function turnoTarragona(tramo, notas) {
  const fecha = tramo.slice(0,10)
  const instrucciones = notas.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()
  // La ficha de Flix precisa cuándo empieza y termina el turno de fin de semana.
  if (/la guardia comenca dissabte a les 14 h\.? i acabara dilluns a les 9 h/.test(instrucciones)) {
    const semana = new Date(fecha+'T12:00Z').getUTCDay()
    const diasHastaSabado = semana===6 ? 0 : semana===0 ? -1 : semana===1 ? -2 : 6-semana
    const sabado = desplazaFecha(fecha,diasHastaSabado)
    const inicio = [tramo.slice(0,16),sabado+' 14:00'].sort()[1]
    const fin = [tramo.slice(17),desplazaFecha(sabado,2)+' 09:00'].sort()[0]
    if (inicio>=fin) return {omitido:true}
    return {horario:inicio+'-'+fin, nota:'El colegio señala guardia desde el sábado a las 14:00 hasta el lunes a las 09:00.'}
  }
  // Una oficina puede atender físicamente parte del turno y por teléfono el resto.
  // Las excepciones de festivos y de temporada impiden inferir las horas de cada modalidad.
  if (/fora (?:de l.horari|d.aquests horaris)|obertura fisica|tarda:\s*guardia localitzada|de les 12 de la nit a les 6 del mati trucar/.test(instrucciones)) {
    return {horario:'', nota:'La modalidad de atención depende del horario. '+notas, conservarFranja:true}
  }
  if (/canvis de guardia|guardia comenca|guard(?:ia|ies) nocturn(?:a|es)\s+[a-z]|guardies a /.test(instrucciones))
    return {horario:'Turno por confirmar', nota:'El colegio indica condiciones especiales. '+notas}
  const localizada = /localitz(?:ad|abl)|no presencial|porta tancada/.test(instrucciones)
  return {horario:tramo, nota:localizada?'Guardia localizada: llama antes de acudir':''}
}
