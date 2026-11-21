const AUTH = 'gs_tg_auth_v1', PATH = '/api/telegram/disponibilidad';
const labels = { programado: 'Programado', comprobando: 'Comprobando la fuente', enviado: 'Aviso enviado', incierto: 'La entrega no pudo confirmarse; no la repetiremos', vencido: 'La hora de comprobación ha terminado', sin_disponibilidad: 'Última comprobación: sin disponibilidad', fuente_no_disponible: 'La fuente no ofrece un dato vigente; no hemos comunicado una cifra', entrega_rechazada: 'Telegram rechazó la entrega', reintentando: 'Telegram ha pedido esperar; volveremos a comprobar dentro del plazo' };

export function crearAvisosDisponibilidad({ changed }) {
  let available = false, manageable = false, dialog = null;
  const node = (tag, text, className) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (className) n.className = className; return n; };
  const action = (text, callback) => { const n = node('button', text); n.type = 'button'; n.addEventListener('click', callback); return n; };
  const readAuth = () => { try { return localStorage.getItem(AUTH) || ''; } catch { return ''; } };
  function manager() {
    const container = document.getElementById('sv-availability-manage'); if (!container) return;
    container.replaceChildren();
    if (manageable && readAuth()) container.append(action('Gestionar mis avisos de disponibilidad', () => open(null, null)));
  }
  window.addEventListener('storage', event => { if (event.key === AUTH || event.key === null) manager(); });
  const time = value => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  fetch(PATH + '/config', { cache: 'no-store', signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null).then(config => {
    available = config?.available === true; manageable = config?.manageAvailable === true; manager(); if (available) changed();
  }).catch(() => {});

  function open(fuente, place) {
    dialog?.close(); dialog?.remove();
    const d = node('dialog', null, 'sv-availability-dialog'); dialog = d; d.setAttribute('aria-labelledby', 'sv-availability-title');
    const title = node('h2', 'Avisos de disponibilidad'); title.id = 'sv-availability-title';
    const close = action('Cerrar', () => d.close()), heading = node('div', null, 'sv-availability-heading'); heading.append(title, close);
    const status = node('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const existing = node('div'), form = node('form'), controls = node('fieldset'), legend = node('legend', 'Elige cómo recibirlo'); controls.append(legend);
    const mode = node('select'); mode.id = 'sv-availability-mode';
    for (const [value, text] of [['temporal', 'Avísame si hay sitio durante 1 hora'], ['diario', 'Resumen diario a una hora']]) { const option = node('option', text); option.value = value; mode.append(option); }
    const modeLabel = node('label', 'Tipo de aviso'); modeLabel.htmlFor = mode.id; controls.append(modeLabel, mode);
    const objective = node('select'); objective.id = 'sv-availability-objective';
    for (const [value, text] of fuente === 'bicis-zaragoza' ? [['bicis', 'Bicicletas para alquilar'], ['anclajes', 'Anclajes para devolver']] : [['plazas', 'Plazas libres totales']]) { const option = node('option', text); option.value = value; objective.append(option); }
    const objectiveLabel = node('label', 'Qué quieres comprobar'); objectiveLabel.htmlFor = objective.id; controls.append(objectiveLabel, objective);
    const hourBox = node('div'), hour = node('input'); hour.type = 'time'; hour.value = '08:00'; hour.id = 'sv-availability-hour'; hour.required = true;
    const hourLabel = node('label', 'Hora peninsular'); hourLabel.htmlFor = hour.id; hourBox.append(hourLabel, hour); controls.append(hourBox);
    const explanation = node('p', null, 'sv-availability-help');
    const consent = node('input'); consent.type = 'checkbox'; consent.id = 'sv-availability-consent';
    const consentLabel = node('label', null, 'sv-availability-consent'); consentLabel.htmlFor = consent.id; consentLabel.append(consent, document.createTextNode(' Quiero recibir este aviso en mi Telegram. Es un permiso separado de precios e ITV.'));
    const save = node('button', 'Activar aviso'); save.type = 'submit';
    const link = action('Vincular Telegram', () => void connect()), external = node('a', 'Abrir Telegram y pulsar Iniciar'); external.target = '_blank'; external.rel = 'noopener noreferrer'; external.hidden = true;
    form.append(controls, explanation, consentLabel, save);
    d.append(heading);
    if (place) d.append(node('p', place.nombre, 'sv-availability-place'), node('p', fuente === 'bicis-zaragoza' ? 'La cifra puede cambiar durante el trayecto. No es una reserva.' : 'Sólo plazas libres totales. No sabemos cuántas plazas PMR están libres. No es una reserva.'));
    else d.append(node('p', available ? 'Aquí puedes cancelar tus avisos. Para crear otro, elige un aparcamiento o una estación Bizi en el mapa.' : 'Las nuevas altas y los envíos están pausados. Puedes consultar y cancelar tus avisos existentes.'));
    form.hidden = !place || !available; d.append(existing, form, link, external, status);
    document.body.append(d); d.showModal();
    const controller = new AbortController(); let auth = readAuth(), snapshot = null, busy = false, linking = false, serial = 0, authRevision = 0, linkRun = 0, refreshQueued = false;
    d.addEventListener('close', () => { controller.abort(); serial++; authRevision++; linkRun++; });
    function draw() {
      hourBox.hidden = mode.value !== 'diario'; hour.disabled = mode.value !== 'diario';
      explanation.textContent = mode.value === 'diario' ? 'Resumen diario a esa hora, incluido cero si la fuente lo confirma. Si no responde, reintentamos hasta 30 minutos, dentro del mismo día. En el cambio de hora de primavera, una hora inexistente pasa al primer minuto válido posterior.' : 'Comprobamos al activarlo y aproximadamente cada 5 minutos durante una hora. Avisamos una sola vez cuando hay al menos una unidad. El aviso termina al notificarte o vencer; no detectamos necesariamente los cambios entre comprobaciones.';
      link.hidden = !!auth; link.disabled = busy || linking; save.hidden = !auth; save.disabled = busy || linking || !snapshot || !consent.checked;
      controls.disabled = busy || linking;
    }
    async function request(method = 'GET', suffix = '', body) {
      const current = auth, session = authRevision;
      const response = await fetch(PATH + suffix, { method, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        headers: { Authorization: 'Bearer ' + current, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (current !== auth || session !== authRevision || !d.open) throw Error('cancelled');
      if (response.status === 401) { auth = ''; snapshot = null; try { localStorage.removeItem(AUTH); localStorage.removeItem('gs_tg_chat_v1'); } catch {} throw Error('Tu vínculo ha caducado. Vuelve a vincular Telegram.'); }
      const data = await response.json();
      if (current !== auth || session !== authRevision || !d.open) throw Error('cancelled');
      if (!response.ok || !data.ok) throw Error(response.status === 409 ? 'El aviso cambió en otra pestaña. Cierra y vuelve a abrir esta ventana antes de decidir.' : response.status === 429 ? 'Has alcanzado el límite de cambios de hoy. Puedes cancelar el aviso actual; vuelve mañana para crear otro.' : data.error === 'source_unavailable' ? 'No podemos comprobar la identidad del lugar ahora. El aviso anterior se conserva; vuelve a intentarlo.' : 'No se ha podido confirmar el cambio. Vuelve a abrir esta ventana para consultar el estado real.');
      return data;
    }
    function render(data) {
      snapshot = data; existing.replaceChildren();
      for (const item of data.avisos || []) {
        const box = node('section', null, 'sv-availability-saved'); box.append(node('h3', (item.modo === 'diario' ? 'Tu resumen diario' : 'Tu aviso de una hora') + ': ' + item.nombre));
        box.append(node('p', (labels[item.estado] || 'Estado sin confirmar') + (item.hora ? '. Hora elegida: ' + item.hora + ' (peninsular)' : '') + (item.hasta ? '. Termina: ' + time(item.hasta) : '')));
        if (item.proxima) box.append(node('p', 'Próxima comprobación prevista: ' + time(item.proxima)));
        box.append(action('Cancelar sólo este aviso', async () => {
          if (busy) return; busy = true; consent.checked = false; draw();
          try { render(await request('DELETE', '/' + item.modo)); status.textContent = 'Aviso cancelado. Una entrega ya iniciada podría llegar todavía. Tus avisos de precios e ITV siguen igual.'; }
          catch (error) { if (d.open && error.message !== 'cancelled') status.textContent = error.message; }
          finally { finishBusy(); }
        })); existing.append(box);
      }
      draw();
    }
    function finishBusy() {
      busy = false; draw();
      if (refreshQueued && d.open) { refreshQueued = false; void refresh(); }
    }
    async function refresh() {
      if (!auth || !d.open) { draw(); return; }
      if (busy || linking) { refreshQueued = true; draw(); return; }
      const current = ++serial; busy = true; draw();
      try { const data = await request(); if (current === serial) { render(data); status.textContent = data.avisos?.length ? 'Estos son tus avisos de disponibilidad. Puedes tener uno diario y uno temporal.' : 'Telegram vinculado. Todavía no has activado avisos de disponibilidad.'; } }
      catch (error) { if (d.open && current === serial) { snapshot = null; status.textContent = error.message; } }
      finally { finishBusy(); }
    }
    async function connect() {
      if (busy || linking) return; const session = authRevision, run = ++linkRun; linking = true; draw(); status.textContent = 'Preparando el vínculo seguro…';
      try {
        const response = await fetch('/api/telegram/start-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favs: [] }), redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        const data = await response.json(), url = new URL(data.deepLink);
        if (!d.open || session !== authRevision || run !== linkRun) return;
        if (!response.ok || !data.ok || !/^[a-f0-9]{32}$/.test(data.token) || url.origin !== 'https://t.me' || url.username || url.password || url.searchParams.get('start') !== data.token) throw Error('No se pudo preparar el vínculo.');
        external.href = url.href; external.hidden = false; status.textContent = 'Abre Telegram, pulsa Iniciar y vuelve aquí. Vincularlo no activa avisos.';
        const until = Date.now() + 180000;
        while (d.open && session === authRevision && run === linkRun && Date.now() < until) {
          await new Promise(resolve => setTimeout(resolve, 2000)); if (!d.open || session !== authRevision || run !== linkRun) return;
          const result = await fetch('/api/telegram/confirm?token=' + encodeURIComponent(data.token), { cache: 'no-store', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
          if (!result.ok) continue; const confirmed = await result.json();
          if (!d.open || session !== authRevision || run !== linkRun) return;
          if (confirmed.expired) throw Error('El enlace caducó. Vuelve a vincular Telegram.');
          if (confirmed.confirmed && typeof confirmed.auth === 'string' && confirmed.auth.length > 0 && confirmed.auth.length < 4096) {
            auth = confirmed.auth; authRevision++; serial++; try { localStorage.setItem(AUTH, auth); if (Number.isSafeInteger(confirmed.chat_id) && confirmed.chat_id > 0) localStorage.setItem('gs_tg_chat_v1', String(confirmed.chat_id)); } catch {} manager(); external.hidden = true; linking = false; await refresh(); return;
          }
        }
        if (!auth) throw Error('No se confirmó el vínculo. Puedes intentarlo de nuevo.');
      } catch (error) { if (d.open && session === authRevision && run === linkRun) status.textContent = error.message || 'No se pudo vincular Telegram.'; }
      finally { if (run === linkRun) { linking = false; draw(); if (refreshQueued) { refreshQueued = false; void refresh(); } } }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (busy || !auth || !snapshot || !consent.checked) return;
      const previous = snapshot.avisos?.find(item => item.modo === mode.value);
      if (previous?.activo && !window.confirm('Ya tienes este tipo de aviso para ' + previous.nombre + '. ¿Quieres sustituirlo por el que acabas de elegir?')) return;
      busy = true; draw();
      const body = { fuente, lugarId: place.id, objetivo: objective.value, ...(mode.value === 'diario' ? { hora: hour.value } : {}), consentimiento: 'disponibilidad-telegram-v1', version: snapshot.version, peticion: crypto.randomUUID() };
      try { render(await request('PUT', '/' + mode.value, body)); consent.checked = false; status.textContent = 'Aviso activado con tu permiso. Puedes cancelarlo aquí; una cifra puede cambiar durante el trayecto.'; }
      catch (error) { if (d.open && error.message !== 'cancelled') { snapshot = null; status.textContent = error.message; } }
      finally { finishBusy(); }
    });
    controls.addEventListener('change', () => { consent.checked = false; draw(); }); consent.addEventListener('change', draw);
    const visible = () => { if (!document.hidden && d.open) void refresh(); };
    const storage = event => { if ((event.key === AUTH || event.key === null) && d.open) { authRevision++; serial++; linkRun++; linking = false; auth = readAuth(); consent.checked = false; snapshot = null; external.hidden = true; existing.replaceChildren(); void refresh(); } };
    document.addEventListener('visibilitychange', visible); window.addEventListener('storage', storage);
    d.addEventListener('close', () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('storage', storage); });
    draw(); if (auth) void refresh(); else status.textContent = 'Puedes vincular Telegram sin iniciar sesión con Google.';
  }
  return { button(fuente, place) { return available ? action('Avisarme por Telegram', () => open(fuente, place)) : null; } };
}
