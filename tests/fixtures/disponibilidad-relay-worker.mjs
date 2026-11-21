import { DisponibilidadUsuario } from '../../workers/disponibilidad.mjs'
import { disponibilidadSeudonimo } from '../../scripts/lib/disponibilidad.mjs'
export { default as DisponibilidadServicio } from '../../workers/disponibilidad.mjs'

// Sólo controles locales de prueba. El Worker de producción no los importa.
let constructors = 0
export class DisponibilidadRelayPrueba extends DisponibilidadUsuario {
  constructor(...args) { super(...args); constructors++ }
  async source(item) {
    const now = Date.now()
    return { id: item.lugarId, fuente: item.fuente, objetivo: item.objetivo, nombre: 'Lugar público simulado', lat: 40.4, lon: -3.7,
      cantidad: 2, estado: 'actual', fechaDato: new Date(now - 60000).toISOString(), caduca: new Date(now + (this.testExpiryMs ?? 240000)).toISOString(),
      fuenteUrl: 'https://datos.madrid.es/dataset/50027-0-aparcamientosocupacionyservicios', enlace: 'https://webapp-3ft.pages.dev/cerca?categorias=aparcamientos-madrid&servicio=parking-madrid-72&lat=40.4&lon=-3.7' }
  }
  async guardar(...args) { try { return await super.guardar(...args) } finally { await this.ctx.storage.deleteAlarm() } }
  sourceExpiry(ms) { if (!Number.isInteger(ms) || ms < 1 || ms > 240000) throw Error('invalid_local_expiry'); this.testExpiryMs = ms; return true }
  claimGateway(input) {
    this.ctx.storage.sql.exec("INSERT INTO estado VALUES ('_claims', '1') ON CONFLICT(clave) DO UPDATE SET valor=CAST(CAST(valor AS INTEGER)+1 AS TEXT)")
    return super.claimGateway(input)
  }
  async tick() {
    const row = this.ctx.storage.sql.exec("SELECT valor FROM estado WHERE clave='aviso:temporal'").toArray()[0]
    if (row) {
      const item = JSON.parse(row.valor)
      this.ctx.storage.sql.exec("UPDATE estado SET valor=? WHERE clave='aviso:temporal'", JSON.stringify({ ...item, proxima: Date.now() - 1 }))
    }
    try { await this.alarm(); return true } finally { await this.ctx.storage.deleteAlarm() }
  }
  inspect() { return this.ctx.storage.sql.exec('SELECT clave, valor FROM estado ORDER BY clave').toArray().map(row => [row.clave, JSON.parse(row.valor)]) }
}
export default {
  async fetch(request, env) {
    const { chat, op, args = [] } = await request.json()
    if (op === 'constructors') return Response.json(constructors)
    if (['leer', 'guardar', 'cancelar'].includes(op)) return Response.json(await env.CONTROL[op](chat, ...args))
    if (!['tick', 'inspect', 'sourceExpiry'].includes(op)) return new Response('invalid', { status: 400 })
    return Response.json(await env.DISPONIBILIDAD.getByName(await disponibilidadSeudonimo(chat))[op](...args))
  },
}
