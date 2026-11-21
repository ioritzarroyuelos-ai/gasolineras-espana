import { APARCAMIENTOS_MAPA, preparaParteAparcamientos, aparcamientoActual, formateaHorarioAparcamiento, cumpleFiltrosAparcamiento } from '../../scripts/lib/aparcamientos-ui.mjs';
import { enlacesServicio, distanciaServicio, restanteServicio } from '../../scripts/lib/servicios-ui.mjs';

export function crearAparcamientosMapa({ el, link, button, favoriteButton, availabilityButton, focusPoi, reference, originLabel, changed, active }) {
  const sources = new Map(), failures = new Set(), pending = new Map();
  let expiryTimer;
  const definition = city => APARCAMIENTOS_MAPA.find(f => f.ciudad === city);
  const current = poi => aparcamientoActual(poi, failures.has(poi.fuenteId));
  const date = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'sin fecha confirmada';
  function schedule() {
    clearTimeout(expiryTimer);
    const waits = [...sources].filter(([city]) => active(city)).flatMap(([, data]) => data.items.map(p => restanteServicio(p._plazo))).filter(t => t > 0);
    if (waits.length) expiryTimer = setTimeout(() => { changed(); schedule(); }, Math.min(...waits) + 5);
  }
  async function fetchCity(city) {
    if (!definition(city)) throw Error('unknown_parking_city');
    if (!pending.has(city)) {
      const inicioWall = Date.now(), inicioMono = performance.now(), controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const job = (async () => {
        const response = await fetch('/api/aparcamientos/' + city, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
        if (!response.ok) throw Error('parking_unavailable');
        return preparaParteAparcamientos(await response.json(), city, inicioWall, inicioMono);
      })().catch(error => {
        // Este aborto es un tiempo de espera propio, no una navegación del
        // visitante. El mapa debe avisar de la fuente fallida, no de cero filas.
        if (controller.signal.aborted) throw Error('parking_timeout');
        throw error;
      }).finally(() => { clearTimeout(timer); pending.delete(city); });
      pending.set(city, job);
    }
    return pending.get(city);
  }
  function accept(data, records) {
    sources.set(data.fuenteId, data); failures.delete(data.fuenteId);
    for (const [id, poi] of records) if (poi.proveedor === 'aparcamientos-oficiales' && poi.fuenteId === data.fuenteId) records.delete(id);
    for (const item of data.items) records.set(item.id, item);
    schedule();
  }
  function fail(city) { failures.add(city); schedule(); }
  function appendSources(box, selected) {
    for (const source of APARCAMIENTOS_MAPA.filter(f => selected.has(f.id))) {
      const data = sources.get(source.ciudad);
      box.append(el('p', source.nombre));
      if (data) {
        box.append(el('p', data.items.filter(current).length + ' de ' + data.total + ' aparcamientos tienen una cifra de plazas libres vigente. Lectura de ocupación: ' + date(data.consultado) + '. Catálogo consultado: ' + date(data.catalogoConsultado) + '.'));
        if (data.catalogoConsultado === null || Date.parse(data.evaluadoEn) - Date.parse(data.catalogoConsultado) >= 30 * 3600000) box.append(el('p', 'El catálogo de detalles está pendiente de actualizar. Las plazas libres se comprueban por separado con la fecha de cada parte.', 'sv-warning'));
        if (data.items.some(p => p.lat === null)) box.append(el('p', 'Las fichas sin ubicación comprobable aparecen sólo en la lista, sin pin ni ruta.', 'sv-help'));
      }
      if (failures.has(source.ciudad) || data?.consultado === null) box.append(el('p', 'No se ha podido comprobar la ocupación. Se conserva la ficha sin cifras de plazas libres.', 'sv-warning'));
      box.append(el('p', 'Las cifras pueden cambiar durante el trayecto. PMR indica capacidad reservada, no plazas libres. Los filtros de apertura, gratuidad y accesibilidad excluyen estas fichas porque la fuente no confirma esos datos.'));
      box.append(link('Fuente oficial · ' + (source.ciudad === 'madrid' ? 'Madrid' : 'Vigo'), source.fuenteUrl), link(source.atribucion, source.licenciaUrl));
    }
  }
  function details(poi, popup = false) {
    const source = definition(poi.fuenteId), card = el(popup ? 'div' : 'article', null, popup ? 'sv-popup' : 'sv-card');
    card.dataset.servicio = poi.id;
    card.append(el('p', 'Aparcamiento · fuente municipal', 'sv-kind'), el('h3', poi.nombre));
    const distance = distanciaServicio(reference(), poi);
    if (distance !== null) card.append(el('p', (distance < 1 ? Math.round(distance * 1000) + ' m' : distance.toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' km') + ' ' + originLabel() + ' · en línea recta', 'sv-meta'));
    if (poi.direccion) card.append(el('p', poi.direccion));
    if (current(poi)) {
      card.append(el('p', poi.plazasLibres + ' plazas libres', 'sv-parking-availability'));
      if (poi.plazasLibres === 0) card.append(el('p', 'Sin plazas libres según este parte. No significa que esté cerrado.', 'sv-meta'));
      card.append(el('p', 'Ocupación comunicada: ' + date(poi.fechaOcupacion) + '. Puede cambiar durante el trayecto.', 'sv-meta'));
    } else card.append(el('p', 'Plazas libres sin confirmar. Consulta la fuente antes de desplazarte.', 'sv-warning'));
    if (poi.capacidad !== null) card.append(el('p', 'Capacidad total: ' + poi.capacidad + ' plazas.'));
    if (poi.plazasPmr !== null) card.append(el('p', 'Plazas reservadas para movilidad reducida (PMR): ' + poi.plazasPmr + ' en total. No se conoce cuántas están libres.', 'sv-meta'));
    if (poi.horarioTexto) card.append(el('p', 'Horario publicado: ' + formateaHorarioAparcamiento(poi.horarioTexto), 'sv-meta'));
    card.append(el('p', 'Apertura, gratuidad, accesibilidad y reservas sin confirmar.', 'sv-meta'));
    if (poi.detalleConsultado) card.append(el('p', 'Detalles consultados: ' + date(poi.detalleConsultado) + '. Esta es la fecha de consulta, no la de edición del aparcamiento.', 'sv-meta'));
    const actions = el('div', null, 'sv-actions'), directions = enlacesServicio(poi);
    if (directions) {
      actions.append(link('Google Maps', directions.google), link('Apple Maps', directions.apple), link('Waze', directions.waze), favoriteButton(poi));
      if (!popup) actions.append(button('Ver en el mapa', () => focusPoi(poi)));
    } else card.append(el('p', 'Ubicación sin comprobar: esta ficha no tiene pin ni indicaciones para llegar.', 'sv-warning'));
    actions.append(link('Fuente oficial del aparcamiento', source.fuenteUrl));
    const alert = availabilityButton?.(poi); if (alert) actions.append(alert);
    card.append(actions);
    return card;
  }
  return { fetch: fetchCity, accept, fail, appendSources, details, schedule,
    matches: (poi, filtros) => cumpleFiltrosAparcamiento(poi, filtros, current(poi)),
  };
}
