import { APP_VERSION } from '../lib/version'

export function recordatorioItvHtml(): string {
  return `<section id="itv-recordatorio" class="itv-recordatorio" aria-labelledby="itv-recordatorio-title">
    <h2 id="itv-recordatorio-title">Recuerda tu próxima ITV</h2>
    <p>Escribe la fecha que aparece en tu documentación. Es una fecha que tú indicas: no la calculamos ni reservamos una cita.</p>
    <div id="itv-recordatorio-controles" hidden>
      <form id="itv-recordatorio-form">
        <div class="itv-recordatorio-fields">
          <label for="itv-recordatorio-fecha">Fecha de caducidad que quieres recordar<input id="itv-recordatorio-fecha" name="fecha" type="date" required min="2000-01-01" max="2099-12-31"></label>
          <label for="itv-recordatorio-nombre">Nombre del vehículo (opcional)<input id="itv-recordatorio-nombre" name="nombre" type="text" maxlength="60" autocomplete="off" placeholder="Mi vehículo" aria-describedby="itv-recordatorio-privacidad"></label>
        </div>
        <p id="itv-recordatorio-privacidad" class="meta">Basta con «Mi coche». No escribas la matrícula ni otros datos personales.</p>
        <div class="acciones"><button class="btn btn--principal" type="submit">Guardar fecha</button><button id="itv-recordatorio-calendario" class="btn" type="button" hidden>Descargar para mi calendario</button><button id="itv-recordatorio-borrar" class="btn" type="button" hidden>Quitar recordatorio</button></div>
      </form>
      <p id="itv-recordatorio-resumen"></p><p id="itv-recordatorio-estado" role="status" aria-live="polite"></p>
      <p class="meta">Con Google se guarda en tu cuenta; sin sesión, en este navegador. Para recibir avisos, importa el archivo .ics en tu calendario y comprueba sus notificaciones: propone avisos 7 días y 1 día antes. Guardar la fecha aquí no activa mensajes de Telegram.</p>
      <p class="meta">Si cambias o quitas esta fecha, actualiza también el evento que hayas importado en tu calendario.</p>
    </div><noscript><p>Activa JavaScript para guardar tu fecha y descargar el recordatorio. El directorio y sus enlaces siguen disponibles.</p></noscript>
  </section><script src="/static/itv-recordatorio.js?v=${APP_VERSION}" defer></script>`
}

export const CSS_RECORDATORIO_ITV = `
.itv-recordatorio{margin:28px 0;padding:22px;border:1px solid var(--eu-line);border-radius:20px;background:var(--eu-soft);scroll-margin-top:20px}
.itv-recordatorio h2{margin:0 0 12px}.itv-recordatorio p{line-height:1.6}.itv-recordatorio-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.itv-recordatorio label{display:block;font-size:14px;font-weight:650;min-width:0}.itv-recordatorio input{display:block;width:100%;min-width:0;max-width:100%;min-height:44px;margin-top:8px;padding:10px;border:1px solid var(--eu-line);border-radius:10px;background:var(--eu-surface);color:var(--eu-ink);font:inherit}
.itv-recordatorio [hidden]{display:none!important}.itv-recordatorio .btn{cursor:pointer}.itv-recordatorio .btn:disabled{cursor:default;opacity:.65}
.itv-recordatorio #itv-recordatorio-estado{font-size:14px;font-weight:600}.itv-recordatorio #itv-recordatorio-estado.error{color:#a52318}
@media(max-width:650px){.itv-recordatorio{padding:16px}.itv-recordatorio-fields{grid-template-columns:1fr}.itv-recordatorio .acciones>.btn{width:100%}}
`
