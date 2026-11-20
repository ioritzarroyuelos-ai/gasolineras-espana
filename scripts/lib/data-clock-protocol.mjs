// Identidades públicas del único repositorio y robot autorizados.
export const DATA_REPOSITORY = 'ioritzarroyuelos-ai/gasolineras-espana'
export const DATA_REPOSITORY_ID = 1206200264
export const DATA_APP_SLUG = 'espanautildatos-ioritzarroyuelos'
export const DATA_APP_BOT_ID = 352320937
export const DATA_CLOCK_EVENT = 'data-clock-v1'
export const SLOT_MS = 15 * 60 * 1000

export function clockPayload(clientId, now = Date.now()) {
  return { v:1, repository:DATA_REPOSITORY, repositoryId:DATA_REPOSITORY_ID,
    appClientId:clientId, slot:new Date(Math.floor(now / SLOT_MS) * SLOT_MS).toISOString(),
    sentAt:new Date(now).toISOString() }
}

export function validaPulso(event, clientId, now = Date.now()) {
  if (event?.action !== DATA_CLOCK_EVENT || event.repository?.full_name !== DATA_REPOSITORY || event.repository?.id !== DATA_REPOSITORY_ID || event.repository?.default_branch !== 'main') throw Error('Evento de repositorio incorrecto')
  if (event.sender?.id !== DATA_APP_BOT_ID || event.sender?.login !== DATA_APP_SLUG+'[bot]' || event.sender?.type !== 'Bot') throw Error('El pulso no procede del robot autorizado')
  const p = event.client_payload
  if (!clientId || p?.v !== 1 || p.repository !== DATA_REPOSITORY || p.repositoryId !== DATA_REPOSITORY_ID || p.appClientId !== clientId) throw Error('Contenido del pulso incorrecto')
  if (Object.keys(p).sort().join(',') !== 'appClientId,repository,repositoryId,sentAt,slot,v') throw Error('Campos inesperados en el pulso')
  const sent = Date.parse(p.sentAt), slot = Date.parse(p.slot)
  if (!Number.isFinite(sent) || !Number.isFinite(slot) || slot !== Math.floor(sent / SLOT_MS) * SLOT_MS || new Date(sent).toISOString() !== p.sentAt || new Date(slot).toISOString() !== p.slot) throw Error('Identificador horario incorrecto')
  if (sent > now + 300000) throw Error('El pulso tiene una fecha futura')
  // Una cola retrasada no convierte un pulso antiguo en una orden nueva.
  return { current:now - sent <= 2 * 3600000, slot:p.slot }
}
