import { DisponibilidadUsuario } from '../../workers/disponibilidad.mjs'
import { disponibilidadMensaje } from '../../scripts/lib/disponibilidad.mjs'
export { default as DisponibilidadServicio } from '../../workers/disponibilidad.mjs'
// Sólo arnés local. El Worker publicado no incorpora estas operaciones.
let constructors = 0
export class DisponibilidadPrueba extends DisponibilidadUsuario {
  constructor(...args) { super(...args); constructors++ }
  now() { const row = this.ctx.storage.sql.exec("SELECT valor FROM estado WHERE clave = '_test'").toArray()[0]; return row ? JSON.parse(row.valor).now : this.testContext?.now ?? Date.now() }
  setup(now, testId) { this.testContext = { now, testId }; this.ctx.storage.sql.exec("INSERT INTO estado VALUES ('_test', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", JSON.stringify(this.testContext)); return true }
  context() { const row = this.ctx.storage.sql.exec("SELECT valor FROM estado WHERE clave = '_test'").toArray()[0]; return row ? JSON.parse(row.valor) : this.testContext }
  async source(item) { return (await fetch('https://availability-test.invalid/source', { method: 'POST', body: JSON.stringify({ item, ...this.context() }) })).json() }
  async send(body) {
    const row = this.ctx.storage.sql.exec('SELECT valor FROM estado WHERE clave = ?', 'recibo:' + body.event).one()
    if (!this.claimGateway(JSON.parse(row.valor).gateway)) return { estado: 'incierto' }
    const text = disponibilidadMensaje(body, { ...body.ficha, fuenteUrl: 'https://fuente.invalid', enlace: 'https://webapp-3ft.pages.dev/cerca' })
    const result = await (await fetch('https://availability-test.invalid/send', { method: 'POST', body: JSON.stringify({ chat: body.chat, text, ...this.context() }) })).json()
    if (result.crash) throw Error('Caída simulada tras intención'); return result
  }
  async tick(now) { this.setup(now, this.context().testId); await this.alarm(); return true }
  inspect() { return this.ctx.storage.sql.exec('SELECT clave, valor FROM estado ORDER BY clave').toArray().map(row => [row.clave, JSON.parse(row.valor)]) }
  replaceAttempt() {
    const row = this.ctx.storage.sql.exec("SELECT clave, valor FROM estado WHERE clave LIKE 'recibo:%' LIMIT 1").one()
    const receipt = JSON.parse(row.valor)
    receipt.gateway.attempt = crypto.randomUUID(); receipt.gateway.digest = 'd'.repeat(64); receipt.claimed = false
    this.ctx.storage.sql.exec('UPDATE estado SET valor = ? WHERE clave = ?', JSON.stringify(receipt), row.clave)
    return { key: row.clave, receipt }
  }
  async scheduled() { return this.ctx.storage.getAlarm() }
  paused(value) { this.env.DISPONIBILIDAD_ENABLED = value ? 'false' : 'true'; return true }
}
export default {
  async fetch(request, env) {
    const { object, operation, args } = await request.json()
    if (operation === 'service-health') return Response.json(await env.CONTROL.estado())
    if (operation === 'constructors') return Response.json(constructors)
    if (['service-read', 'service-cancel', 'service-dry'].includes(operation)) {
      const method = { 'service-read': 'leer', 'service-cancel': 'cancelar', 'service-dry': 'comprobar' }[operation]
      return Response.json(await env.CONTROL[method](...args))
    }
    if (!['setup', 'leer', 'guardar', 'cancelar', 'comprobar', 'tick', 'inspect', 'scheduled', 'paused', 'replaceAttempt'].includes(operation)) return new Response('invalid', { status: 400 })
    const stub = env.DISPONIBILIDAD.getByName(object)
    return Response.json(await stub[operation](...args))
  },
}
