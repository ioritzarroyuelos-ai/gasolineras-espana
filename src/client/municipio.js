// Una sola preferencia municipal para todo el portal. El formulario conserva
// su alternativa HTML y cada dato personalizado se vuelve a leer en servidor.
(() => {
  const key = 'espana-util-municipio';
  const form = document.getElementById('municipio-form');
  const input = form?.querySelector('input'), list = document.getElementById('municipio-resultados');
  const chip = document.getElementById('municipio-elegido'), block = document.querySelector('[data-localidad]');
  const forget = document.getElementById('localidad-olvidar');
  const here = new URL(location.href);
  const personal = /^\/mi-dia\/?$/.test(here.pathname);
  const home = here.pathname === '/';
  const destination = personal ? '/mi-dia' : '/';
  // Los visitantes que ya tienen el mapa instalado pueden conservar un SW
  // antiguo. Comprobar su actualización sin registrar otro ni recargar la página.
  if ((home || personal) && 'serviceWorker' in navigator) {
    const updateWorker = () => {
      try {
        if (!navigator.serviceWorker.controller) return;
        navigator.serviceWorker.getRegistration().then(registration => registration?.update()).catch(() => {});
      } catch { /* Una actualización fallida no impide usar el portal. */ }
    };
    if (document.readyState === 'complete') updateWorker();
    else window.addEventListener('load', updateWorker, { once: true });
  }
  if (form) form.action = destination;
  let timer, request, townRequest = 0, initialized = false, forgetting = false;
  const selected = block?.dataset.localidad || '';
  function savedTown() {
    try { const value = localStorage.getItem(key) || ''; return /^\d{5}$/.test(value) ? value : ''; }
    catch { return ''; }
  }

  function storageNotice(text) {
    let notice = document.getElementById('municipio-estado');
    if (!notice) {
      notice = document.createElement('p'); notice.id = 'municipio-estado'; notice.setAttribute('role', 'status');
      (block || form || chip?.parentNode)?.append(notice);
    }
    notice.textContent = text;
  }

  function townUrl(id) {
    const url = new URL(destination, location.origin);
    url.searchParams.set('municipio', id);
    return url.pathname + url.search;
  }
  function showTown(ine, reconcilePage) {
    const serial = ++townRequest;
    if (chip) chip.hidden = true;
    if (forget) forget.hidden = true;
    if (!/^\d{5}$/.test(ine)) {
      if (reconcilePage && (home || personal) && selected && !here.searchParams.has('q')) location.replace(destination);
      return;
    }
    fetch('/api/localidad/' + ine).then(async response => {
      if (!response.ok) {
        throw Error();
      }
      return response.json();
    }).then(m => {
      if (serial !== townRequest || m.ine !== ine || typeof m.nombre !== 'string') return;
      if (chip) {
        chip.href = townUrl(ine); chip.textContent = 'Tu municipio: ' + m.nombre;
        chip.setAttribute('aria-label', chip.textContent); chip.dataset.municipioNombre = m.nombre; chip.hidden = false;
      }
      if (forget) forget.hidden = false;
      // No sustituir el HTML con datos parciales ni redirigir una búsqueda:
      // el servidor vuelve a verificar las fechas de los seis bloques.
      if (reconcilePage && (home || personal) && selected !== ine && !here.searchParams.has('q')) {
        location.replace(townUrl(ine));
      }
    }).catch(() => { /* Los enlaces y la búsqueda del servidor siguen disponibles. */ });
  }
  // Sólo la selección explícita de la URL inicial se guarda. Una respuesta
  // de la cuenta nunca vuelve a subir la localidad del HTML de otra sesión.
  (async () => {
    await Promise.resolve(window.EUCuenta?.ready).catch(() => {});
    const explicit = here.searchParams.get('municipio');
    if (/^\d{5}$/.test(selected) && explicit === selected) {
      try {
        if (savedTown() !== selected) { localStorage.setItem(key, selected); await window.EUCuenta?.changed(key); }
      } catch { storageNotice('El navegador no permite recordar tu municipio. Puedes seguir consultándolo en esta página.'); }
    }
    initialized = true;
    showTown(explicit === selected && /^\d{5}$/.test(selected) ? selected : savedTown(), !here.searchParams.has('municipio'));
  })();
  window.addEventListener('eu:cuenta', event => {
    if (!initialized || forgetting) return;
    const detail = event.detail || {};
    // Al entrar esperamos a que termine la descarga, no navegamos usando una
    // copia vacía intermedia. Al salir ya se han recuperado las marcas invitadas.
    if (detail.reason === 'pull' || detail.reason === 'import' || (detail.reason === 'account' && !detail.user)) {
      showTown(savedTown(), true);
    }
  });
  window.addEventListener('storage', event => {
    if (initialized && (event.key === key || event.key === null)) showTown(savedTown(), true);
  });
  forget?.addEventListener('click', async () => {
    forgetting = true;
    await Promise.resolve(window.EUCuenta?.ready).catch(() => {});
    try { localStorage.removeItem(key); }
    catch { forgetting = false; storageNotice('El navegador no permite cambiar esta preferencia. No se ha olvidado el municipio.'); return; }
    await window.EUCuenta?.changed(key);
    location.assign(destination);
  });
  if (!input || !list) return;
  input.addEventListener('input', () => {
    clearTimeout(timer); request?.abort(); list.replaceChildren();
    if (input.value.trim().length < 2) return;
    timer = setTimeout(async () => {
      const controller = new AbortController(); request = controller;
      try {
        const response = await fetch('/api/localidades?q=' + encodeURIComponent(input.value.trim()), { signal: controller.signal });
        if (!response.ok) return;
        const all = await response.json();
        if (controller.signal.aborted || !Array.isArray(all)) return;
        list.replaceChildren(...all.filter(m => m && /^\d{5}$/.test(m.ine) && typeof m.nombre === 'string' && typeof m.provinciaNombre === 'string').map(m => {
          const li = document.createElement('li'), a = document.createElement('a');
          a.href = townUrl(m.ine); a.textContent = m.nombre + ' · ' + m.provinciaNombre; li.append(a); return li;
        }));
      } catch { /* Enter envía el formulario si no hay conexión para sugerencias. */ }
    }, 250);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') { request?.abort(); clearTimeout(timer); list.replaceChildren(); }
  });
})();
