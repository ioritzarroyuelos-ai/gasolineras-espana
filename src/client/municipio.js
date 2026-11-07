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
  if (form) form.action = destination;
  let saved = '', timer, request;
  try { saved = localStorage.getItem(key) || ''; } catch { /* almacenamiento desactivado */ }
  const selected = block?.dataset.localidad || '';
  const ine = selected || saved;

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
  if (/^\d{5}$/.test(ine)) {
    if (selected) {
      try { localStorage.setItem(key, selected); }
      catch { storageNotice('El navegador no permite recordar tu municipio. Puedes seguir consultándolo en esta página.'); }
    }
    fetch('/api/localidad/' + ine).then(async response => {
      if (!response.ok) {
        if (response.status === 404 && !selected) { try { localStorage.removeItem(key); } catch { /* preferencia no válida */ } }
        throw Error();
      }
      return response.json();
    }).then(m => {
      if (m.ine !== ine || typeof m.nombre !== 'string') return;
      if (chip) {
        chip.href = townUrl(ine); chip.textContent = 'Tu municipio: ' + m.nombre;
        chip.setAttribute('aria-label', chip.textContent); chip.dataset.municipioNombre = m.nombre; chip.hidden = false;
      }
      if (forget) forget.hidden = false;
      // No sustituir el HTML con datos parciales ni redirigir una búsqueda:
      // el servidor vuelve a verificar las fechas de los seis bloques.
      if ((home || personal) && !selected && !here.searchParams.has('municipio') && !here.searchParams.has('q')) {
        location.replace(townUrl(ine));
      }
    }).catch(() => { /* Los enlaces y la búsqueda del servidor siguen disponibles. */ });
  }
  forget?.addEventListener('click', () => {
    try { localStorage.removeItem(key); }
    catch { storageNotice('El navegador no permite cambiar esta preferencia. No se ha olvidado el municipio.'); return; }
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
