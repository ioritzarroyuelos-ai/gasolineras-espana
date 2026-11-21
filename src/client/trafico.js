import { plazoServicio, restanteServicio, vigenteServicio } from '../../scripts/lib/servicios-ui.mjs';

(() => {
  const $ = id => document.getElementById(id), results = $('tf-results');
  if (!results) return;
  const date = value => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const node = (tag, text, className) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (className) n.className = className; return n; };
  function deadline(data, wall, mono) {
    const published = Date.parse(data.fechaDatos), evaluated = Date.parse(data.evaluadoEn), expiry = Date.parse(data.caduca);
    if (![published, evaluated, expiry].every(Number.isFinite) || published > evaluated || expiry - published !== 600000) return null;
    return plazoServicio(data.caduca, data.evaluadoEn, wall, mono);
  }
  // performance.timeOrigin/0 corresponde al inicio de esta navegación, no a
  // cuando termina de llegar el HTML. También descuenta una descarga SSR lenta.
  let expires = results.hidden ? null : deadline({ caduca: results.dataset.caduca, fechaDatos: results.dataset.fechaDatos, evaluadoEn: results.dataset.evaluadoEn }, performance.timeOrigin, 0), timer, expiryTimer, controller, revision = 0;
  function unavailable(text) { results.hidden = true; $('tf-unlocated-link').hidden = true; $('tf-status').textContent = text; }
  function expire() {
    clearTimeout(expiryTimer);
    if (!vigenteServicio(expires)) {
      unavailable('El parte está pendiente de actualizar. Se han ocultado las incidencias hasta poder comprobarlas.'); return;
    }
    expiryTimer = setTimeout(expire, Math.max(1, restanteServicio(expires)));
  }
  function card(item) {
    const article = node('article', null, 'tf-card'); article.dataset.incidencia = item.id;
    article.append(node('p', [item.carretera, item.tipo].filter(Boolean).join(' · ') || 'Incidencia publicada', 'tf-kind'), node('h3', item.nombre), node('p', item.descripcion));
    const original = node('p', 'Fecha original de la incidencia: ', 'tf-date'), time = node('time', date(item.fechaIncidencia));
    time.dateTime = item.fechaIncidencia; original.append(time, document.createTextNode('.')); article.append(original);
    article.append(node('p', item.lat === null || item.lon === null ? 'Sin un punto comprobable en el mapa. Consulta la carretera y los kilómetros indicados por el SCT.' : 'Punto de referencia del SCT; no representa todo el tramo afectado.', 'tf-note'));
    return article;
  }
  function render(data, wall, mono) {
    const next = deadline(data, wall, mono);
    if (!Array.isArray(data.items) || data.items.length > 2000) throw Error('invalid');
    if (data.estado !== 'actual' || !vigenteServicio(next)) { expires = null; expire(); return; }
    for (const p of data.items) {
      if (!/^sct-\d{1,16}$/.test(p.id) || typeof p.nombre !== 'string' || typeof p.descripcion !== 'string' || !Number.isFinite(Date.parse(p.fechaIncidencia))) throw Error('invalid');
    }
    const located = data.items.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)), unlocated = data.items.filter(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon));
    $('tf-located').replaceChildren(...located.map(card)); $('tf-unlocated').replaceChildren(...unlocated.map(card));
    $('tf-located-count').textContent = '(' + located.length + ')'; $('tf-unlocated-count').textContent = '(' + unlocated.length + ')';
    $('tf-unlocated-link').textContent = unlocated.length + ' sin punto en el mapa'; $('tf-unlocated-link').hidden = false;
    $('tf-status').textContent = data.items.length + ' incidencias publicadas por el SCT. Parte actualizado el ' + date(data.fechaDatos) + '.';
    $('tf-source-date').textContent = 'Fecha del parte: ' + date(data.fechaDatos) + '. Consulta: ' + date(data.consultado) + '.';
    expires = next; results.dataset.caduca = data.caduca; results.hidden = false; expire();
  }
  async function refresh() {
    clearTimeout(timer);
    if (document.hidden) return;
    controller?.abort(); controller = new AbortController(); const request = controller, serial = ++revision;
    const startedWall = Date.now(), startedMono = performance.now();
    const timeout = setTimeout(() => request.abort(), 15000); $('tf-refresh').disabled = true;
    try {
      const response = await fetch('/api/trafico/cataluna', { cache: 'no-store', signal: request.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw Error('unavailable');
      const data = await response.json();
      if (serial !== revision || document.hidden) return;
      render(data, startedWall, startedMono);
    } catch {
      if (serial === revision && !document.hidden) unavailable('No se puede comprobar el tráfico ahora. Esto no significa que las carreteras estén libres. Consulta la fuente oficial o vuelve a intentarlo.');
    } finally {
      clearTimeout(timeout);
      if (serial === revision) { $('tf-refresh').disabled = false; if (!document.hidden) timer = setTimeout(refresh, 60000); }
    }
  }
  function stop() { clearTimeout(timer); controller?.abort(); revision++; $('tf-refresh').disabled = false; }
  $('tf-refresh').addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else { expire(); refresh(); } });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', event => { if (event.persisted) { expire(); refresh(); } });
  expire();
  if (!vigenteServicio(expires)) refresh(); else timer = setTimeout(refresh, 60000);
})();
