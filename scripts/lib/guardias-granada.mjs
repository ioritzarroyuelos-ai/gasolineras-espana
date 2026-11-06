// Extrae sólo las secciones que el propio PDF fecha y empareja cada teléfono
// con la dirección de su misma fila, incluso si dos filas comparten una línea.
const MESES = 'ENERO FEBRERO MARZO ABRIL MAYO JUNIO JULIO AGOSTO SEPTIEMBRE OCTUBRE NOVIEMBRE DICIEMBRE'.split(' ')
const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO']
const normaliza = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
const tiempo = (h, m) => h.padStart(2, '0') + ':' + m

function diaAplicable(linea, fecha, mesDocumento) {
  const d = new Date(fecha + 'T12:00:00Z')
  const dia = d.getUTCDay(), numero = d.getUTCDate(), mes = MESES[d.getUTCMonth()], anio = String(d.getUTCFullYear())
  const semanal = /^DE LUNES A VIERNES MES DE ([A-Z]+) (\d{4})$/.exec(linea)
  if (semanal) return { coincide: dia >= 1 && dia <= 5 && mes === semanal[1] && anio === semanal[2], mes: semanal[1] }
  const m = /^(?:SOLO )?([A-Z]+) (\d{1,2})(?: Y ([A-Z]+) (\d{1,2}))? (?:DE )?([A-Z]+) (\d{4})$/.exec(linea)
  if (!m || !DIAS.includes(m[1]) || (m[3] && !DIAS.includes(m[3]))) return { coincide: false, mes: '' }
  // El colegio a veces imprime «SOLO DOMINGO 8 DE MES 2026». Únicamente
  // resolvemos MES dentro de una cabecera anterior de ese mismo documento.
  const mesFila = m[5] === 'MES' ? mesDocumento : m[5]
  return { coincide: anio === m[6] && mes === mesFila && ((DIAS[dia] === m[1] && numero === +m[2]) || (DIAS[dia] === m[3] && numero === +m[4])), mes: mesFila }
}

function direccionFila(lineas) {
  // Notas entre paréntesis pueden continuar del renglón anterior. Dos
  // direcciones candidatas antes de un teléfono vuelven ambigua la pareja.
  const direcciones = lineas.join('\n').replace(/\([^()]*\)/gs, '').split('\n')
    .map(l => l.trim().replace(/[.,]+$/, '')).filter(Boolean)
  if (!direcciones.length || /[()]/.test(direcciones.join(''))) return null
  if (direcciones.slice(1).some(l => !/^(?:LOCAL\s+\d|CARREFOUR\.\s+LOCAL\s+\d)/i.test(l))) return null
  const valor = direcciones.join(' ')
  return /^\p{Lu}[\s\S]{4,}$/u.test(valor) && !/TLF|SERVICIO DE URGENCIA|EN HOJA APARTE/i.test(valor) ? valor : null
}

export function parseTurnosGranada(texto, fecha) {
  const d = new Date(fecha + 'T12:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== fecha) return []
  const lineas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (const l of lineas.map(normaliza).filter(l => l.includes('HOJA APARTE'))) {
    const m = /^\(([A-Z]+) (\d{1,2}) DE ([A-Z]+) EN HOJA APARTE\)$/.exec(l)
    if (!m || (+m[2] === d.getUTCDate() && m[3] === MESES[d.getUTCMonth()])) return []
  }
  let seccion = '', mes = '', base = false, aplica = false
  const filas = new Map()
  let pendientes = []
  for (const linea of lineas) {
    const l = normaliza(linea)
    if (/^SERVICIO DE URGENCIA/.test(l)) {
      const h = /^SERVICIO DE URGENCIA (?:DIURNO|NOCTURNO): DE (\d{1,2})[,:](\d{2}) H\. A (\d{1,2})[,:](\d{2}) H\.( DEL DIA SIGUIENTE)?$/.exec(l)
      seccion = ''
      if (h) {
        const a = tiempo(h[1], h[2]), b = tiempo(h[3], h[4])
        if ([a,b].every(t => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)) && (a < b ? !h[5] : a > b && !!h[5])) seccion = a + '-' + b
      }
      aplica = base
      pendientes = []
      continue
    }
    if (/^(?:SOLO\b|DE (?:LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO)|LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO|FESTIVO)/.test(l)) {
      const cab = diaAplicable(l, fecha, mes)
      if (/^SOLO\b/.test(l)) aplica = base && cab.coincide
      else { base = aplica = cab.coincide; mes = cab.mes }
      pendientes = []
      continue
    }
    if (!seccion || !aplica || /^-+/.test(l) || l.includes('HOJA APARTE')) { pendientes = []; continue }
    if (!/\bTLF\b/i.test(linea)) { pendientes.push(linea); continue }
    const tel = /\bTLF\.?\s*:?\s*((?:\d[ \t]*){8}\d)(?![ \t]*\d)/gi
    let anterior = 0
    for (const m of linea.matchAll(tel)) {
      pendientes.push(linea.slice(anterior, m.index))
      const direccion = direccionFila(pendientes), telefono = m[1].replace(/\s/g, '')
      if (direccion && /^[689]\d{8}$/.test(telefono)) {
        const k = normaliza(direccion) + '|' + telefono
        const existente = filas.get(k)
        if (existente) existente.horas.add(seccion)
        else filas.set(k, { direccion, telefono, horas: new Set([seccion]) })
      }
      anterior = m.index + m[0].length
      pendientes = []
    }
    pendientes = anterior ? [linea.slice(anterior).trim()].filter(Boolean) : []
  }
  return [...filas.values()].map(({ direccion, telefono, horas }) => ({ direccion, telefono, horario: [...horas].join(', ') }))
}
