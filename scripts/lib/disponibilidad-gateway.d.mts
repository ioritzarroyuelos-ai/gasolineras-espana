import type { DisponibilidadFuente, DisponibilidadModo, DisponibilidadObjetivo } from './disponibilidad.mjs'
export const GATEWAY_ORIGIN: 'https://webapp-3ft.pages.dev'
export const GATEWAY_PATH_CHECK: '/api/telegram/disponibilidad/gateway/check'
export const GATEWAY_PATH_SEND: '/api/telegram/disponibilidad/gateway/send'
export const GATEWAY_REVISION: 'disponibilidad-gateway-v1'
export const GATEWAY_SIGNATURE_HEADER: 'X-EU-Gateway-Signature'
export const GATEWAY_MAX_BYTES: 4096
export const GATEWAY_VENTANA_MS: 30000
export interface GatewayBase { schema: 1; environment: 'production'; nonce: string; issuedAt: number; expiresAt: number }
export interface GatewayCheck extends GatewayBase { op: 'check' }
export interface GatewayFicha { nombre: string; cantidad: number; fechaDato: string; caduca: string; lat: number | null; lon: number | null }
export interface GatewaySend extends GatewayBase {
  op: 'send'; chat: number; modo: DisponibilidadModo; avisoId: string; version: string; event: string; attempt: string; workerVersion: string
  fuente: DisponibilidadFuente; lugarId: string; objetivo: DisponibilidadObjetivo; ficha: GatewayFicha
}
export type GatewaySolicitud = GatewayCheck | GatewaySend
export interface GatewayChallenge extends GatewayBase { workerVersion: string; signature: string }
export type GatewayEntrega = { estado: 'enviado' | 'incierto' | 'baja' | 'reintentar'; espera?: number }
export interface GatewayReplyBase extends GatewayBase { requestDigest: string; workerVersion: string; revision: typeof GATEWAY_REVISION }
export interface GatewaySendReply extends GatewayReplyBase, GatewayEntrega { op: 'send'; attempt: string }
export interface GatewayCheckReply extends GatewayReplyBase { op: 'check'; ok: true; bot: { expectedUsername: string; credentialUsername: string }; worker: GatewayChallenge }
export type GatewayReply = GatewaySendReply | GatewayCheckReply
export interface GatewayIO { fetch?: typeof fetch; now?: (() => number) | number; timeoutMs?: number }
export function derivaGatewayKey(cron: string): Promise<string>
export function gatewayCanonico(data: unknown): string
/** A string is hashed as exact UTF-8 bytes; objects use canonical JSON. */
export function gatewayDigest(data: unknown): Promise<string>
export function gatewayValidaSolicitud(data: unknown, op: 'send', now?: number): GatewaySend | null
export function gatewayValidaSolicitud(data: unknown, op: 'check', now?: number): GatewayCheck | null
export function gatewayValidaSolicitud(data: unknown, op: string, now?: number): GatewaySolicitud | null
export function gatewayFirma(key: string, path: string, raw: string, role?: 'request' | 'response'): Promise<string>
export function gatewayVerifica(key: string, path: string, raw: string, signature: string, role?: 'request' | 'response'): Promise<boolean>
export function gatewayChallenge(key: string, challenge: Pick<GatewayBase, 'nonce' | 'issuedAt' | 'expiresAt'>, versionId: string): Promise<GatewayChallenge>
export function gatewayValidaChallenge(key: string, proof: unknown, nonce: string, versionId?: string, now?: number): Promise<boolean>
export function gatewayValidaRespuesta(data: unknown, request: GatewaySolicitud, requestDigest: string, now?: number): GatewayReply | null
export function gatewayEnviar(key: string, request: GatewaySend, io?: GatewayIO): Promise<GatewayEntrega>
