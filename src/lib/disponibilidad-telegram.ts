export type DisponibilidadRespuesta = { status: number; ok: boolean; error?: string; [key: string]: unknown }
export interface DisponibilidadStub {
  leer(chat: number): Promise<DisponibilidadRespuesta>
  guardar(chat: number, modo: string, input: unknown): Promise<DisponibilidadRespuesta>
  cancelar(chat: number, modo?: string | null): Promise<DisponibilidadRespuesta>
  comprobar(chat: number): Promise<DisponibilidadRespuesta>
}
export interface DisponibilidadBinding extends DisponibilidadStub {
  estado(): Promise<{ schema: number; revision: string; gatewayRevision?: string; versionId: string | null; habilitado: boolean; configurado: boolean }>
  gatewayChallenge?(input: { nonce: string; issuedAt: number; expiresAt: number }): Promise<GatewayChallenge>
  claimGateway?(input: DisponibilidadClaim): Promise<boolean>
}
export async function borrarDisponibilidadTelegram(env: { DISPONIBILIDAD?: DisponibilidadBinding }, chat: number): Promise<boolean> {
  if (!env.DISPONIBILIDAD) return false
  const result = await env.DISPONIBILIDAD.cancelar(chat)
  if (!result.ok || result.status !== 200) throw Error('availability_cancel_pending')
  return true
}
import type { GatewayChallenge } from '../../scripts/lib/disponibilidad-gateway.mjs'
export interface DisponibilidadClaim {
  chat: number; modo: 'diario' | 'temporal'; avisoId: string; version: string; event: string; attempt: string
  workerVersion: string; nonce: string; issuedAt: number; expiresAt: number; digest: string
}
