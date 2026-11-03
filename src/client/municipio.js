// Preferencia local y búsqueda progresiva: el formulario también funciona sin JS.
(() => {
  const key = 'espana-util-municipio';
  const form = document.getElementById('municipio-form');
  if (!form) return;
  const input = form.querySelector('input'), list = document.getElementById('municipio-resultados');
  const chip = document.getElementById('municipio-elegido'), block = document.querySelector('[data-localidad]');
  const forget = document.getElementById('localidad-olvidar');
  let saved = '', timer, request;
  try { saved = localStorage.getItem(key) || ''; } catch { /* almacenamiento desactivado */ }
  const selected = block?.dataset.localidad;
  const ine = selected || saved;
  if (/^\d{5}$/.test(ine)) {
    if (selected) { try { localStorage.setItem(key, selected); } catch { /* navegación sigue funcionando */ } }
    fetch('/api/localidad/' + ine).then(r => { if (!r.ok) throw Error(); return r.json(); }).then(m => {
      chip.href = '/?municipio=' + ine; chip.textContent = 'Tu municipio: ' + m.nombre; chip.hidden = false;
      if (block && !selected && !new URL(location.href).searchParams.has('q')) {
        document.getElementById('localidad-titulo').textContent = 'Tu municipio: ' + m.nombre;
        document.getElementById('localidad-info').textContent = m.provinciaNombre;
        const cards = document.getElementById('localidad-servicios');
        cards.replaceChildren(...m.servicios.map(s => {
          const a = document.createElement('a'), title = document.createElement('strong'), detail = document.createElement('span');
          a.href = s.url; title.textContent = s.titulo; detail.textContent = s.detalle; a.append(title, detail); return a;
        }));
      }
      if (forget) forget.hidden = false;
    }).catch(() => { /* Los enlaces y la búsqueda del servidor siguen disponibles. */ });
  }
  forget?.addEventListener('click', () => { try { localStorage.removeItem(key); } catch { /* sin almacenamiento */ } location.assign('/'); });
  input.addEventListener('input', () => {
    clearTimeout(timer); request?.abort(); list.replaceChildren();
    if (input.value.trim().length < 2) return;
    timer = setTimeout(async () => {
      const controller = new AbortController(); request = controller;
      try {
        const r = await fetch('/api/localidades?q=' + encodeURIComponent(input.value.trim()), { signal: controller.signal });
        if (!r.ok) return;
        const all = await r.json();
        if (controller.signal.aborted) return;
        list.replaceChildren(...all.map(m => { const li = document.createElement('li'), a = document.createElement('a'); a.href = '/?municipio=' + m.ine; a.textContent = m.nombre + ' · ' + m.provinciaNombre; li.append(a); return li; }));
      } catch { /* Enter envía el formulario si no hay conexión para sugerencias. */ }
    }, 250);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { request?.abort(); clearTimeout(timer); list.replaceChildren(); } });
})();
