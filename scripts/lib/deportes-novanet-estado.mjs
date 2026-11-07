const fecha = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null
const codigo = v => /^\d+$/.test(String(v)) ? String(v) : null
const texto = v => typeof v === 'string' ? v.trim().slice(0, 500) : ''
const ultimo = valores => valores.filter(Boolean).sort().at(-1) || null
const uneVerificados = (anterior, actual) => Object.fromEntries([...new Set([...Object.keys(anterior), ...Object.keys(actual)])].map(id => [id, ultimo([anterior[id], actual[id]])]))
const rutaGes = v => typeof v === 'string' && v.length <= 1000 && /^\/(?!\/)/.test(v) && !/[\\\u0000-\u001f]/.test(v)

/** Manual input carries only portal IDs and pauses, never catalogue or session data. */
export function parseaPausasPortales(valor = '') {
  if (valor === '') return {}
  if (typeof valor !== 'string' || valor.length > 20000) throw Error('Las pausas de portales deben ser un objeto JSON de identificadores y fechas ISO con zona horaria')
  if (!valor.trim()) return {}
  let datos
  try { datos = JSON.parse(valor) } catch { throw Error('Las pausas de portales no contienen un objeto JSON válido') }
  if (!datos || Array.isArray(datos) || typeof datos !== 'object' || Object.keys(datos).length > 100) throw Error('Las pausas de portales deben ser un objeto JSON con un máximo de 100 portales')
  return Object.fromEntries(Object.entries(datos).map(([id, hasta]) => {
    if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(id)) throw Error('Identificador de portal no válido en las pausas')
    const formato = typeof hasta === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(hasta)
    const valida = formato && Number.isFinite(Date.parse(hasta)) && Number.isFinite(Date.parse(hasta.slice(0, 10))) && new Date(hasta.slice(0, 10)).toISOString().slice(0, 10) === hasta.slice(0, 10)
    if (!valida) throw Error(`La pausa de ${id} debe ser una fecha ISO válida con zona horaria`)
    return [id, new Date(hasta).toISOString()]
  }))
}

function descubrimientoGes(valor) {
  if (!valor || !fecha(valor.iniciadoEn) || typeof valor.fuenteUrl !== 'string' || valor.fuenteUrl.length > 2048) return null
  try { const u = new URL(valor.fuenteUrl); if (u.protocol !== 'https:' || u.username || u.password) return null } catch { return null }
  if (!Array.isArray(valor.pendientes) || valor.pendientes.length > 10000 || !Array.isArray(valor.categorias) || valor.categorias.length > 10000) return null
  const pendientes = valor.pendientes.filter(p => p && ['raiz', 'competicion'].includes(p.tipo) && rutaGes(p.ruta) &&
    (!p.delegacion || codigo(p.delegacion)) && (!p.competicion || codigo(p.competicion))).map(p => ({ tipo: p.tipo, ruta: p.ruta,
    ...(p.delegacion ? { delegacion: String(p.delegacion) } : {}), ...(p.competicion ? { competicion: String(p.competicion) } : {}) }))
  const categorias = valor.categorias.filter(c => c && codigo(c.codigo) && texto(c.nombre) && texto(c.familia)).map(c => ({ codigo: String(c.codigo), nombre: texto(c.nombre), familia: texto(c.familia),
    grupos: Array.isArray(c.grupos) ? c.grupos.filter(g => g && codigo(g.codigo) && texto(g.nombre)).map(g => ({ codigo: String(g.codigo), nombre: texto(g.nombre) })) : null }))
  if (pendientes.length !== valor.pendientes.length || categorias.length !== valor.categorias.length ||
    new Set(pendientes.map(p => JSON.stringify(p))).size !== pendientes.length || new Set(categorias.map(c => c.codigo)).size !== categorias.length ||
    categorias.some((c, i) => c.grupos && (c.grupos.length !== valor.categorias[i].grupos.length || new Set(c.grupos.map(g => g.codigo)).size !== c.grupos.length))) return null
  const t = valor.temporada, temporada = t && codigo(t.codigo) && /^20\d{2}-20\d{2}$/.test(t.nombre) ? { codigo: String(t.codigo), nombre: t.nombre } : null
  if (t && !temporada) return null
  const categoria = Number.isSafeInteger(valor.categoria) && valor.categoria >= 0 && valor.categoria < categorias.length ? valor.categoria : 0
  const grupos = categorias[categoria]?.grupos
  const grupo = Number.isSafeInteger(valor.grupo) && valor.grupo >= 0 && grupos && valor.grupo < grupos.length ? valor.grupo : 0
  return { fuenteUrl: valor.fuenteUrl, iniciadoEn: fecha(valor.iniciadoEn), temporada, pendientes, categorias, categoria, grupo }
}

/** Only catalogue/progress metadata crosses runs; anonymous cookies remain in memory. */
export function normalizaEstadoNovanet(valor) {
  const estado = { version: 1, catalogo: null, categoria: 0, grupo: 0, ultimoExito: null, noConsultarAntes: null, ventana: { desde: null, peticiones: 0 }, verificados: {}, completos: {} }
  if (!valor || valor.version !== 1) return estado
  estado.noConsultarAntes = fecha(valor.noConsultarAntes)
  estado.ultimoExito = fecha(valor.ultimoExito)
  const parcial = descubrimientoGes(valor.descubrimientoGes)
  if (parcial) estado.descubrimientoGes = parcial
  if (fecha(valor.ventana?.desde) && Number.isSafeInteger(valor.ventana.peticiones) && valor.ventana.peticiones >= 0) estado.ventana = { desde: fecha(valor.ventana.desde), peticiones: valor.ventana.peticiones }
  // Algunos catálogos públicos no identifican temporada: guardan solo un cursor acotado por su lector.
  if (Number.isSafeInteger(valor.grupo) && valor.grupo >= 0) estado.grupo = valor.grupo
  for (const [id, verificado] of Object.entries(valor.verificados || {})) if (/^\d+$/.test(id) && fecha(verificado)) estado.verificados[id] = fecha(verificado)
  const c = valor.catalogo
  if (codigo(c?.temporada?.codigo) && /^20\d{2}-20\d{2}$/.test(c.temporada.nombre) && fecha(c.verificadoEn) && Array.isArray(c.categorias) && c.categorias.length) {
    const categorias = c.categorias.filter(x => x && codigo(x.codigo) && texto(x.nombre)).map(x => ({ codigo: String(x.codigo), nombre: texto(x.nombre), familia: texto(x.familia), grupos: Array.isArray(x.grupos) ? x.grupos.filter(g => g && codigo(g.codigo) && texto(g.nombre)).map(g => ({ codigo: String(g.codigo), nombre: texto(g.nombre) })) : null,
      ...(x.gruposPendientes === true && Array.isArray(x.grupos) ? { gruposPendientes: true } : {}) }))
    const validos = categorias.length === c.categorias.length && new Set(categorias.map(x => x.codigo)).size === categorias.length && categorias.every((x, i) => !x.grupos || x.grupos.length === c.categorias[i].grupos.length && new Set(x.grupos.map(g => g.codigo)).size === x.grupos.length)
    if (validos) {
      estado.catalogo = { temporada: { codigo: String(c.temporada.codigo), nombre: c.temporada.nombre }, verificadoEn: fecha(c.verificadoEn), categorias }
      if (Number.isSafeInteger(valor.categoria) && valor.categoria >= 0 && valor.categoria < categorias.length) estado.categoria = valor.categoria
      estado.grupo = 0
      const grupos = categorias[estado.categoria].grupos
      if (Number.isSafeInteger(valor.grupo) && valor.grupo >= 0 && grupos && valor.grupo < grupos.length) estado.grupo = valor.grupo
    }
  }
  if (estado.catalogo || estado.descubrimientoGes) {
    for (const [id, verificado] of Object.entries(valor.verificados || {})) if (/^\d+-\d+$/.test(id) && fecha(verificado)) estado.verificados[id] = fecha(verificado)
    for (const [id, verificado] of Object.entries(valor.completos || {})) if (/^\d+-\d+$/.test(id) && fecha(verificado)) estado.completos[id] = fecha(verificado)
  }
  return estado
}

export function recuperaEstadoNovanet(candidatos) {
  const copias = candidatos.filter(v => v && v.version === 1).map(v => ({ estado: normalizaEstadoNovanet(v), guardado: fecha(v.guardadoEn) || ultimo([fecha(v.ultimoExito), fecha(v.ventana?.desde), fecha(v.catalogo?.verificadoEn)]) || '' })).sort((a, b) => a.guardado.localeCompare(b.guardado) || a.estado.ventana.peticiones - b.estado.ventana.peticiones)
  const estado = copias.at(-1)?.estado || normalizaEstadoNovanet(null)
  if (!estado.catalogo) {
    const ultimoCatalogo = [...copias].reverse().find(c => c.estado.catalogo || c.estado.descubrimientoGes)?.estado
    const antigua = [...copias].reverse().find(c => c.estado.catalogo)?.estado
    if (antigua) {
      for (const k of ['catalogo', 'categoria', 'grupo']) estado[k] = antigua[k]
      for (const k of ['verificados', 'completos']) estado[k] = uneVerificados(antigua[k], estado[k])
      estado.ultimoExito = ultimo([antigua.ultimoExito, estado.ultimoExito])
    }
    if (!estado.descubrimientoGes) {
      // No recuperar un recorrido antiguo que una copia más reciente ya terminó.
      const parcial = ultimoCatalogo?.descubrimientoGes
      if (parcial) {
        estado.descubrimientoGes = parcial
        for (const k of ['verificados', 'completos']) estado[k] = uneVerificados(ultimoCatalogo[k], estado[k])
        estado.ultimoExito = ultimo([ultimoCatalogo.ultimoExito, estado.ultimoExito])
      }
    }
  }
  estado.noConsultarAntes = ultimo(copias.map(c => c.estado.noConsultarAntes))
  const ventanas = copias.map(c => c.estado.ventana).filter(v => v.desde).sort((a, b) => a.desde.localeCompare(b.desde))
  const reciente = ventanas.at(-1)
  if (reciente) estado.ventana = { desde: reciente.desde, peticiones: Math.max(...ventanas.filter(v => v.desde === reciente.desde).map(v => v.peticiones)) }
  return normalizaEstadoNovanet(estado)
}

export function checkpointNovanet(estado, ahora = Date.now()) {
  return { ...normalizaEstadoNovanet(estado), guardadoEn: new Date(ahora).toISOString() }
}
