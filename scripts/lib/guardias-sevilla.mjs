const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const dias = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
const normal = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const iso = (d,m,a) => meses.includes(m.toLowerCase()) ? [a, String(meses.indexOf(m.toLowerCase()) + 1).padStart(2,'0'), d.padStart(2,'0')].join('-') : ''
const dateParts = fecha => {
  const date = new Date(fecha + 'T12:00:00Z')
  return { dia: date.getUTCDate(), semana: dias[date.getUTCDay()], mes: meses[date.getUTCMonth()], ano: date.getUTCFullYear() }
}

function farmacia(municipio, direccion, horario) {
  if (!direccion || /^(?:servicios? locali[sz]ables?|ver (?:zona|municipio)|consultar|sin servicio)/i.test(direccion)) return null
  const numero = direccion.match(/(?:\(|\bT(?:el[eé]fono|lfno)?[.:\s]+)([679]\d{2}[\s-]*\d{3}[\s-]*\d{3})(?!\d)/i)
  const localizada = /\blocaliza(?:da|ble)/i.test(direccion)
  const limitado = direccion.match(/\b(?:de|desde)\s+(\d{1,2}:\d{2})\s+(?:a|hasta)\s+(\d{1,2}:\d{2})/i)
  if (limitado) horario = limitado[1] + '–' + limitado[2]
  const tel = numero?.[1].replace(/\D/g,'') || ''
  return [0,0,direccion,municipio,tel,'',horario,localizada ? 'Guardia localizada' : '']
}

export function guardiasCapitalSevilla(paginas, fecha) {
  const { semana } = dateParts(fecha)
  for (const pagina of paginas) {
    const cabecera = pagina.filter(p => p.y < .16).map(p => p.texto).join(' ')
    const m = cabecera.match(/SEMANA DEL\s+(\d{1,2})\s+(?:DE\s+)?(\w+)\s+(?:DE\s+)?(\d{4})\s+AL\s+(\d{1,2})\s+(?:DE\s+)?(\w+)\s+(?:DE\s+)?(\d{4})/i)
    if (!m || fecha < iso(m[1],m[2],m[3]) || fecha > iso(m[4],m[5],m[6])) continue
    const noche = pagina.find(p => /^URGENCIA DE NOCHE/i.test(p.texto))
    const domingo = pagina.find(p => p.texto === 'DOMINGO')
    const dia = pagina.find(p => /^URGENCIA DE D[IÍ]A/i.test(p.texto))
    if (!noche || !domingo || !dia || !/LUNES A S[ÁA]BADO/i.test(cabecera)) return []
    const turnos = []
    for (const nocturna of [false,true]) {
      const titulo = nocturna ? noche : dia
      const horas = titulo.texto.match(/(\d{1,2}:\d\d)\s+a\s+(\d{1,2}:\d\d)/i)
      if (!horas) continue
      const esDomingo = semana === 'domingo'
      const parte = pagina.filter(p => {
        if (p.y <= titulo.y + .001) return false
        const columnaDominical = p.x >= .73
        if (nocturna) return !columnaDominical
        return columnaDominical === esDomingo && (esDomingo || p.y < noche.y - .007)
      })
      const inicios = [...new Set(parte.filter(p => p.texto === '»').map(p => Math.round(p.x * 100) / 100))].sort((a,b) => a-b)
      if (inicios.length !== (nocturna ? 2 : esDomingo ? 1 : 3)) continue
      for (let i = 0; i < inicios.length; i++) {
        const columna = parte.filter(p => p.x >= inicios[i]-.009 && p.x < (inicios[i+1] || 2)-.009)
        // El orden de dibujo del PDF separa algunos títulos de sus filas.
        columna.sort((a,b) => Math.round(a.y*500)-Math.round(b.y*500) || a.x-b.x)
        const listado = columna.map(p => /^ZONA\b/.test(p.texto) ? ' § ' : p.texto).join(' ')
        for (let dir of listado.split('»').slice(1)) {
          dir = dir.split('§')[0].trim()
          const r = dir.match(/\b(S[oó]lo|Excepto)\s+((?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?:\s+y\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo))*)\b/i)
          if (r && ((normal(r[1]) === 'solo') !== normal(r[2]).split(/\s+y\s+/).includes(normal(semana)))) continue
          if (r) dir = dir.replace(r[0],'').replace(/^[ .]+/,'').replace(/\.\s+\./g,'.').trim()
          if (/\b(?:excepto|solo|festiv\w*|lun(?:es)? a|martes a|sábados? y)\b/i.test(dir)) continue
          if (!dir || !/\d/.test(dir)) continue
          turnos.push(farmacia(/\bMontequinto\b/i.test(dir) ? 'Dos Hermanas' : 'Sevilla', dir, horas[1]+'–'+horas[2]))
        }
      }
    }
    return turnos.filter(Boolean)
  }
  return []
}

export function guardiasMunicipioSevilla(paginas, fecha, municipio) {
  const { dia, semana } = dateParts(fecha)
  for (const pg of paginas) {
    const cabecera = pg.map(p => p.texto).join(' ').match(/desde (\d{1,2})-(\w{3})-(\d{4}) hasta el (\d{1,2})-(\w{3})-(\d{4})/i)
    if (!cabecera || !normal(pg.map(p => p.texto).join(' ')).includes('farmacias de guardia de ' + normal(municipio))) continue
    const fechaCorta = (d,m,a) => iso(d, meses.find(mes => mes.startsWith(m.toLowerCase())) || '', a)
    if (fecha < fechaCorta(...cabecera.slice(1,4)) || fecha > fechaCorta(...cabecera.slice(4,7))) continue
    const inicio = pg.find(p => normal(p.texto) === normal(semana + ' ' + dia))
    if (!inicio) continue
    const fin = Math.min(1,...pg.filter(p => p.y > inicio.y && /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo) \d{1,2}$/i.test(p.texto)).map(p => p.y))
    const turno = []
    let horario = '', direccion = ''
    const cerrarFila = () => {
      if (horario && direccion) turno.push(farmacia(municipio,direccion.trim(),horario))
      direccion = ''
    }
    for (const p of pg.filter(p => p.y > inicio.y && p.y < fin && p.x > .065)) {
      if (/^(Día|Noche) \(de /i.test(p.texto)) { cerrarFila(); horario = p.texto }
      else if (p.texto.startsWith('Ŀ')) { cerrarFila(); direccion = p.texto.slice(1).replace(/[\x00-\x1f]/g,'').trim() }
      else if (horario) direccion += ' ' + p.texto
    }
    cerrarFila()
    return turno.filter(Boolean)
  }
  return []
}

export function guardiasZonaSevilla(paginas, fecha) {
  const { dia, semana, mes, ano } = dateParts(fecha)
  const titulo = new RegExp('^'+semana+' 0?'+dia+' '+mes+' '+ano+'$','i')
  for (const pagina of paginas) {
    const cabecera = pagina.find(p => titulo.test(p.texto))
    if (!cabecera) continue
    const horarios = pagina.filter(p => /^(?:Día|Noche) \(de /i.test(p.texto))
    const col = horarios.filter(p => p.x < cabecera.x && cabecera.x - p.x < .18).sort((a,b) => a.y-b.y)
    if (!col.length) continue
    const x = col[0].x
    const lineas = new Map()
    for (const p of pagina.filter(p => p.x >= x-.005 && p.x < x+.235 && p.y > cabecera.y && p.y < .92)) {
      const y = Math.round(p.y*1000)
      if (!lineas.has(y)) lineas.set(y,[])
      lineas.get(y).push(p)
    }
    const filas = []
    let horario = '', anterior = null
    for (const [,linea] of [...lineas].sort((a,b)=>a[0]-b[0])) {
      const etiqueta = linea.find(p => /^(?:Día|Noche) \(de /i.test(p.texto))
      if (etiqueta) { horario = etiqueta.texto; anterior = null; continue }
      if (!horario) continue
      const municipio = linea.filter(p => p.x < x+.07).map(p=>p.texto).join(' ')
      const dir = linea.filter(p => p.x >= x+.07).map(p=>p.texto).join(' ')
      if (municipio && dir) { anterior = { municipio, dir, horario }; filas.push(anterior) }
      else if (anterior) { if (dir) anterior.dir += ' '+dir; if (municipio) anterior.municipio += ' '+municipio }
    }
    return filas.map(f => farmacia(f.municipio,f.dir,f.horario)).filter(Boolean)
  }
  return []
}
