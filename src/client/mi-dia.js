// Organización personal del portal. Los datos siguen viniendo del servidor;
// aquí solo guardamos el orden y leemos los favoritos que ya usan las secciones.
(() => {
  const key = 'eu-mi-dia-v1';
  const gasKey = 'gs_favs_v1', sportKey = 'eu-deportes-favoritos-v1';
  const modules = ['tiempo', 'gasolineras', 'deportes', 'farmacias', 'itv', 'politica'];
  const names = { tiempo: 'El tiempo', gasolineras: 'Gasolineras', deportes: 'Deportes', farmacias: 'Farmacias de guardia', itv: 'ITV', politica: 'Política' };
  const defaults = () => ({ version: 1, visible: modules.slice(0, 3), order: [...modules] });
  const panel = document.querySelector('[data-mi-dia]');
  const grid = document.getElementById('mi-dia-modulos');
  const status = document.getElementById('mi-dia-estado');
  const organizer = document.getElementById('mi-dia-ajustes');
  const customize = document.getElementById('mi-dia-personalizar');
  const rows = [...document.querySelectorAll('[data-dia-setting]')];
  const cards = [...document.querySelectorAll('[data-dia-module]')];
  const bookmarks = [...document.querySelectorAll('[data-dia-toggle]')];
  if (!panel && !bookmarks.length) return;

  function cleanState(value) {
    if (!value || value.version !== 1) return defaults();
    const valid = list => [...new Set(list.filter(id => modules.includes(id)))];
    return {
      version: 1,
      visible: Array.isArray(value.visible) ? valid(value.visible) : defaults().visible,
      order: Array.isArray(value.order) ? valid([...value.order, ...modules]) : [...modules],
    };
  }
  function readState() {
    try { return cleanState(JSON.parse(localStorage.getItem(key) || 'null')); }
    catch { return defaults(); }
  }
  let state = readState(), unsaved = false;
  const announce = (message, warning = false) => {
    if (!status) return;
    status.classList.toggle('sr-only', !warning);
    status.textContent = message;
  };

  function draw() {
    const focused = document.activeElement;
    for (const button of bookmarks) {
      const id = button.dataset.diaToggle;
      if (!modules.includes(id)) continue;
      const on = state.visible.includes(id);
      button.hidden = false;
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', (on ? 'Quitar ' : 'Añadir ') + names[id] + (on ? ' de Mi día' : ' a Mi día'));
      button.classList.toggle('is-saved', on);
      const label = button.querySelector('[data-dia-toggle-label]');
      if (label) label.textContent = on ? 'Guardado' : 'Guardar';
    }
    if (!panel) return;
    if (customize) customize.hidden = false;
    for (const checkbox of document.querySelectorAll('[data-dia-visible]')) {
      checkbox.checked = state.visible.includes(checkbox.dataset.diaVisible);
    }
    const rowParent = rows[0]?.parentNode;
    for (const [index, id] of state.order.entries()) {
      const card = cards.find(node => node.dataset.diaModule === id);
      if (card && grid) { card.hidden = !state.visible.includes(id); grid.append(card); }
      const row = rows.find(node => node.dataset.diaSetting === id);
      if (row && rowParent) {
        rowParent.append(row);
        const up = row.querySelector('[data-dia-up]'), down = row.querySelector('[data-dia-down]');
        if (up) up.disabled = index === 0;
        if (down) down.disabled = index === state.order.length - 1;
      }
    }
    const empty = document.getElementById('mi-dia-vacio');
    if (empty) empty.hidden = state.visible.length !== 0;
    if (focused && focused !== document.activeElement && focused.isConnected && !focused.disabled) focused.focus();
  }

  function save(message) {
    try { localStorage.setItem(key, JSON.stringify(state)); unsaved = false; announce(message); }
    catch { unsaved = true; announce(message + ' El navegador no permite guardarlo: se mantendrá durante esta visita.', true); }
    draw();
  }
  function setVisible(id, on) {
    if (!modules.includes(id)) return;
    state.visible = on ? [...new Set([...state.visible, id])] : state.visible.filter(item => item !== id);
    save(names[id] + (on ? ' añadido a Mi día.' : ' quitado de Mi día.'));
  }
  for (const button of bookmarks) button.addEventListener('click', () => {
    const id = button.dataset.diaToggle;
    setVisible(id, !state.visible.includes(id));
  });
  for (const checkbox of document.querySelectorAll('[data-dia-visible]')) {
    checkbox.addEventListener('change', () => setVisible(checkbox.dataset.diaVisible, checkbox.checked));
  }
  for (const button of document.querySelectorAll('[data-dia-up], [data-dia-down]')) {
    button.addEventListener('click', () => {
      const up = button.hasAttribute('data-dia-up');
      const id = up ? button.dataset.diaUp : button.dataset.diaDown;
      const from = state.order.indexOf(id), to = from + (up ? -1 : 1);
      if (from < 0 || to < 0 || to >= state.order.length) return;
      [state.order[from], state.order[to]] = [state.order[to], state.order[from]];
      save(names[id] + ' en la posición ' + (to + 1) + '.');
      // Reinsertar un nodo puede perder el foco. Mantenerlo en la misma fila,
      // incluso cuando el botón pulsado acaba de llegar a un extremo.
      const row = rows.find(node => node.dataset.diaSetting === id);
      (button.disabled ? row?.querySelector('button:not(:disabled), input') : button)?.focus();
    });
  }
  for (const button of document.querySelectorAll('[data-dia-reset]')) button.addEventListener('click', () => {
    state = defaults(); save('Mi día vuelve a mostrar el tiempo, gasolineras y deportes.');
    customize?.focus();
  });
  function setOrganizer(open) {
    if (!organizer || !customize) return;
    organizer.hidden = !open;
    customize.setAttribute('aria-expanded', String(open));
    if (open) organizer.querySelector('input, button, a')?.focus();
    else customize.focus();
  }
  customize?.addEventListener('click', () => setOrganizer(organizer?.hidden !== false));
  document.getElementById('mi-dia-listo')?.addEventListener('click', () => setOrganizer(false));
  organizer?.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); setOrganizer(false); }
  });

  function readList(storageKey) {
    try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value : []; }
    catch { return []; }
  }
  function gasFavorites() {
    const seen = new Set();
    return readList(gasKey).flatMap(item => {
      if (!item || !/^\d{1,12}$/.test(String(item.id ?? '')) || seen.has(String(item.id))) return [];
      seen.add(String(item.id));
      const provincia = String(item.provinciaId || '');
      const validProvince = /^\d{2}$/.test(provincia) && Number(provincia) >= 1 && Number(provincia) <= 52;
      const params = new URLSearchParams(validProvince ? { prov: provincia, station: String(item.id) } : { action: 'favs' });
      return [{ nombre: [typeof item.rotulo === 'string' && item.rotulo.trim() ? item.rotulo : 'Gasolinera', typeof item.municipio === 'string' ? item.municipio : ''].filter(Boolean).join(' · '), url: '/gasolineras/mapa?' + params }];
    });
  }
  function sportFavorites() {
    const seen = new Set();
    return readList(sportKey).filter(item => {
      if (!item || typeof item.id !== 'string' || typeof item.nombre !== 'string' || typeof item.url !== 'string' || seen.has(item.id)) return false;
      if (!/^\/deportes\/(?:competicion\/|futbol\?|baloncesto\?|motor\?)/.test(item.url)) return false;
      // La misma restricción de enlaces que en Deportes. No interpretar HTML
      // guardado ni aceptar otro origen desde el almacenamiento del navegador.
      try { if (new URL(item.url, location.origin).origin !== location.origin) return false; } catch { return false; }
      seen.add(item.id); return true;
    });
  }
  function drawFavorites(selector, items, emptyText) {
    for (const container of document.querySelectorAll(selector)) {
      container.replaceChildren();
      if (!items.length) {
        const p = document.createElement('p'); p.textContent = emptyText; container.append(p); continue;
      }
      const list = document.createElement('ul');
      for (const item of items.slice(0, 6)) {
        const row = document.createElement('li'), link = document.createElement('a');
        link.href = item.url; link.textContent = item.nombre; row.append(link); list.append(row);
      }
      container.append(list);
      if (items.length > 6) {
        const p = document.createElement('p'); p.textContent = 'Aquí aparecen 6 de tus ' + items.length + ' favoritos. Puedes verlos todos en su sección.'; container.append(p);
      }
    }
  }
  function refreshFavorites() {
    if (!panel) return;
    drawFavorites('[data-dia-gas-favs]', gasFavorites(), 'Guarda una gasolinera en el mapa y aparecerá también aquí.');
    drawFavorites('[data-dia-sport-favs]', sportFavorites(), 'Pulsa Seguir en un equipo, piloto o competición de Deportes para tenerlo aquí.');
  }
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) { state = readState(); draw(); }
    if ([gasKey, sportKey, null].includes(event.key)) refreshFavorites();
  });
  window.addEventListener('pageshow', () => { if (!unsaved) state = readState(); draw(); refreshFavorites(); });
  window.addEventListener('focus', refreshFavorites);
  draw(); refreshFavorites();
})();
