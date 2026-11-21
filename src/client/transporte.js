import { ahoraParteMetro, metroParteActual, validaParteMetro } from '../../scripts/lib/metro-ui.mjs';

(() => {
  const $ = id => document.getElementById(id), stations = $('mt-stations');
  if (!stations) return;
  const date = value => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value));
  const hour = value => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; };
  let expires = Date.parse(stations.dataset.caduca || ''), evaluated = stations.dataset.evaluadoEn, startedMono = 0, timer, clockTimer, controller, revision = 0;
  const sourceNow = () => ahoraParteMetro(evaluated, startedMono);
  function filter() {
    const query = fold($('mt-search').value); let shown = 0;
    for (const card of stations.children) { card.hidden = !fold(card.querySelector('h2').textContent).includes(query); if (!card.hidden) shown++; }
    $('mt-count').textContent = query ? shown + ' de ' + stations.children.length + ' estaciones' : stations.children.length + ' estaciones';
    $('mt-not-found').hidden = !query || shown !== 0;
  }
  function removePredictions() {
    stations.querySelectorAll('.mt-arrival,.mt-station-notices li').forEach(n => n.remove());
    stations.querySelectorAll('.mt-empty').forEach(n => { n.hidden = false; });
    stations.querySelectorAll('.mt-limit').forEach(n => { n.hidden = true; });
    $('mt-notices').replaceChildren();
  }
  function unavailable(message) { expires = NaN; clearTimeout(clockTimer); removePredictions(); $('mt-status').textContent = message; }
  function prune() {
    clearTimeout(clockTimer);
    const now = sourceNow();
    if (!Number.isFinite(expires) || !Number.isFinite(now) || now >= expires) { unavailable('El parte está pendiente de actualizar. No se muestran llegadas hasta poder comprobarlas.'); return; }
    let next = expires;
    stations.querySelectorAll('.mt-arrival').forEach(row => {
      const time = Date.parse(row.dataset.llegada);
      if (!Number.isFinite(time) || time <= now) row.remove(); else next = Math.min(next, time);
    });
    for (const card of stations.children) {
      const count = card.querySelectorAll('.mt-arrival').length;
      card.querySelector('.mt-empty').hidden = count > 0;
      if (!count) card.querySelector('.mt-limit').hidden = true;
    }
    // Este reloj no espera a la red para retirar una llegada pasada.
    clockTimer = setTimeout(prune, Math.max(1, next - sourceNow()));
  }
  function station(item) {
    const card = node('article', null, 'mt-station'); card.dataset.estacion = item.id;
    const list = node('ol', null, 'mt-arrivals');
    for (const a of item.llegadas) {
      if (Date.parse(a.llegada) <= sourceNow()) continue;
      const row = node('li', null, 'mt-arrival'), text = node('div'); row.dataset.llegada = a.llegada;
      text.append(node('strong', 'Hacia ' + a.destino), node('small', 'Parte de las ' + hour(a.fechaParte)));
      const time = node('time', hour(a.llegada)); time.dateTime = a.llegada; row.append(text, time); list.append(row);
    }
    const empty = node('p', 'Sin próximas llegadas comprobadas. Consulta también la información oficial.', 'mt-empty'); empty.hidden = Boolean(list.children.length);
    const limited = node('p', 'Se muestran las cinco primeras llegadas del parte.', 'mt-limit'); limited.hidden = !item.limitado || !list.children.length;
    const notices = node('ul', null, 'mt-station-notices');
    for (const a of item.avisos) notices.append(node('li', 'La fuente indica que un tren hacia ' + a.destino + ' no para aquí.'));
    card.append(node('h2', item.nombre), list, empty, limited, notices); return card;
  }
  function render(data, started) {
    const now = ahoraParteMetro(data.evaluadoEn, started), expiry = Date.parse(data.caduca);
    if (!Number.isFinite(now)) throw Error('invalid');
    if (!validaParteMetro(data, now)) throw Error('invalid');
    evaluated = data.evaluadoEn; startedMono = started;
    const active = metroParteActual(data, now);
    stations.replaceChildren(...data.items.map(p => station(active ? p : { ...p, llegadas: [], avisos: [] }))); filter();
    $('mt-source-date').textContent = 'Parte: ' + date(data.fechaDatos) + '. Consulta: ' + date(data.consultado) + '.';
    $('mt-directory-date').textContent = 'Catálogo de estaciones: ' + date(data.fechaDirectorio) + '.';
    $('mt-warnings').replaceChildren(...data.warnings.map(w => node('li', w)));
    $('mt-notices').replaceChildren(...(active ? data.avisos.map(a => node('li', 'La fuente indica un tren cancelado hacia ' + a.destino + '.')) : []));
    if (!active) { unavailable('El parte está pendiente de actualizar. No se muestran llegadas hasta poder comprobarlas.'); return; }
    $('mt-status').textContent = (data.estado === 'parcial' ? 'Parte incompleto: se muestran sólo las llegadas comprobadas. ' : '') + 'Parte de CTB del ' + date(data.fechaDatos) + '.';
    expires = expiry; prune();
  }
  async function refresh() {
    clearTimeout(timer); if (document.hidden) return;
    controller?.abort(); controller = new AbortController(); const request = controller, serial = ++revision;
    const started = performance.now(), timeout = setTimeout(() => request.abort(), 15000); $('mt-refresh').disabled = true;
    try {
      const response = await fetch('/api/transporte/metro-bilbao', { cache: 'no-store', signal: request.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw Error('unavailable');
      const data = await response.json(); if (serial !== revision || document.hidden) return; render(data, started);
    } catch { if (serial === revision && !document.hidden) unavailable('No se pueden comprobar las llegadas ahora. Consulta la fuente oficial o vuelve a intentarlo.'); }
    finally { clearTimeout(timeout); if (serial === revision) { $('mt-refresh').disabled = false; if (!document.hidden) timer = setTimeout(refresh, 30000); } }
  }
  function stop() { clearTimeout(timer); controller?.abort(); revision++; $('mt-refresh').disabled = false; }
  $('mt-search').addEventListener('input', filter); $('mt-refresh').addEventListener('click', refresh);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else { prune(); refresh(); } });
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', event => { if (event.persisted) { prune(); refresh(); } });
  filter();
  if (Number.isFinite(expires) && expires > sourceNow()) { prune(); if (!document.hidden) timer = setTimeout(refresh, 30000); }
  else { removePredictions(); refresh(); }
})();
