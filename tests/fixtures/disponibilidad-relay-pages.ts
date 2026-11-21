import { Hono } from 'hono'
import { registerDisponibilidadGatewayRoutes } from '../../src/routes/disponibilidad-gateway'
import type { Env } from '../../src/index'
const app = new Hono<{ Bindings: Env }>()
registerDisponibilidadGatewayRoutes(app)
export default app
