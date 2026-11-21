// Una sesión para todo el portal. Las copias locales pertenecen a su cuenta;
// solo una acción explícita del usuario genera una escritura en el servidor.
(() => {
  const serviceStorageName = 'eu-servicios-favoritos-v1', servicePrefsStorageName = 'eu-servicios-preferencias-v1';
  const itvKey = 'eu-itv-recordatorio-v1';
  const keys = ['gs_favs_v1', 'gs_profile_v1', 'eu-deportes-favoritos-v1', 'eu-mi-dia-v1', 'espana-util-municipio', serviceStorageName, servicePrefsStorageName, itvKey];
  const lists = ['gs_favs_v1', 'eu-deportes-favoritos-v1', serviceStorageName];
  const ownerKey = 'eu-cuenta-owner-v1', guestKey = 'eu-cuenta-invitado-v1';
  const cacheKey = id => 'eu-cuenta-cache-v1:' + id;
  const pendingKey = id => 'eu-cuenta-pendientes-v1:' + id;
  const baselineKey = id => 'eu-cuenta-base-v1:' + id;
  const ackKey = id => 'eu-cuenta-confirmado-v1:' + id;
  const $ = id => document.getElementById(id);
  let user = null, generation = 0, baseline = {}, pending = {}, status = 'checking';
  let pulling = false, writing = false, confirmed = false, refreshPromise = null;
  let retryTimer, retries = 0;
  const requests = new Set();
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const read = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); return true; } catch { return false; } };
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const json = (key, fallback = {}) => { try { const value = JSON.parse(read(key) || 'null'); return record(value) ? value : fallback; } catch { return fallback; } };
  const clone = value => JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function snapshot() {
    const data = {};
    for (const key of keys) {
      const raw = read(key);
      if (raw === null) continue;
      try { data[key] = key === 'espana-util-municipio' ? raw : JSON.parse(raw); } catch { /* damaged local entry */ }
    }
    return data;
  }
  function apply(data) {
    for (const key of keys) write(key, data[key] == null ? null : key === 'espana-util-municipio' ? data[key] : JSON.stringify(data[key]));
  }
  function guest() { return json(guestKey); }
  const validList = value => Array.isArray(value) && value.every(item => record(item) && ['string', 'number'].includes(typeof item.id));
  function validValue(key, value) {
    if (value === null) return true;
    if (lists.includes(key)) return validList(value);
    if (key === 'espana-util-municipio') return typeof value === 'string' && /^\d{5}$/.test(value);
    return record(value);
  }
  function changes(base, value, previous = { add: [], remove: [] }) {
    const before = Array.isArray(base) ? base : [], after = Array.isArray(value) ? value : [];
    const add = new Map(previous.add.map(item => [String(item.id), item])), remove = new Set(previous.remove);
    for (const item of before) if (!after.some(next => String(next.id) === String(item.id))) { add.delete(String(item.id)); remove.add(String(item.id)); }
    for (const item of after) {
      const old = before.find(entry => String(entry.id) === String(item.id));
      if (!old || !equal(old, item)) { add.set(String(item.id), item); remove.delete(String(item.id)); }
    }
    return { add: [...add.values()], remove: [...remove] };
  }
  function readPending(id) {
    const source = json(pendingKey(id)), result = {};
    for (const key of keys) {
      const entry = source[key];
      if (!record(entry) || !validValue(key, entry.value) || !validValue(key, entry.base ?? null)) continue;
      const ops = entry.ops;
      result[key] = { base: entry.base ?? null, value: entry.value,
        revision: typeof entry.revision === 'string' ? entry.revision : JSON.stringify([entry.base ?? null, entry.value]),
        ...(lists.includes(key) ? { ops: record(ops) && validList(ops.add) && Array.isArray(ops.remove) && ops.remove.every(id => typeof id === 'string') ? ops : changes(entry.base, entry.value) } : {}) };
    }
    return result;
  }
  // La respuesta de una escritura antigua no puede borrar una intención nueva
  // guardada por otra pestaña. Sólo se cambia la entrada que todavía coincide.
  function updatePending(id, key, entry, expected) {
    const latest = readPending(id);
    if (expected !== undefined && latest[key]?.revision !== expected) return latest;
    if (entry) latest[key] = entry; else delete latest[key];
    write(pendingKey(id), JSON.stringify(latest));
    return latest;
  }
  function acknowledged(id, remote) {
    const saved = json(ackKey(id)), data = clone(remote), keep = {}, now = Date.now();
    for (const key of keys) {
      const entry = saved[key];
      if (!record(entry) || !validValue(key, entry.value) || !(entry.until > now && entry.until <= now + 60000) || equal(remote[key] ?? null, entry.value)) continue;
      keep[key] = entry; data[key] = entry.value;
    }
    write(ackKey(id), JSON.stringify(keep));
    return data;
  }
  const current = (gen, id) => gen === generation && user?.sub === id && read(ownerKey) === id;
  // El bloqueo se libera antes de llamar de pull a flush: nunca se anidan.
  const locked = (id, work) => globalThis.navigator?.locks?.request ? navigator.locks.request('eu-cuenta-sync:' + id, work) : work();
  function retry(error, gen, id) {
    if (retryTimer || !current(gen, id) || (error.status && error.status !== 429 && error.status < 500)) return;
    const delay = [1500, 4000, 10000, 30000, 60000][Math.min(retries++, 4)];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (current(gen, id)) refresh();
    }, delay);
    retryTimer?.unref?.();
  }
  function invalidate() {
    generation++; confirmed = false; writing = false; pulling = false; refreshPromise = null;
    clearTimeout(retryTimer); retryTimer = null; retries = 0;
    for (const controller of requests) controller.abort();
  }
  function cache() { if (user && read(ownerKey) === user.sub) { write(cacheKey(user.sub), JSON.stringify(snapshot())); write(baselineKey(user.sub), JSON.stringify(baseline)); } }
  function emit(reason, changedKeys = keys) {
    draw();
    window.dispatchEvent(new CustomEvent('eu:cuenta', { detail: { user, status, reason, keys: changedKeys } }));
  }
  const messages = {
    checking: 'Comprobando sesión…', loading: 'Recuperando tus favoritos…', saved: 'Guardado en tu cuenta',
    saving: 'Guardando cambios…', pending: 'Cambios pendientes. Se reintentará al recuperar la conexión.',
    error: 'No se han podido recuperar tus favoritos. Reintentaremos al recuperar la conexión.',
    guest: 'Sin sesión: se guarda en este navegador.', logoutError: 'No se pudo cerrar la sesión. Inténtalo de nuevo.',
  };
  function draw() {
    if ($('btn-login')) $('btn-login').hidden = !!user;
    if ($('user-menu')) $('user-menu').hidden = !user;
    for (const id of ['user-name', 'user-dropdown-name']) if ($(id)) $(id).textContent = user?.name || user?.email || 'Mi cuenta';
    if ($('user-dropdown-email')) $('user-dropdown-email').textContent = user?.email || '';
    if ($('user-avatar')) $('user-avatar').textContent = (user?.name || user?.email || '').split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toUpperCase();
    if ($('user-save-status')) $('user-save-status').textContent = ({ saved: 'Favoritos guardados', saving: 'Guardando…', loading: 'Recuperando…', pending: 'Pendiente de guardar', error: 'Revisar conexión', logoutError: 'Revisar sesión' })[status] || 'Mi cuenta';
    if ($('user-dropdown-sync')) {
      $('user-dropdown-sync').textContent = messages[status] || '';
      $('user-dropdown-sync').classList.toggle('error', ['error', 'pending', 'logoutError'].includes(status));
    }
    if ($('cuenta-importar')) $('cuenta-importar').hidden = !user || !confirmed || !Object.keys(guest()).some(key => keys.includes(key));
  }
  async function request(path, options = {}, expected) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    requests.add(controller);
    try {
      const result = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options,
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(expected ? { 'X-Account-Id': expected } : {}), ...options.headers }, signal: controller.signal });
      if (!result.ok) { const error = new Error('request_failed'); error.status = result.status; throw error; }
      return await result.json();
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  // A pending list records what this device actually added/removed, relative
  // to its last snapshot. Unchanged old items cannot resurrect remote deletes.
  function reconcile(key, remote, entry) {
    if (!lists.includes(key)) return clone(entry.value);
    const ops = entry.ops || changes(entry.base, entry.value), removed = new Set(ops.remove);
    const result = (Array.isArray(remote) ? remote : []).filter(item => !removed.has(String(item.id)));
    for (const item of ops.add) {
      const index = result.findIndex(value => String(value.id) === String(item.id));
      if (index < 0) result.push(item); else result[index] = item;
    }
    return result;
  }
  function switchUser(next) {
    if (user?.sub === next?.sub) { user = next; return; }
    if (user) cache();
    else if (!read(ownerKey)) write(guestKey, JSON.stringify(snapshot()));
    invalidate();
    user = next; pending = {}; baseline = {};
    if (user) {
      // A different account starts empty until its own response arrives.
      pending = readPending(user.sub);
      baseline = json(baselineKey(user.sub));
      apply(json(cacheKey(user.sub)));
      write(ownerKey, user.sub);
      status = 'loading';
    } else {
      apply(guest()); write(ownerKey, null); status = 'guest';
    }
    emit('account');
  }
  async function pull() {
    if (!user || pulling) return;
    const gen = generation, id = user.sub;
    pulling = true; status = 'loading'; emit('status', []);
    try {
      await locked(id, async () => {
        if (!current(gen, id)) return;
        const response = await request('/api/sync', {}, id);
        if (!current(gen, id)) return;
        if (!record(response.data)) throw new Error('invalid_sync');
        const remote = acknowledged(id, response.data), data = clone(remote);
        baseline = clone(remote); pending = readPending(id);
        for (const key of keys) if (pending[key]) {
          const entry = pending[key], value = reconcile(key, remote[key], entry);
          pending = updatePending(id, key, { ...entry, base: remote[key] ?? null, value }, entry.revision);
          data[key] = pending[key] ? reconcile(key, remote[key], pending[key]) : remote[key];
        }
        apply(data); cache(); confirmed = true;
        status = Object.keys(pending).length ? 'saving' : 'saved'; emit('pull');
      });
    } catch (error) {
      if (!current(gen, id)) return;
      confirmed = false; status = 'error'; emit('status', []);
      retry(error, gen, id);
      if ([401, 409].includes(error.status)) { switchUser(null); refreshPromise = null; }
    } finally { if (gen === generation) pulling = false; }
    if (current(gen, id) && confirmed) await flush();
  }
  async function flush() {
    if (!user || !confirmed || writing || pulling) return;
    const gen = generation, id = user.sub;
    writing = true;
    try {
      await locked(id, async () => {
        if (!current(gen, id)) return;
        pending = readPending(id); baseline = json(baselineKey(id));
        for (const key of keys) {
          while (pending[key] && current(gen, id)) {
            const entry = pending[key], value = reconcile(key, baseline[key], entry);
            status = 'saving'; emit('status', []);
            const body = JSON.stringify(value);
            // Keepalive has a small browser-wide byte quota; large favorite
            // lists use an ordinary request, with the durable queue as fallback.
            await request('/api/sync/' + encodeURIComponent(key), { method: 'PUT', body, keepalive: body.length <= 16000 }, id);
            if (!current(gen, id)) return;
            baseline[key] = value;
            const ack = json(ackKey(id)); ack[key] = { value, until: Date.now() + 60000 }; write(ackKey(id), JSON.stringify(ack));
            pending = updatePending(id, key, null, entry.revision); cache();
          }
        }
        if (current(gen, id)) {
          pending = readPending(id); status = Object.keys(pending).length ? 'saving' : 'saved';
          if (status === 'saved') { clearTimeout(retryTimer); retryTimer = null; retries = 0; }
          emit('saved', []);
        }
      });
    } catch (error) {
      if (!current(gen, id)) return;
      status = 'pending'; emit('status', []);
      retry(error, gen, id);
      if ([401, 409].includes(error.status)) { switchUser(null); refreshPromise = null; }
    } finally {
      if (gen === generation) {
        writing = false;
        if (status === 'saving' && Object.keys(readPending(id)).length) await flush();
      }
    }
  }
  function changed(key) {
    if (!keys.includes(key)) return Promise.resolve();
    if (user && read(ownerKey) !== user.sub) { sharedOwnerChanged(); return refresh(); }
    if (!user) { write(guestKey, JSON.stringify(snapshot())); emit('local', [key]); return Promise.resolve(); }
    const value = snapshot()[key] ?? (lists.includes(key) ? [] : null);
    pending = readPending(user.sub);
    baseline = json(baselineKey(user.sub), baseline);
    const previous = pending[key], base = previous?.base ?? baseline[key] ?? null;
    const entry = { base, value, revision: crypto.randomUUID(),
      ...(lists.includes(key) ? { ops: changes(previous?.value ?? base, value, previous?.ops) } : {}) };
    pending = updatePending(user.sub, key, entry); cache(); status = 'saving'; emit('local', [key]);
    return confirmed ? flush() : pull();
  }
  async function refresh() {
    if (refreshPromise) return refreshPromise;
    const gen = generation;
    const task = (async () => {
      try {
        const response = await request('/api/me');
        if (gen !== generation) return;
        const next = response.user?.sub ? response.user : null;
        if (next?.sub !== user?.sub) switchUser(next);
        else user = next;
        if (user) { if (Object.keys(pending).length && confirmed) await flush(); if (!writing) await pull(); }
        else { status = 'guest'; emit('ready'); }
      } catch { if (gen === generation) { status = user ? 'error' : 'guest'; emit('status', []); } }
    })().finally(() => { if (refreshPromise === task) refreshPromise = null; });
    refreshPromise = task;
    return task;
  }
  function sharedOwnerChanged() {
    // No restaurar aquí el invitado: la otra pestaña ya dejó la copia correcta.
    invalidate(); user = null; pending = {}; baseline = {}; status = 'checking'; emit('account');
  }
  // Do not expose the previous account's working copy while the cookie is checked.
  const previousOwner = read(ownerKey);
  if (previousOwner) { write(cacheKey(previousOwner), JSON.stringify(snapshot())); apply(guest()); write(ownerKey, null); }
  else write(guestKey, JSON.stringify(snapshot()));
  const array = key => { try { const value = JSON.parse(read(key) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  const category = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,59}$/.test(value);
  function serviceFavorite(value) {
    if (!record(value) || typeof value.id !== 'string' || !(/^(?:osm-(?:node|way|relation)-[1-9]\d{0,15}|itv-(?:0[1-9]|[1-4]\d|5[0-2])-(?!0000)\d{4}|gbfs-zaragoza-[a-zA-Z0-9_-]{1,100})$/.test(value.id)) ||
      typeof value.nombre !== 'string' || !value.nombre.trim() || value.nombre.length > 250 || /[\u0000-\u001f\u007f]/.test(value.nombre) || !category(value.categoria) ||
      !Number.isFinite(value.lat) || value.lat < 27 || value.lat > 44 || !Number.isFinite(value.lon) || value.lon < -19 || value.lon > 5) return null;
    if ((value.id.startsWith('itv-')) !== (value.categoria === 'itv')) return null;
    if ((value.id.startsWith('gbfs-zaragoza-')) !== (value.categoria === 'bicis-zaragoza')) return null;
    if (['trafico-cataluna', 'camaras-cataluna', 'farmacias-guardia', 'metro-bilbao'].includes(value.categoria)) return null;
    if (value.categoria === 'bicis-zaragoza' && (value.lat < 41.4 || value.lat > 41.9 || value.lon < -1.2 || value.lon > -0.6)) return null;
    // Sólo coordenadas públicas del lugar elegido; nunca incorporamos GPS, URLs,
    // precios u horarios del visitante a una copia sincronizada.
    return { id: value.id, nombre: value.nombre.trim(), categoria: value.categoria, lat: value.lat, lon: value.lon };
  }
  function serviceFavorites() { return array(serviceStorageName).map(serviceFavorite).filter(Boolean).slice(0, 100); }
  function servicePreferences(value = json(servicePrefsStorageName)) {
    return { version: 1,
      categorias: [...new Set((Array.isArray(value.categorias) ? value.categorias : []).filter(category))].slice(0, 80),
      municipios: [...new Set((Array.isArray(value.municipios) ? value.municipios : []).filter(id => typeof id === 'string' && /^\d{5}$/.test(id)))].slice(0, 12) };
  }
  async function prepareServiceChange() {
    await ready;
    if (read(ownerKey) !== (user?.sub || null)) await refresh();
  }
  async function storeService(key, value) {
    if (!write(key, JSON.stringify(value))) throw new Error('El navegador no permite guardar estos datos.');
    await changed(key);
  }
  const historyKey = () => 'eu-servicios-historial-v1:' + (user?.sub || 'invitado');
  function localHistory() {
    const value = json(historyKey()), now = Date.now();
    const items = (value.enabled === true && Array.isArray(value.items) ? value.items : []).filter(item => record(item) &&
      typeof item.municipio === 'string' && /^\d{5}$/.test(item.municipio) && Array.isArray(item.categorias) && item.categorias.length <= 80 && item.categorias.every(category) &&
      Number.isFinite(item.fecha) && item.fecha <= now && item.fecha > now - 30 * 86400000).slice(0, 20)
      .map(item => ({ municipio: item.municipio, categorias: [...new Set(item.categorias)], fecha: item.fecha }));
    const clean = { enabled: value.enabled === true, items };
    if (read(historyKey()) !== null && !equal(value, clean)) write(historyKey(), JSON.stringify(clean));
    return clean;
  }
  function saveHistory(value) {
    if (!write(historyKey(), JSON.stringify(value))) throw new Error('El navegador no permite guardar el historial.');
    window.dispatchEvent(new CustomEvent('eu:servicios-historial', { detail: { enabled: value.enabled } }));
  }
  const servicios = {
    favoritos: serviceFavorites,
    esFavorito: id => serviceFavorites().some(item => item.id === id),
    urlFavorito(value) { const item = serviceFavorite(value); return item ? '/cerca?' + new URLSearchParams({ lat: String(item.lat), lon: String(item.lon), servicio: item.id, categorias: item.categoria }) : null; },
    async alternarFavorito(value) {
      await prepareServiceChange();
      const item = serviceFavorite(value); if (!item) throw new Error('Este lugar no tiene datos válidos para guardarlo.');
      const previous = serviceFavorites(), exists = previous.some(entry => entry.id === item.id);
      if (!exists && previous.length >= 100) throw new Error('Puedes guardar hasta 100 lugares. Quita alguno antes de añadir otro.');
      await storeService(serviceStorageName, exists ? previous.filter(entry => entry.id !== item.id) : [...previous, item]);
      return !exists;
    },
    async quitarFavorito(id) { await prepareServiceChange(); await storeService(serviceStorageName, serviceFavorites().filter(item => item.id !== id)); },
    preferencias: servicePreferences,
    async guardarPreferencias(value) { await prepareServiceChange(); const next = servicePreferences(record(value) ? value : {}); await storeService(servicePrefsStorageName, next); return next; },
    historialActivo: () => localHistory().enabled,
    historial: () => localHistory().items,
    async activarHistorial(enabled) { await prepareServiceChange(); const value = localHistory(); saveHistory({ enabled: enabled === true, items: enabled === true ? value.items : [] }); },
    async registrarConsulta(value) {
      await prepareServiceChange(); const history = localHistory();
      if (!history.enabled || !record(value) || typeof value.municipio !== 'string' || !/^\d{5}$/.test(value.municipio)) return;
      const item = { municipio: value.municipio, categorias: servicePreferences(value).categorias, fecha: Date.now() };
      saveHistory({ enabled: true, items: [item, ...history.items.filter(old => old.municipio !== item.municipio || !equal(old.categorias, item.categorias))].slice(0, 20) });
    },
    async borrarHistorial() { await prepareServiceChange(); saveHistory({ enabled: localHistory().enabled, items: [] }); },
  };
  async function exportarDatos() {
    await prepareServiceChange();
    return { version: 1, exportado: new Date().toISOString(), cuenta: user ? { correo: user.email } : null,
      estadoSincronizacion: status, datos: snapshot(), historialLocalServicios: localHistory() };
  }
  function recordatorioItv(value = json(itvKey).recordatorio) {
    if (!record(value) || typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) ||
      typeof value.fecha !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value.fecha) || !Number.isFinite(Date.parse(value.fecha + 'T00:00:00Z')) ||
      new Date(value.fecha + 'T00:00:00Z').toISOString().slice(0, 10) !== value.fecha ||
      typeof value.nombre !== 'string' || !value.nombre.trim() || value.nombre.length > 60 || /[\u0000-\u001f\u007f]/.test(value.nombre)) return null;
    return { id: value.id, fecha: value.fecha, nombre: value.nombre.trim() };
  }
  const itv = {
    recordatorio: recordatorioItv,
    async guardarRecordatorio(value) {
      await prepareServiceChange();
      const item = recordatorioItv({ id: recordatorioItv()?.id || crypto.randomUUID(), fecha: value?.fecha, nombre: value?.nombre?.trim() || 'Mi vehículo' });
      if (!item) throw new Error('Indica una fecha válida y un nombre de hasta 60 caracteres.');
      await storeService(itvKey, { version: 1, recordatorio: item }); return item;
    },
    async borrarRecordatorio() { await prepareServiceChange(); await storeService(itvKey, { version: 1, recordatorio: null }); },
  };
  async function vaciarPreferencias() {
    await prepareServiceChange();
    if (!window.confirm('¿Vaciar los favoritos y ajustes de esta cuenta en España Útil? Se enviará el cambio cuando haya conexión. No cierra la sesión de Google ni cancela las suscripciones de Telegram. El historial de servicios de este navegador también se borrará.')) return false;
    const empty = { gs_favs_v1: [], gs_profile_v1: {}, 'eu-deportes-favoritos-v1': [],
      'eu-mi-dia-v1': { version: 1, visible: [], order: ['tiempo', 'gasolineras', 'deportes', 'farmacias', 'itv', 'politica'] },
      'espana-util-municipio': null, [serviceStorageName]: [], [servicePrefsStorageName]: { version: 1, categorias: [], municipios: [] }, [itvKey]: { version: 1, recordatorio: null } };
    apply(empty); saveHistory({ enabled: false, items: [] });
    await Promise.all(keys.map(changed));
    return true;
  }
  window.EUCuenta = { ready, get user() { return user; }, get status() { return status; }, changed, refresh, servicios, itv, exportarDatos, vaciarPreferencias };

  function closeMenu() { if ($('user-dropdown')) $('user-dropdown').hidden = true; $('btn-user')?.setAttribute('aria-expanded', 'false'); }
  $('btn-user')?.addEventListener('click', () => {
    const menu = $('user-dropdown'); if (!menu) return;
    menu.hidden = !menu.hidden; $('btn-user').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', event => { if (!$('user-menu')?.contains(event.target)) closeMenu(); });
  $('cuenta-exportar')?.addEventListener('click', async () => {
    try {
      const data = await exportarDatos(), url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'espana-util-mis-datos.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if ($('user-dropdown-sync')) $('user-dropdown-sync').textContent = 'No se pudo descargar la copia. Vuelve a intentarlo.'; }
  });
  $('cuenta-vaciar')?.addEventListener('click', async () => {
    $('cuenta-vaciar').disabled = true;
    try { await vaciarPreferencias(); }
    catch { if ($('user-dropdown-sync')) $('user-dropdown-sync').textContent = 'No se pudieron vaciar todos los datos. Comprueba la conexión y vuelve a intentarlo.'; }
    finally { $('cuenta-vaciar').disabled = false; }
  });
  $('btn-logout')?.addEventListener('click', async () => {
    $('btn-logout').disabled = true;
    try {
      await request('/api/auth/logout', { method: 'POST' });
      switchUser(null); closeMenu(); $('btn-login')?.focus();
      window.google?.accounts?.id?.disableAutoSelect();
    } catch { status = 'logoutError'; emit('status', []); }
    finally { $('btn-logout').disabled = false; }
  });
  $('cuenta-importar')?.addEventListener('click', async () => {
    if (!user || !confirmed) return;
    const source = guest(), data = snapshot();
    for (const key of keys) if (source[key] != null) {
      data[key] = lists.includes(key) ? reconcile(key, data[key], { base: [], value: source[key] }) : data[key] ?? source[key];
    }
    apply(data);
    for (const key of keys) if (source[key] != null && !equal(data[key], baseline[key])) changed(key);
    write(guestKey, '{}'); emit('import');
  });
  let gsiPromise, initialized = false, lastFocus;
  function modalMessage(message, error = false) { if ($('login-modal-status')) { $('login-modal-status').textContent = message; $('login-modal-status').classList.toggle('error', error); } }
  function loadGoogle() {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (gsiPromise) return gsiPromise;
    gsiPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
      const timeout = setTimeout(() => fail(), 12000);
      function fail() { clearTimeout(timeout); script.remove(); gsiPromise = null; reject(new Error('google_unavailable')); }
      script.onload = () => { clearTimeout(timeout); window.google?.accounts?.id ? resolve() : fail(); };
      script.onerror = fail; document.head.append(script);
    });
    return gsiPromise;
  }
  function closeModal() { if ($('login-modal')) $('login-modal').hidden = true; lastFocus?.focus(); }
  async function login() {
    lastFocus = document.activeElement; $('login-modal').hidden = false; $('login-modal-close')?.focus();
    if (initialized) return;
    modalMessage('Preparando el acceso seguro con Google…');
    try {
      const config = await request('/api/auth/config');
      if (!config.clientId) throw new Error('not_configured');
      await loadGoogle();
      window.google.accounts.id.initialize({ client_id: config.clientId, ux_mode: 'popup', auto_select: false, itp_support: true,
        callback: async response => {
          if (!response.credential) return;
          modalMessage('Entrando y recuperando tus favoritos…');
          try {
            const result = await request('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: response.credential }) });
            if (!result.user?.sub) throw new Error('invalid_user');
            switchUser(result.user); await pull(); closeModal();
          } catch { modalMessage('No se pudo iniciar sesión. Vuelve a pulsar el botón de Google.', true); }
        } });
      const container = $('gsi-button-container'); container.replaceChildren();
      window.google.accounts.id.renderButton(container, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: Math.max(200, Math.min(280, Math.floor(container.getBoundingClientRect().width))) });
      initialized = true; modalMessage('');
    } catch { modalMessage('No se pudo cargar el acceso a Google. Comprueba la conexión y vuelve a abrir esta ventana.', true); }
  }
  $('btn-login')?.addEventListener('click', login);
  $('login-modal')?.addEventListener('click', event => { if (event.target.getAttribute('data-close') === '1') closeModal(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMenu(); if ($('login-modal') && !$('login-modal').hidden) closeModal(); }
    if (event.key !== 'Tab' || !$('login-modal') || $('login-modal').hidden) return;
    const nodes = [...$('login-modal').querySelectorAll('button:not([disabled]), a, iframe, [tabindex="0"]')].filter(node => node.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('storage', event => {
    if (event.key === ownerKey && user && read(ownerKey) !== user.sub) sharedOwnerChanged();
    if (event.key === ownerKey || event.key === pendingKey(user?.sub)) refresh();
  });
  refresh().finally(resolveReady);
})();
