const AUTH = 'gs_tg_auth_v1';
const PATH = '/api/telegram/itv-recordatorio';

/** Separate opt-in: linking the bot or saving a local date never subscribes. */
export async function iniciarItvTelegram(api, unsaved = () => false) {
  const panel = document.getElementById('itv-telegram');
  if (!panel) return;
  const status = document.getElementById('itv-telegram-estado'), consent = document.getElementById('itv-telegram-permiso');
  const activate = document.getElementById('itv-telegram-activar'), cancel = document.getElementById('itv-telegram-cancelar');
  const link = document.getElementById('itv-telegram-vincular'), open = document.getElementById('itv-telegram-abrir');
  let auth = '', active = null, busy = false, linking = false, stopped = false;
  try { auth = localStorage.getItem(AUTH) || ''; } catch { /* read-only storage still permits an in-memory link */ }
  function message(text) { status.textContent = text; }
  function draw() {
    link.hidden = !!auth; activate.hidden = !auth; cancel.hidden = !active;
    activate.disabled = busy || unsaved() || !consent.checked || !api.recordatorio(); cancel.disabled = busy; link.disabled = busy || linking;
    activate.textContent = active ? 'Actualizar avisos en Telegram' : 'Activar avisos en Telegram';
  }
  async function request(method = 'GET', body) {
    const response = await fetch(PATH, { method, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Bearer ' + auth, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 401) {
      auth = ''; active = null; try { localStorage.removeItem(AUTH); localStorage.removeItem('gs_tg_chat_v1'); } catch {} draw(); throw new Error('Tu vínculo ha caducado. Vuelve a vincular Telegram.');
    }
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error(data.error === 'no_future_windows' ? 'Ya han pasado las franjas de aviso para esa fecha. No hemos activado avisos nuevos; cualquier aviso previo conserva su fecha. Puedes descargar el archivo para tu calendario y ajustar allí un aviso.' : response.status === 400 ? 'Elige una fecha futura, dentro de los próximos 10 años, y confirma el permiso.' : 'No se pudo comprobar o guardar el aviso. Vuelve a intentarlo.');
    return data;
  }
  function summary(data) {
    active = data.recordatorio || null;
    const uncertain = data.avisos?.some(item => ['pendiente', 'incierto'].includes(item.estado));
    const windows = active?.ventanas;
    const schedule = Array.isArray(windows) ? windows.length ? 'Avisos pendientes: ' + windows.map(item => item.fecha.split('-').reverse().join('/') + ' (' + item.dias + (item.dias === 1 ? ' día antes)' : ' días antes)')).join(' y ') + ', de 8:00 a 11:59 de Madrid. Comprobamos los avisos cada hora. Si lo activas cerca de las 12:00, ese aviso podría no llegar.' : 'No quedan avisos pendientes para esta fecha.' : 'Se intentarán enviar 7 días y 1 día antes, entre las 8:00 y las 12:00 de Madrid.';
    message(active ? 'Avisos de Telegram para la fecha ' + active.fecha.split('-').reverse().join('/') + '. ' + (uncertain ? 'Una entrega no pudo confirmarse; no la repetimos para evitar duplicados. Puedes consultar tu fecha aquí.' : schedule) : 'Telegram vinculado. Todavía no has activado avisos de ITV.');
    draw();
  }
  async function refresh() {
    if (!auth || busy || linking) { draw(); return; }
    busy = true; draw();
    try { summary(await request()); } catch (error) { message(error.message); }
    finally { busy = false; draw(); }
  }
  try {
    const response = await fetch(PATH + '/config', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const config = await response.json();
    if (!response.ok || !config.available || (!auth && !config.linkAvailable)) return;
  } catch { return; }
  panel.hidden = false;
  consent.addEventListener('change', draw);
  activate.addEventListener('click', async () => {
    const date = api.recordatorio()?.fecha;
    if (!date || unsaved() || !consent.checked || busy) return;
    busy = true; draw();
    try { summary(await request('PUT', { fecha: date, consentimiento: 'itv-telegram-v1' })); consent.checked = false; }
    catch (error) { message(error.message); }
    finally { busy = false; draw(); }
  });
  cancel.addEventListener('click', async () => {
    if (busy || !window.confirm('¿Cancelar sólo los avisos de ITV por Telegram? Tu calendario y los resúmenes de gasolina no cambian.')) return;
    busy = true; draw();
    try { await request('DELETE'); active = null; consent.checked = false; message('Avisos de ITV por Telegram cancelados. Una entrega ya iniciada podría llegar todavía.'); }
    catch (error) { message(error.message); }
    finally { busy = false; draw(); }
  });
  link.addEventListener('click', async () => {
    if (busy || linking) return;
    linking = true; draw(); message('Preparando el enlace seguro…');
    try {
      const response = await fetch('/api/telegram/start-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favs: [] }), redirect: 'error', signal: AbortSignal.timeout(12000) });
      const data = await response.json();
      const url = new URL(data.deepLink);
      if (!response.ok || !data.ok || !/^[a-f0-9]{32}$/.test(data.token) || url.origin !== 'https://t.me' || url.username || url.password || url.searchParams.get('start') !== data.token) throw new Error('No se pudo preparar el vínculo. Vuelve a intentarlo.');
      open.href = url.href; open.hidden = false;
      message('Abre Telegram con el enlace, pulsa Iniciar y vuelve aquí. Vincular no activa avisos todavía.');
      const until = Date.now() + 180000;
      while (!stopped && Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const poll = await fetch('/api/telegram/confirm?token=' + encodeURIComponent(data.token), { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!poll.ok) continue;
        const confirmed = await poll.json();
        if (confirmed.expired) throw new Error('El enlace ha caducado. Vuelve a vincular Telegram.');
        if (confirmed.confirmed && typeof confirmed.auth === 'string' && confirmed.auth.length < 4096) {
          auth = confirmed.auth; try {
            localStorage.setItem(AUTH, auth);
            if (Number.isSafeInteger(confirmed.chat_id) && confirmed.chat_id > 0) localStorage.setItem('gs_tg_chat_v1', String(confirmed.chat_id));
          } catch {}
          open.hidden = true; summary(await request()); break;
        }
      }
      if (!auth && !stopped) message('No se confirmó el vínculo. Puedes pulsar «Vincular Telegram» para intentarlo de nuevo.');
    } catch (error) { message(error.message || 'No se pudo vincular Telegram. Vuelve a intentarlo.'); }
    finally { linking = false; draw(); }
  });
  window.addEventListener('eu:cuenta', event => {
    if (event.detail?.keys?.includes('eu-itv-recordatorio-v1') || event.detail?.reason === 'account') {
      consent.checked = false; draw();
      if (active && active.fecha !== api.recordatorio()?.fecha) message('La fecha de Telegram sigue siendo ' + active.fecha.split('-').reverse().join('/') + '. Para cambiarla, guarda la nueva fecha y confirma «Actualizar avisos en Telegram». También puedes cancelarlos.');
    }
  });
  document.getElementById('itv-recordatorio-form').addEventListener('input', () => { consent.checked = false; draw(); });
  window.addEventListener('eu:itv-fecha', draw);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  window.addEventListener('pagehide', () => { stopped = true; });
  window.addEventListener('storage', event => {
    if (event.key === AUTH || event.key === null) { try { auth = localStorage.getItem(AUTH) || ''; } catch {} void refresh(); }
  });
  if (auth) await refresh(); else message('Puedes vincular Telegram sin iniciar sesión con Google.');
  draw();
}
