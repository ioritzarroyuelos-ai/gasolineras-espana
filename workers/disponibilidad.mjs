import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers'
import { DISPONIBILIDAD_CONSENTIMIENTO, DISPONIBILIDAD_INTERVALO, DISPONIBILIDAD_VENTANA, DISPONIBILIDAD_DIARIO_ESPERA, DISPONIBILIDAD_CAMBIOS_DIA, DISPONIBILIDAD_RETENCION,
  disponibilidadSolicitud, disponibilidadMadrid, disponibilidadProximoDiario, disponibilidadClaveEvento, disponibilidadCifraVigente, disponibilidadSeudonimo } from '../scripts/lib/disponibilidad.mjs'
import { cargaDisponibilidad } from '../scripts/lib/disponibilidad-fuentes.mjs'
import { gatewayDigest, gatewayValidaSolicitud, gatewayEnviar, gatewayChallenge as pruebaGateway } from '../scripts/lib/disponibilidad-gateway.mjs'

const modes = ['diario', 'temporal']
const answer = (status, data) => ({ status, ...data })
const failure = (error, status = 503) => answer(status, { ok: false, error })
const keyReady = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const versionReady = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const gatewayFields = ['chat', 'modo', 'avisoId', 'version', 'event', 'attempt', 'workerVersion', 'nonce', 'issuedAt', 'expiresAt', 'digest']
const claimValid = value => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === gatewayFields.length && Object.keys(value).every(key => gatewayFields.includes(key)) &&
  Number.isSafeInteger(value.chat) && value.chat > 0 && modes.includes(value.modo) && typeof value.event === 'string' && value.event.length <= 50 && typeof value.digest === 'string' && /^[a-f0-9]{64}$/.test(value.digest)

/** Un objeto por chat: consentimiento, baja y reserva se coordinan juntos.
 * No utiliza KV como cerrojo ni mantiene un bloqueo durante las descargas. */
export class DisponibilidadUsuario extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS estado (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)')
    })
  }
  now() { return Date.now() }
  source(item) { return cargaDisponibilidad(item) }
  send(body) { return gatewayEnviar(this.env.DISPONIBILIDAD_GATEWAY_KEY, body) }
  #read(key) { const row = this.ctx.storage.sql.exec('SELECT valor FROM estado WHERE clave = ?', key).toArray()[0]; return row ? JSON.parse(row.valor) : null }
  #put(key, value) { this.ctx.storage.sql.exec('INSERT INTO estado (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', key, JSON.stringify(value)) }
  #delete(key) { this.ctx.storage.sql.exec('DELETE FROM estado WHERE clave = ?', key) }
  #configured() { return this.env.DISPONIBILIDAD_ENABLED === 'true' && keyReady(this.env.DISPONIBILIDAD_GATEWAY_KEY) && versionReady(this.env.WORKER_VERSION?.id) }
  #meta(chat, create = true) {
    if (!Number.isSafeInteger(chat) || chat <= 0) throw Error('invalid_chat')
    let meta = this.#read('meta')
    if (meta && meta.chat !== chat) throw Error('different_chat')
    if (!meta && create) { meta = { chat, version: crypto.randomUUID(), cambiado: this.now(), dia: '', cambios: 0 }; this.#put('meta', meta) }
    return meta
  }
  #snapshot(meta) {
    const now = this.now()
    return answer(200, { ok: true, version: meta?.version ?? null, avisos: modes.map(mode => this.#read('aviso:' + mode)).filter(Boolean).map(item => ({
      modo: item.modo, id: item.id, fuente: item.fuente, lugarId: item.lugarId, objetivo: item.objetivo, nombre: item.nombre, enlace: item.enlace,
      hora: item.hora ?? null, zona: 'Europe/Madrid', activo: item.activo && (item.modo !== 'temporal' || now < item.hasta),
      creado: new Date(item.creado).toISOString(), hasta: item.modo === 'temporal' ? new Date(item.hasta).toISOString() : null,
      proxima: item.activo && item.proxima !== null && (item.modo !== 'temporal' || now < item.hasta) ? new Date(item.proxima).toISOString() : null,
      estado: item.modo === 'temporal' && item.activo && now >= item.hasta ? 'vencido' : item.estado,
      ultimaComprobacion: item.ultimaComprobacion ? new Date(item.ultimaComprobacion).toISOString() : null,
      consentimiento: DISPONIBILIDAD_CONSENTIMIENTO,
    })) })
  }
  async #schedule(paused = false) {
    this.#prune()
    const now = this.now(), meta = this.#read('meta'), items = modes.map(mode => this.#read('aviso:' + mode)).filter(Boolean)
    const pending = items.filter(item => item.activo).map(item => paused ? now + 15 * 60000 : Math.max(now + 1000, item.proxima))
    // Una última alarma elimina datos de avisos terminados y recibos caducados.
    const cleanup = meta ? meta.cambiado + DISPONIBILIDAD_RETENCION : null
    if (!pending.length && cleanup && cleanup <= now) {
      this.ctx.storage.sql.exec('DELETE FROM estado'); await this.ctx.storage.deleteAlarm(); return
    }
    const expired = this.ctx.storage.sql.exec("SELECT MIN(json_extract(valor, '$.caduca')) AS proxima FROM estado WHERE clave LIKE 'recibo:%'").one().proxima
    const terminated = items.filter(item => !item.activo).map(item => (item.terminado ?? item.creado) + DISPONIBILIDAD_RETENCION)
    if (pending.length || cleanup) await this.ctx.storage.setAlarm(Math.min(...pending, ...terminated, expired > now ? expired : Infinity, cleanup > now ? cleanup : Infinity))
    else await this.ctx.storage.deleteAlarm()
  }
  #prune() {
    this.ctx.storage.sql.exec("DELETE FROM estado WHERE clave LIKE 'recibo:%' AND json_extract(valor, '$.caduca') <= ?", this.now())
    this.ctx.storage.sql.exec("DELETE FROM estado WHERE clave LIKE 'aviso:%' AND json_extract(valor, '$.activo') = 0 AND COALESCE(json_extract(valor, '$.terminado'), json_extract(valor, '$.creado')) <= ?", this.now() - DISPONIBILIDAD_RETENCION)
  }
  async leer(chat) {
    this.#meta(chat); await this.#schedule()
    // La limpieza puede haber borrado la revisión que acabamos de consultar.
    // Crear/programar la vigente y releer tras los awaits evita devolver una
    // versión obsoleta o ignorar un cambio concurrente del mismo chat.
    if (!this.#meta(chat, false)) { this.#meta(chat); await this.#schedule() }
    return this.#snapshot(this.#meta(chat, false))
  }
  async guardar(chat, modo, input) {
    if (!this.#configured()) return failure('availability_disabled')
    if (!disponibilidadSolicitud(input, modo)) return failure('invalid_subscription', 400)
    const initial = this.#meta(chat), old = this.#read('aviso:' + modo)
    const identity = JSON.stringify([modo, input.fuente, input.lugarId, input.objetivo, input.hora ?? null])
    if (old?.peticion === input.peticion) return old.identidad === identity ? this.#snapshot(initial) : failure('changed_request', 409)
    if (initial.version !== input.version) return failure('changed_subscription', 409)
    const date = disponibilidadMadrid(this.now()).fecha
    if (initial.dia === date && initial.cambios >= DISPONIBILIDAD_CAMBIOS_DIA) return failure('change_limit', 429)
    let place
    try { place = await this.source(input) } catch { return failure('source_unavailable') }
    if (!place || place.id !== input.lugarId || place.fuente !== input.fuente || place.objetivo !== input.objetivo) return failure('source_unavailable')
    let changed = false
    this.ctx.storage.transactionSync(() => {
      const meta = this.#meta(chat)
      if (meta.version !== input.version) return
      const now = this.now(), today = disponibilidadMadrid(now).fecha
      if (meta.dia === today && meta.cambios >= DISPONIBILIDAD_CAMBIOS_DIA) return
      const day = disponibilidadMadrid(now).fecha, receipt = this.#read('recibo:diario:' + day)
      const alreadyAttempted = receipt && ['intento', 'enviado', 'incierto'].includes(receipt.estado)
      const proxima = modo === 'temporal' ? now + 1000 : disponibilidadProximoDiario(input.hora, now, alreadyAttempted ? day : '')
      const item = { modo, id: crypto.randomUUID(), fuente: input.fuente, lugarId: input.lugarId, objetivo: input.objetivo,
        nombre: place.nombre, enlace: place.enlace, hora: input.hora, peticion: input.peticion, identidad: identity, consentimiento: DISPONIBILIDAD_CONSENTIMIENTO,
        creado: now, hasta: modo === 'temporal' ? now + DISPONIBILIDAD_VENTANA : null, proxima, activo: true, estado: 'programado', comprobaciones: 0, ultimaComprobacion: null }
      this.#put('aviso:' + modo, item)
      this.#put('meta', { ...meta, version: crypto.randomUUID(), cambiado: now, dia: today, cambios: (meta.dia === today ? meta.cambios : 0) + 1 })
      this.#prune(); changed = true
    })
    if (!changed) return failure('changed_subscription', 409)
    await this.#schedule()
    return this.#snapshot(this.#meta(chat))
  }
  async cancelar(chat, modo = null) {
    if (modo !== null && !modes.includes(modo)) return failure('invalid_mode', 400)
    const meta = this.#meta(chat)
    this.ctx.storage.transactionSync(() => {
      for (const mode of modo === null ? modes : [modo]) this.#delete('aviso:' + mode)
      this.#put('meta', { ...meta, version: crypto.randomUUID(), cambiado: this.now() })
      // Los recibos mínimos se mantienen: una baja/reactivación no repite
      // un resumen ya enviado hoy ni una petición que quedó en vuelo.
    })
    await this.#schedule(); return this.#snapshot(this.#meta(chat))
  }
  async comprobar(chat) {
    const meta = this.#meta(chat, false); let revisados = 0, vigentes = 0, disponibles = 0, errores = 0
    if (meta) for (const mode of modes) {
      const item = this.#read('aviso:' + mode)
      if (!item?.activo || mode === 'temporal' && this.now() >= item.hasta) continue
      revisados++
      try { const point = await this.source(item); if (disponibilidadCifraVigente(point, this.now())) { vigentes++; if (point.cantidad > 0) disponibles++ } } catch { errores++ }
    }
    return answer(200, { ok: true, dryRun: true, revisados, vigentes, disponibles, errores, enviados: 0 })
  }
  claimGateway(input) {
    if (!this.#configured() || !claimValid(input)) return false
    return this.ctx.storage.transactionSync(() => {
      const now = this.now(), meta = this.#meta(input.chat, false), item = this.#read('aviso:' + input.modo), receipt = this.#read('recibo:' + input.event)
      if (!meta || !item?.activo || item.id !== input.avisoId || item.id !== input.version || item.consentimiento !== DISPONIBILIDAD_CONSENTIMIENTO ||
        input.workerVersion !== this.env.WORKER_VERSION.id || receipt?.estado !== 'intento' || receipt.claimed || !receipt.gateway ||
        gatewayFields.some(key => receipt.gateway[key] !== input[key]) || now >= input.expiresAt || input.issuedAt > now + 1000 ||
        input.expiresAt - input.issuedAt > 30000 || input.expiresAt <= input.issuedAt ||
        input.event !== disponibilidadClaveEvento(item, now) || now >= (input.modo === 'temporal' ? item.hasta : item.limite)) return false
      // Punto de autorización duradero. Un reintento HTTP o una segunda llamada
      // concurrente nunca obtiene otra autorización para el mismo intento.
      this.#put('recibo:' + input.event, { ...receipt, claimed: true })
      return true
    })
  }
  #finish(item, state, now) {
    const current = this.#read('aviso:' + item.modo)
    if (!current || current.id !== item.id) return
    if (item.modo === 'temporal') this.#put('aviso:temporal', { ...current, activo: false, proxima: null, estado: state, terminado: now })
    else this.#put('aviso:diario', { ...current, proxima: disponibilidadProximoDiario(item.hora, now, item.diaPendiente || disponibilidadMadrid(item.proxima).fecha), diaPendiente: null, limite: null, estado: state, comprobaciones: 0 })
  }
  async #process(mode) {
    const item = this.#read('aviso:' + mode), now = this.now()
    if (!item?.activo || item.proxima > now) return
    if (mode === 'temporal' && (now >= item.hasta || item.comprobaciones >= 12)) { this.#finish(item, 'vencido', now); return }
    const key = disponibilidadClaveEvento(item, now), receipt = this.#read('recibo:' + key)
    // Otra alarma puede observar el HTTP aún en vuelo. No cancelar el aviso
    // mientras Pages está a tiempo de reclamar su único intento reservado.
    if (receipt?.estado === 'intento' && receipt.gateway && now < receipt.gateway.expiresAt) return
    if (receipt && ['intento', 'incierto', 'enviado'].includes(receipt.estado)) { this.#finish(item, receipt.estado === 'enviado' ? 'enviado' : 'incierto', now); return }
    const day = disponibilidadMadrid(now).fecha
    // No recupera un resumen de ayer ni prolonga la ventana al reiniciar.
    const scheduledDay = disponibilidadMadrid(item.proxima).fecha
    const limit = mode === 'temporal' ? item.hasta : item.limite ?? Math.min(item.proxima + DISPONIBILIDAD_DIARIO_ESPERA, disponibilidadProximoDiario('00:00', now))
    if (mode === 'diario' && (scheduledDay !== day || item.diaPendiente && item.diaPendiente !== day || now >= limit)) { this.#finish(item, 'fuente_no_disponible', now); return }
    if (receipt?.reintentarDesde > now) {
      if (receipt.reintentarDesde >= limit) this.#finish(item, 'entrega_rechazada', now)
      else this.#put('aviso:' + mode, { ...item, proxima: receipt.reintentarDesde, limite: limit, diaPendiente: mode === 'diario' ? day : null })
      return
    }
    this.#put('aviso:' + mode, { ...item, comprobaciones: item.comprobaciones + 1, ultimaComprobacion: now, proxima: Math.min(now + DISPONIBILIDAD_INTERVALO, limit),
      diaPendiente: mode === 'diario' ? day : null, limite: limit, estado: 'comprobando' })
    await this.#schedule()
    let point
    try { point = await this.source(item) } catch { point = null }
    const current = this.#read('aviso:' + mode), after = this.now()
    if (!current?.activo || current.id !== item.id) return
    if (after >= limit) { this.#finish(item, mode === 'temporal' ? 'vencido' : 'fuente_no_disponible', after); return }
    if (!point || point.id !== item.lugarId || point.fuente !== item.fuente || point.objetivo !== item.objetivo || !disponibilidadCifraVigente(point, after)) { this.#put('aviso:' + mode, { ...current, estado: 'fuente_no_disponible' }); return }
    if (mode === 'temporal' && point.cantidad === 0) { this.#put('aviso:' + mode, { ...current, estado: 'sin_disponibilidad' }); return }
    const meta = this.#read('meta')
    const body = { schema: 1, environment: 'production', op: 'send', nonce: crypto.randomUUID(), issuedAt: after,
      expiresAt: Math.min(after + 30000, limit, Date.parse(point.caduca)), chat: meta.chat, modo: mode, avisoId: item.id, version: item.id,
      event: key, attempt: crypto.randomUUID(), workerVersion: this.env.WORKER_VERSION.id, fuente: item.fuente, lugarId: item.lugarId, objetivo: item.objetivo,
      ficha: { nombre: point.nombre, lat: point.lat, lon: point.lon, cantidad: point.cantidad, fechaDato: point.fechaDato, caduca: point.caduca } }
    if (!gatewayValidaSolicitud(body, 'send', after)) return
    const digest = await gatewayDigest(body), gateway = Object.fromEntries(gatewayFields.map(field => [field, field === 'digest' ? digest : body[field]]))
    // El hash puede ceder el turno: repetir las comprobaciones antes de reservar.
    // Pages deberá reclamar además esta autorización exacta en el mismo objeto.
    let reserved = false
    this.ctx.storage.transactionSync(() => {
      const active = this.#read('aviso:' + mode), saved = this.#read('recibo:' + key), latest = this.#read('meta'), ready = this.now()
      if (!this.#configured() || !active?.activo || active.id !== item.id || latest?.chat !== meta.chat || ready >= body.expiresAt ||
        !disponibilidadCifraVigente(point, ready) || saved && ['intento', 'enviado', 'incierto'].includes(saved.estado)) return
      this.#put('recibo:' + key, { estado: 'intento', intento: after, caduca: after + DISPONIBILIDAD_RETENCION, gateway, claimed: false }); reserved = true
    })
    if (!reserved) return
    const delivered = await this.send(body), finished = this.now()
    let result = null
    this.ctx.storage.transactionSync(() => {
      const saved = this.#read('recibo:' + key)
      if (saved?.gateway?.attempt !== body.attempt || saved.gateway.digest !== digest) return
      result = saved.claimed === true ? delivered : { estado: 'incierto' }
      this.#put('recibo:' + key, { estado: result.estado === 'reintentar' ? 'rechazado' : result.estado, intento: after, caduca: after + DISPONIBILIDAD_RETENCION,
        gateway, claimed: saved.claimed === true,
        ...(result.estado === 'reintentar' ? { reintentarDesde: finished + Math.max(DISPONIBILIDAD_INTERVALO, (result.espera || 300) * 1000) } : {}) })
      // Un rechazo antiguo no borra un consentimiento posterior ni el otro modo.
      if (result.estado === 'baja' && this.#read('aviso:' + mode)?.id === item.id) {
        this.#delete('aviso:' + mode)
        const latest = this.#read('meta')
        if (latest) this.#put('meta', { ...latest, version: crypto.randomUUID(), cambiado: finished })
      }
    })
    if (!result || result.estado === 'baja') return
    if (result.estado === 'reintentar') {
      const active = this.#read('aviso:' + mode)
      if (active?.id === item.id) {
        const next = finished + Math.max(DISPONIBILIDAD_INTERVALO, (result.espera || 300) * 1000)
        if (next >= limit) this.#finish(item, 'entrega_rechazada', finished)
        else this.#put('aviso:' + mode, { ...active, proxima: next, estado: 'reintentando' })
      }
    } else this.#finish(item, result.estado === 'enviado' ? 'enviado' : 'incierto', finished)
  }
  async alarm() {
    this.#prune()
    if (!this.#configured()) {
      const temporal = this.#read('aviso:temporal')
      if (temporal?.activo && this.now() >= temporal.hasta) this.#finish(temporal, 'vencido', this.now())
      // Una pausa operacional no pierde para siempre el despertar del diario.
      // No consulta fuentes ni envía; los temporales no se prolongan.
      await this.#schedule(true)
      return
    }
    try { for (const mode of modes) await this.#process(mode) }
    finally { await this.#schedule() }
  }
}

/** Service Binding privado: la salud no crea un objeto ni abre su SQLite.
 * Pages autoriza el chat antes de llamar; HTTP público no permite operar. */
export default class DisponibilidadServicio extends WorkerEntrypoint {
  estado() {
    return { schema: 1, revision: 'disponibilidad-v1', versionId: this.env.WORKER_VERSION?.id || null,
      gatewayRevision: 'disponibilidad-gateway-v1', habilitado: this.env.DISPONIBILIDAD_ENABLED === 'true', configurado: !!(this.env.DISPONIBILIDAD && keyReady(this.env.DISPONIBILIDAD_GATEWAY_KEY) && versionReady(this.env.WORKER_VERSION?.id)) }
  }
  async gatewayChallenge(input) { return pruebaGateway(this.env.DISPONIBILIDAD_GATEWAY_KEY, input, this.env.WORKER_VERSION?.id) }
  async #usuario(chat) { return this.env.DISPONIBILIDAD.getByName(await disponibilidadSeudonimo(chat)) }
  async leer(chat) { return (await this.#usuario(chat)).leer(chat) }
  async guardar(chat, mode, input) { return (await this.#usuario(chat)).guardar(chat, mode, input) }
  async cancelar(chat, mode = null) { return (await this.#usuario(chat)).cancelar(chat, mode) }
  async comprobar(chat) { return (await this.#usuario(chat)).comprobar(chat) }
  async claimGateway(input) { return claimValid(input) ? (await this.#usuario(input.chat)).claimGateway(input) : false }
  fetch() { return new Response('Not found', { status: 404 }) }
}
