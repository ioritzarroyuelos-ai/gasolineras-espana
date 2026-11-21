import { DisponibilidadUsuario } from '../../workers/disponibilidad.mjs'
export { default as DisponibilidadServicio } from '../../workers/disponibilidad.mjs'
// Sólo arnés local. El Worker publicado no incorpora estas operaciones.
let constructors = 0
export class DisponibilidadPrueba extends DisponibilidadUsuario {
  constructor(...args) { super(...args); constructors++ }
  now() { const row = this.ctx.storage.sql.exec("SELECT valor FROM estado WHERE clave = '_test'").toArray()[0]; return row ? JSON.parse(row.valor).now : Date.now() }
  setup(now, testId) { this.ctx.storage.sql.exec("INSERT INTO estado VALUES ('_test', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", JSON.stringify({ now, testId })); return true }
  context() { return JSON.parse(this.ctx.storage.sql.exec("SELECT valor FROM estado WHERE clave = '_test'").one().valor) }
  async source(item) { return (await fetch('https://availability-test.invalid/source', { method: 'POST', body: JSON.stringify({ item, ...this.context() }) })).json() }
  async send(chat, text) { const result = await (await fetch('https://availability-test.invalid/send', { method: 'POST', body: JSON.stringify({ chat, text, ...this.context() }) })).json(); if (result.crash) throw Error('Caída simulada tras intención'); return result }
  async tick(now) { this.setup(now, this.context().testId); await this.alarm(); return true }
  inspect() { return this.ctx.storage.sql.exec('SELECT clave, valor FROM estado ORDER BY clave').toArray().map(row => [row.clave, JSON.parse(row.valor)]) }
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
    if (!['setup', 'leer', 'guardar', 'cancelar', 'comprobar', 'tick', 'inspect', 'scheduled', 'paused'].includes(operation)) return new Response('invalid', { status: 400 })
    const stub = env.DISPONIBILIDAD.getByName(object)
    return Response.json(await stub[operation](...args))
  },
}
