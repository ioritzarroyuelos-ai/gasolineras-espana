import { abiertoServicio, distanciaServicio, enlacesServicio, zonasServicios, biciServicioActual, plazoServicio, vigenteServicio, restanteServicio } from '../../scripts/lib/servicios-ui.mjs';
import { servicioTileId } from '../../scripts/lib/servicios.mjs';

// El motor cartográfico y las gasolineras siguen siendo los del mapa original.
// Las consultas públicas llevan cuadrículas; nunca la posición GPS del visitante.
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  };
  const button = (text, handler) => { const b = el('button', text); b.type = 'button'; b.addEventListener('click', handler); return b; };
  const link = (text, href) => {
    const a = el('a', text, 'sv-action'); a.href = href;
    if (/^https:\/\//.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  };
  const safeWeb = value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } };
  const date = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeZone: 'Europe/Madrid' }).format(new Date(value)) : 'sin fecha confirmada';
  const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const glyphs = { banos: 'WC', 'agua-potable': '≈', aparcamientos: 'P', farmacias: '+', 'farmacias-guardia': '+', hospitales: '+', supermercados: 'S', cajeros: '€', parques: '♧', bibliotecas: 'L', playas: '≈', trenes: 'T', autobuses: 'B', metro: 'M', 'parques-infantiles': '☆', 'camaras-cataluna': 'C' };
  const url = new URL(location.href);
  let categories = [], selected = new Set(), records = new Map(), nextPages = new Map(), source = null, itvSource = null, availableZones = [];
  let origin = null, originLabel = 'desde el centro del mapa', town = '', favoritesOnly = url.searchParams.get('favoritos') === '1';
  let revision = 0, controller, mapTimer, searchTimer, searchController, loadKey = '', shown = 60, partial = false, loading = false, fuelMode = false;
  let layer = null, markerById = new Map(), focusedId = url.searchParams.get('servicio') || '', services, navigation = 0, chargingEnabled = false;
  let catalogPromise, lastCatalogCheck = 0;
  let biciSource = null, biciPromise, biciError = false, biciExpiryTimer;
  let trafficSource = null, trafficPromise, trafficError = false, trafficExpiryTimer;
  let cameraSource = null, cameraPromise, cameraError = false;
  let guardiaRound = 0, guardiaExpiryTimer, guardiaRefreshPromise;
  const guardiaSources = new Map(), guardiaRequests = new Map();
  const GUARDIA_CATEGORY = { id: 'farmacias-guardia', nombre: 'Farmacias de guardia · fuentes oficiales', grupo: 'salud', grupoNombre: 'Salud', disponibilidad: true };
  const BICI_CATEGORY = { id: 'bicis-zaragoza', nombre: 'Bizi Zaragoza · bicis y anclajes disponibles', grupo: 'transporte', grupoNombre: 'Transporte público', disponibilidad: true };
  const TRAFFIC_CATEGORY = { id: 'trafico-cataluna', nombre: 'Tráfico en Cataluña · incidencias publicadas', grupo: 'movilidad', grupoNombre: 'Movilidad', disponibilidad: true };
  const CAMERA_CATEGORY = { id: 'camaras-cataluna', nombre: 'Cámaras de tráfico · Cataluña', grupo: 'movilidad', grupoNombre: 'Movilidad', disponibilidad: true };
  const townCache = new Map();
  function townInfo(ine) {
    if (!townCache.has(ine)) townCache.set(ine, json('/api/localidad/' + ine).catch(error => { townCache.delete(ine); throw error; }));
    return townCache.get(ine);
  }
  async function remember() {
    if (town) try { await services?.registrarConsulta({ municipio: town, categorias: chosen() }); }
    catch { notice('La consulta funciona, pero no se pudo guardar en el historial de este navegador.'); }
  }
  const catalogName = id => categories.find(c => c.id === id)?.nombre || id;
  const notice = text => { $('sv-status').textContent = text; };
  const coords = poi => enlacesServicio(poi) !== null;
  const chosen = () => [...selected].sort();
  const osmChosen = () => chosen().filter(id => !['itv', 'bicis-zaragoza', 'trafico-cataluna', 'camaras-cataluna', 'farmacias-guardia'].includes(id));
  const guardiaTurno = () => $('sv-guardias-turno')?.value || 'todas';
  const guardiaCurrent = poi => Number.isFinite(poi._guardiaDeadline) && poi._guardiaDeadline > Date.now() && !guardiaSources.get(poi._guardiaZona)?.failed;
  const trafficCurrent = () => !trafficError && trafficSource?.estado === 'actual' && vigenteServicio(trafficSource._plazo);
  const biciCurrent = poi => !biciError && poi._estadoComprobado === true && vigenteServicio(poi._plazo);
  function osmStale() {
    return !source || source.desactualizado || !Number.isFinite(Date.parse(source.consultado)) || !Number.isFinite(Date.parse(source.fechaDatos)) || Date.now() - Date.parse(source.consultado) > 30 * 3600000 || Date.now() - Date.parse(source.fechaDatos) > 72 * 3600000;
  }
  function mapInstance() { return window.map && typeof window.map.getBounds === 'function' ? window.map : null; }
  function viewport() {
    const m = mapInstance();
    if (m) { const b = m.getBounds(); return { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() }; }
    return origin ? { south: origin.lat - .04, north: origin.lat + .04, west: origin.lon - .04, east: origin.lon + .04 } : null;
  }
  function reference() { const center = mapInstance()?.getCenter(); return origin || (center ? { lat: center.lat, lon: center.lng } : null); }
  function inView(p) { const b = viewport(); return !b || p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east; }
  function osmZones(bounds, bases) {
    if (!availableZones.length) return bases;
    return availableZones.filter(t => bases.includes(t.id.split('.')[0]) && t.bbox[2] > bounds.west && t.bbox[0] <= bounds.east && t.bbox[3] > bounds.south && t.bbox[1] <= bounds.north).map(t => t.id);
  }
  function pointZone(poi) {
    return availableZones.find(t => poi.lon >= t.bbox[0] && poi.lon < t.bbox[2] && poi.lat >= t.bbox[1] && poi.lat < t.bbox[3])?.id || servicioTileId(poi.lat, poi.lon);
  }
  async function json(path, signal) {
    const response = await fetch(path, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) { const error = new Error(response.status === 404 ? 'not_found' : 'unavailable'); error.status = response.status; throw error; }
    return response.json();
  }
  function sourceText() {
    const box = $('sv-source'); box.replaceChildren();
    guardiasSourceText();
    if (source && osmChosen().length) {
      box.append(el('span', 'Directorio consultado: ' + date(source.consultado) + '. Extracto de datos: ' + date(source.fechaDatos) + '. '));
      box.append(link('© OpenStreetMap · ODbL', 'https://www.openstreetmap.org/copyright'));
      if (source.limiteTerritorial?.atribucion) box.append(el('p', source.limiteTerritorial.atribucion));
      box.append(el('p', 'El directorio se comprueba cada día. La fecha de cada lugar indica cuándo se editó su ficha; no certifica sus horarios actuales.'));
      if (osmStale()) box.append(el('p', 'La actualización está pendiente. Comprueba la información con el establecimiento.', 'sv-warning'));
    }
    if (selected.has('itv') && itvSource) {
      box.append(el('p', 'ITV: ' + itvSource.totalConCoordenadas + ' estaciones con coordenadas publicadas de ' + itvSource.totalDirectorio + ' en el directorio. Revisión del catálogo: ' + date(itvSource.generadoEn) + '. Cada ficha conserva la fecha original de sus coordenadas y enlaces.'));
      box.append(link('Ver todas las estaciones ITV', '/itv/'));
    }
    if (selected.has('bicis-zaragoza')) {
      if (biciSource) box.append(el('p', biciSource.total + ' estaciones en la red. Último parte recibido: ' + new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(biciSource.fechaDatos)) + '.'));
      box.append(link('Disponibilidad oficial de Bizi Zaragoza', 'https://bizi.zaragoza.es/es/mapa-de-disponibilidad'));
      box.append(link('Condiciones de reutilización · Ayuntamiento de Zaragoza', 'https://www.zaragoza.es/sede/portal/aviso-legal'));
      box.append(el('p', 'Origen: Ayuntamiento de Zaragoza · Bizi Zaragoza. Las cifras se actualizan mientras consultas esta capa y pueden cambiar durante el trayecto.'));
      if (biciError) box.append(el('p', 'No se ha podido comprobar la disponibilidad. Se han ocultado las cifras anteriores.', 'sv-warning'));
    }
    if (selected.has('trafico-cataluna')) {
      box.append(link('Ver el parte completo de tráfico de Cataluña', '/trafico/cataluna'));
      box.append(el('p', 'Fuente: Servei Català de Trànsit. El mapa sitúa puntos publicados, no representa la longitud de los tramos afectados.'));
      if (trafficCurrent()) box.append(el('p', trafficSource.sinCoordenadas + ' incidencias del parte no tienen coordenadas contrastadas y se conservan en el listado completo. Los filtros de horario, gratuidad y accesibilidad no se aplican al tráfico.'));
      else box.append(el('p', 'No hay un parte reciente comprobable. Esto no significa que las carreteras estén despejadas.', 'sv-warning'));
    }
    if (selected.has('camaras-cataluna')) {
      box.append(link('Directorio oficial de cámaras de Cataluña', 'https://analisi.transparenciacatalunya.cat/Transport/C-meres-de-tr-nsit-a-les-carreteres-de-Catalunya/3tzz-6b9y'));
      if (cameraSource) box.append(el('p', cameraSource.conCoordenadas + ' cámaras con ubicación publicada. Fecha del directorio: ' + date(cameraSource.fechaDirectorio) + '.'));
      box.append(el('p', 'Las imágenes se abren en la fuente original. El catálogo no publica su hora: no podemos confirmar que sean imágenes en directo. Los filtros de horario, gratuidad y accesibilidad no se aplican a las cámaras.'));
      if (cameraError) box.append(el('p', 'No se ha podido revisar el directorio. Consulta la fuente oficial.', 'sv-warning'));
    }
  }
  function updateUrl() {
    const current = new URL(location.href);
    current.searchParams.set('categorias', chosen().join(','));
    if (town) current.searchParams.set('municipio', town); else current.searchParams.delete('municipio');
    if (favoritesOnly) current.searchParams.set('favoritos', '1'); else current.searchParams.delete('favoritos');
    // Las coordenadas de enlaces guardados son lugares públicos, no el GPS.
    if (!focusedId) ['lat', 'lon', 'servicio'].forEach(key => current.searchParams.delete(key));
    history.replaceState(null, '', current.pathname + current.search + current.hash);
  }
  async function saveCategories() {
    try { await services?.guardarPreferencias({ ...services.preferencias(), categorias: chosen() }); }
    catch { notice('Puedes usar estos filtros, pero no se han podido guardar.'); }
  }
  function renderCategories() {
    const box = $('sv-categories'); box.replaceChildren();
    const groups = new Map();
    for (const category of categories.filter(c => c.total > 0 || c.disponibilidad)) {
      let group = groups.get(category.grupo);
      if (!group) { group = el('details'); group.append(el('summary', category.grupoNombre)); groups.set(category.grupo, group); box.append(group); }
      const label = el('label', null, 'sv-category'), input = el('input');
      input.type = 'checkbox'; input.value = category.id; input.checked = selected.has(category.id);
      input.addEventListener('change', () => {
        input.checked ? selected.add(category.id) : selected.delete(category.id);
        navigation++; favoritesOnly = false; focusedId = ''; updateUrl(); syncControls(); saveCategories(); load(true);
        if (input.checked && category.id === 'bicis-zaragoza') chooseTown('50297');
        if (input.checked && ['trafico-cataluna', 'camaras-cataluna'].includes(category.id)) showCataluna();
        remember();
      });
      label.append(input, document.createTextNode(category.nombre)); group.append(label);
    }
    const charging = el('label', null, 'sv-category'), input = el('input'); input.type = 'checkbox'; input.id = 'sv-charging'; input.checked = chargingEnabled;
    charging.append(input, document.createTextNode('Puntos de recarga · registro oficial'));
    input.addEventListener('change', () => {
      chargingEnabled = input.checked;
      if (!chargingEnabled) window.setChargersVisible?.(false);
      else window.loadChargers?.(() => { if (chargingEnabled) window.setChargersVisible?.(true); });
    });
    box.append(charging, el('p', 'Las recargas muestran ubicaciones y características publicadas, no plazas libres en tiempo real.', 'sv-help'));
    syncControls();
  }
  function syncControls() {
    $('sv-category-count').textContent = '(' + selected.size + ')';
    $('sv-favorites').setAttribute('aria-pressed', String(favoritesOnly));
    $('sv-open').disabled = favoritesOnly; $('sv-free').disabled = favoritesOnly; $('sv-accessible').disabled = favoritesOnly;
    $('sv-guardias-control').hidden = !selected.has(GUARDIA_CATEGORY.id) || favoritesOnly;
  }
  function openLabel(poi) {
    if (poi.proveedor === 'guardias-oficiales') {
      if (!guardiaCurrent(poi)) return { open: null, label: 'Estado pendiente de comprobar' };
      return { open: poi.estado === 'activa', label: ({ activa: 'De guardia ahora según el horario oficial', localizada: 'Guardia localizada · llama antes de acudir', por_confirmar: 'Horario de guardia por confirmar', fuera_de_horario: 'Fuera del horario de guardia publicado' })[poi.estado] || 'Estado pendiente de comprobar' };
    }
    if (poi.proveedor === 'gbfs-zaragoza') {
      const actual = biciCurrent(poi);
      return { open: actual ? poi.estado === 'operativa' : null, label: !actual ? 'Disponibilidad sin confirmar' : poi.estado === 'cerrada' ? 'Estación fuera de servicio' : 'Estación operativa según Bizi' };
    }
    const open = osmStale() ? null : abiertoServicio(poi.horario, poi.lat, poi.lon);
    return { open, label: open === true ? 'Abierto según el horario publicado' : open === false ? 'Cerrado según el horario publicado' : 'Horario sin confirmar' };
  }
  function favoriteButton(poi) {
    const active = services?.esFavorito(poi.id) || false;
    const b = button(active ? '★ Guardado' : '☆ Guardar', async () => {
      if (!services) { notice('No se han podido cargar tus preferencias. Recarga la página para guardar este lugar.'); return; }
      b.disabled = true;
      try {
        await services.alternarFavorito({ id: poi.id, nombre: poi.nombre, categoria: poi.categorias?.[0] || poi.categoria, lat: poi.lat, lon: poi.lon });
        const saved = services.esFavorito(poi.id); b.textContent = saved ? '★ Guardado' : '☆ Guardar'; b.setAttribute('aria-pressed', String(saved));
        if (favoritesOnly) render();
      } catch { notice('No se pudo guardar el cambio. Comprueba la conexión y vuelve a intentarlo.'); }
      finally { b.disabled = false; }
    });
    b.setAttribute('aria-pressed', String(active)); b.setAttribute('aria-label', (active ? 'Quitar de favoritos: ' : 'Guardar favorito: ') + poi.nombre);
    return b;
  }
  function details(poi, popup = false) {
    if (poi.proveedor === 'guardias-oficiales') return guardiaDetails(poi, popup);
    if (poi.proveedor === 'sct') return trafficDetails(poi, popup);
    if (poi.proveedor === 'camara-sct') return cameraDetails(poi, popup);
    const card = el(popup ? 'div' : 'article', null, popup ? 'sv-popup' : 'sv-card'); card.dataset.servicio = poi.id;
    card.append(el('p', (poi.categorias || [poi.categoria]).map(catalogName).join(' · '), 'sv-kind'), el('h3', poi.nombre));
    const distance = distanciaServicio(reference(), poi);
    if (distance !== null) card.append(el('p', (distance < 1 ? Math.round(distance * 1000) + ' m' : distance.toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' km') + ' ' + originLabel + ' · en línea recta', 'sv-meta'));
    if (poi.direccion || poi.municipio) card.append(el('p', [poi.direccion, poi.cp, poi.municipio].filter(Boolean).join(' · ')));
    if (poi.categorias) {
      const { label } = openLabel(poi); card.append(el('p', label, 'sv-badge'));
      if (poi.horario) card.append(el('p', poi.horario, 'sv-meta'));
      const terms = [];
      if (poi.gratis === true) terms.push('Gratuito según la ficha'); else if (poi.gratis === false) terms.push('De pago');
      if (poi.accesible === 'si') terms.push('Acceso en silla de ruedas indicado');
      else if (poi.accesible === 'limitado') terms.push('Accesibilidad limitada');
      else if (poi.accesible === 'no') terms.push('No accesible en silla de ruedas');
      if (poi.acceso === 'clientes') terms.push('Uso para clientes');
      if (poi.acceso === 'desconocido') terms.push('Condiciones de acceso sin confirmar');
      if (terms.length) card.append(el('p', terms.join(' · '), 'sv-meta'));
      if (poi.ubicacion === 'recinto') card.append(el('p', 'Punto dentro del recinto; puede no coincidir con la entrada.', 'sv-meta'));
      if (poi.categorias.includes('farmacias')) card.append(el('p', 'Esta ficha no confirma una guardia.', 'sv-warning'), link('Consultar guardias oficiales', '/farmacias/guardia'));
      if (poi.categorias.includes('urgencias') || poi.categorias.includes('desfibriladores')) card.append(el('p', 'El mapa no confirma disponibilidad inmediata. Emergencias: 112.', 'sv-warning'));
      if (poi.proveedor === 'itv-oficial') {
        card.append(el('p', 'Dirección comprobada: ' + date(poi.verificadoEn) + '. Coordenadas publicadas por ' + poi.coordenadas.fuente + ', comprobadas el ' + date(poi.coordenadas.verificadoEn) + '.', 'sv-meta'));
        if (poi.desactualizado) card.append(el('p', 'Parte de esta ficha conserva datos anteriores. Confirma con la estación antes de desplazarte.', 'sv-warning'));
      }
      if (poi.proveedor === 'gbfs-zaragoza') {
        const actual = biciCurrent(poi);
        if (actual) {
          card.append(el('p', poi.permiteAlquiler ? poi.bicis + ' bicicletas disponibles' : 'No se pueden retirar bicicletas ahora'));
          card.append(el('p', poi.permiteDevolucion ? poi.anclajes + ' anclajes libres para devolver' : 'No se pueden devolver bicicletas ahora'));
          card.append(el('p', 'Estado comunicado a las ' + new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(poi.actualizado)) + '. Puede cambiar durante el trayecto.', 'sv-meta'));
        } else card.append(el('p', 'No hay cifras recientes comprobables. Consulta el servicio Bizi antes de desplazarte.', 'sv-warning'));
      }
    } else card.append(el('p', 'Lugar guardado. Abre su ficha para comprobar los datos más recientes.', 'sv-meta'));
    const actions = el('div', null, 'sv-actions');
    const directions = enlacesServicio(poi);
    if (directions) actions.append(link('Google Maps', directions.google), link('Apple Maps', directions.apple), link('Waze', directions.waze));
    if (/^\+?[\d\s()-]{6,30}$/.test(poi.telefono || '')) actions.append(link('Llamar', 'tel:' + poi.telefono.replace(/[^\d+]/g, '')));
    const web = safeWeb(poi.web); if (web) actions.append(link('Web del servicio', web));
    if (poi.proveedor === 'itv-oficial') {
      if (/^\/itv\//.test(poi.directorioUrl)) actions.append(link('Ficha completa de ITV', poi.directorioUrl));
      if (safeWeb(poi.cita?.url)) actions.append(link(poi.cita.desactualizada ? 'Consultar cita · enlace pendiente de revisar' : 'Pedir cita en la web oficial', poi.cita.url));
      if (safeWeb(poi.tarifas?.url)) actions.append(link(poi.tarifas.desactualizada ? 'Consultar tarifas · revisión pendiente' : 'Tarifas oficiales', poi.tarifas.url));
    }
    if (poi.proveedor === 'gbfs-zaragoza') actions.append(link('Consultar Bizi y sus condiciones', 'https://bizi.zaragoza.es/es/mapa-de-disponibilidad'));
    actions.append(favoriteButton(poi));
    if (!popup) actions.append(button(poi.categorias ? 'Ver en el mapa' : 'Abrir ficha', () => focusPoi(poi)));
    card.append(actions);
    if (poi.categorias) {
      if (poi.proveedor === 'itv-oficial') {
        if (safeWeb(poi.fuenteUrl)) card.append(link('Fuente: ' + poi.fuenteNombre, poi.fuenteUrl));
      } else if (poi.proveedor !== 'gbfs-zaragoza') {
        card.append(el('p', 'Ficha editada: ' + date(poi.fechaEdicion), 'sv-meta'));
        if (/^https:\/\/www\.openstreetmap\.org\/(node|way|relation)\/\d+$/.test(poi.fuenteUrl || '')) card.append(link('Ver fuente o comunicar un error', poi.fuenteUrl));
      }
    }
    return card;
  }
  function filteredRecords() {
    if (favoritesOnly) return (services?.favoritos() || []).filter(coords);
    return [...records.values()].filter(p => p.categorias?.some(id => selected.has(id)) && inView(p)
      && (p.proveedor !== 'guardias-oficiales' || guardiaTurno() === 'todas' || guardiaCurrent(p) && p.estado === 'activa' && (guardiaTurno() !== '24h' || p.todoElDia))
      && (p.proveedor === 'sct' ? trafficCurrent() : p.proveedor === 'camara-sct' || (!$('sv-open').checked || openLabel(p).open === true) && (!$('sv-free').checked || p.gratis === true) && (!$('sv-accessible').checked || p.accesible === 'si')));
  }
  function render() {
    const items = filteredRecords(), ref = reference();
    items.sort((a, b) => (distanciaServicio(ref, a) ?? Infinity) - (distanciaServicio(ref, b) ?? Infinity) || a.nombre.localeCompare(b.nombre, 'es'));
    const box = $('sv-results'); box.replaceChildren();
    items.slice(0, shown).forEach(p => box.append(details(p)));
    $('sv-more').hidden = favoritesOnly || (shown >= items.length && !nextPages.size);
    $('sv-more').disabled = loading;
    if (favoritesOnly) notice(items.length ? items.length + ' lugares guardados. Abre una ficha para comprobar su información actual.' : 'Todavía no tienes lugares guardados. Pulsa la estrella de una ficha para añadirla aquí.');
    else if (loadKey) notice((items.length ? items.length + ' lugares cargados dentro del mapa' : 'No hay coincidencias entre los lugares cargados') + (partial || nextPages.size ? '. La lista está incompleta: carga más o acerca el mapa.' : '. El directorio puede no recoger todos los lugares.') + (loading ? ' Cargando…' : ''));
    if (items.length > shown) box.append(el('p', 'Mostrando ' + shown + ' de ' + items.length + ' lugares cargados.', 'sv-meta'));
    const m = mapInstance();
    if (!m || !window.L) return;
    if (!layer) {
      layer = window.L.markerClusterGroup({ maxClusterRadius: 45, showCoverageOnHover: false, iconCreateFunction: cluster => window.L.divIcon({ className: 'sv-cluster', html: String(cluster.getChildCount()), iconSize: [40, 40] }) });
      m.addLayer(layer);
    }
    const visibleIds = new Set(items.map(p => p.id));
    for (const [id, marker] of markerById) if (!visibleIds.has(id)) { layer.removeLayer(marker); markerById.delete(id); }
    for (const poi of items) {
      const existing = markerById.get(poi.id);
      if (existing) {
        const point = existing.getLatLng();
        if (point.lat !== poi.lat || point.lng !== poi.lon) existing.setLatLng([poi.lat, poi.lon]);
        if (existing.isPopupOpen()) existing.setPopupContent(details(poi, true));
        continue;
      }
      const category = poi.categorias?.[0] || poi.categoria;
      const marker = window.L.marker([poi.lat, poi.lon], { title: poi.nombre, icon: window.L.divIcon({ className: 'sv-pin' + (poi.proveedor === 'sct' ? ' sv-pin-traffic' : ''), html: poi.proveedor === 'sct' ? '!' : glyphs[category] || '•', iconSize: [38, 38], iconAnchor: [19, 19] }) });
      marker.bindPopup(() => details(records.get(poi.id) || poi, true)); layer.addLayer(marker); markerById.set(poi.id, marker);
    }
    if (focusedId && markerById.has(focusedId)) { const marker = markerById.get(focusedId); layer.zoomToShowLayer(marker, () => marker.openPopup()); focusedId = ''; }
  }
  async function fetchPages(pages, signal, serial, round = guardiaRound) {
    const work = [...pages], visited = new Set(pages.map(([zone]) => zone)); let failed = 0;
    async function worker() {
      while (work.length && !signal.aborted) {
        const [zone, page] = work.shift();
        try {
          const itv = zone.startsWith('itv:');
          const bike = zone === 'gbfs:zaragoza';
          const traffic = zone === 'sct:cataluna';
          const camera = zone === 'camaras:cataluna';
          const guardia = zone.startsWith('guardias:');
          const data = guardia ? await fetchGuardias(zone.slice(9), page, signal, serial, round) : bike ? await fetchBicis() : traffic ? await fetchTraffic() : camera ? await fetchCameras() : await json(itv ? '/api/servicios/itv?zona=' + zone.slice(4) : '/api/servicios?zona=' + zone + '&categorias=' + encodeURIComponent(osmChosen().join(',')) + '&pagina=' + page, signal);
          if (serial !== revision) return;
          if (guardia && round !== guardiaRound) continue;
          if (!Array.isArray(data.items)) throw Error('invalid');
          if (data.dividida && Array.isArray(data.subzonas)) {
            const bounds = viewport();
            for (const child of data.subzonas) {
              availableZones = availableZones.filter(t => t.id !== child.id && !t.id.startsWith(child.id + '.') && !child.id.startsWith(t.id + '.'));
              availableZones.push(child);
              if (bounds && child.bbox[2] > bounds.west && child.bbox[0] <= bounds.east && child.bbox[3] > bounds.south && child.bbox[1] <= bounds.north && !visited.has(child.id)) {
                if (visited.size >= 32) throw Error('zoom_required');
                visited.add(child.id); work.push([child.id, 0]);
              }
            }
          }
          if (guardia) acceptGuardias(data, zone.slice(9), page); else if (bike) acceptBicis(data); else if (traffic) acceptTraffic(data); else if (camera) acceptCameras(data); else data.items.filter(coords).forEach(p => records.set(p.id, p));
          if (itv) itvSource = data; else if (!guardia && !bike && !traffic && !camera) source = data;
          if (data.siguientePagina != null) nextPages.set(zone, data.siguientePagina); else nextPages.delete(zone);
          if (guardia && data._failed) { failed++; nextPages.set(zone, page); }
        } catch (error) { if (serial === revision && error.name !== 'AbortError' && (!zone.startsWith('guardias:') || round === guardiaRound)) { failed++; nextPages.set(zone, page); if (zone === 'sct:cataluna') trafficError = true; if (zone === 'gbfs:zaragoza') biciError = true; if (zone === 'camaras:cataluna') cameraError = true; if (zone.startsWith('guardias:')) failGuardias(zone.slice(9)); } }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    if (serial !== revision) return;
    partial = failed > 0; loading = false; $('sv-results').setAttribute('aria-busy', 'false'); sourceText(); render();
    if (failed) notice('No se han podido comprobar todas las zonas. Los resultados están incompletos; puedes volver a intentar cargar más.');
  }
  function load(force = false) {
    if (favoritesOnly) { controller?.abort(); revision++; clearTimeout(guardiaExpiryTimer); loading = false; $('sv-results').setAttribute('aria-busy', 'false'); render(); sourceText(); return; }
    const bounds = viewport(), bases = zonasServicios(bounds), zones = osmZones(bounds, bases), key = zones.join(',') + ':' + bases.join(',') + ':' + chosen().join(',') + ':' + guardiaTurno();
    if (!force && key === loadKey) { render(); return; }
    controller?.abort(); controller = new AbortController(); const serial = ++revision;
    guardiaRound++; clearTimeout(guardiaExpiryTimer); guardiaSources.clear();
    records.clear(); nextPages.clear(); loadKey = ''; partial = false; shown = 60; loading = false;
    render(); sourceText();
    if (!selected.size) { notice('Elige al menos un tipo de servicio para buscar en el mapa.'); return; }
    const needsZones = osmChosen().length || selected.has('itv') || selected.has(GUARDIA_CATEGORY.id);
    if (needsZones && (!bases.length || bases.length > 9 || osmChosen().length && zones.length > 16)) { notice('Busca un municipio o acerca el mapa para consultar sus servicios.'); return; }
    loadKey = key; loading = true; $('sv-results').setAttribute('aria-busy', 'true'); notice('Comprobando los servicios de esta zona…');
    const pages = osmChosen().length ? zones.map(zone => [zone, 0]) : [];
    if (selected.has('itv')) pages.push(...bases.map(zone => ['itv:' + zone, 0]));
    if (selected.has(GUARDIA_CATEGORY.id)) pages.push(...bases.map(zone => ['guardias:' + zone, 0]));
    if (selected.has('bicis-zaragoza')) pages.push(['gbfs:zaragoza', 0]);
    if (selected.has('trafico-cataluna')) pages.push(['sct:cataluna', 0]);
    if (selected.has('camaras-cataluna')) pages.push(['camaras:cataluna', 0]);
    fetchPages(pages, controller.signal, serial);
  }
  function setCenter(p, name) {
    navigation++;
    origin = { lat: p.lat, lon: p.lon }; originLabel = name;
    const m = mapInstance();
    if (m) { window.setMapRegion?.(p.lat < 30 && p.lon < -13 ? 'canarias' : 'peninsula'); m.setView([p.lat, p.lon], 15); }
    if (fuelMode) { window.setSearchOrigin?.({ lat: p.lat, lng: p.lon }); window.loadStations?.(); }
    load(true);
  }
  function showCataluna() {
    navigation++; town = ''; origin = null; originLabel = 'desde el centro del mapa';
    $('sv-local-official').replaceChildren(); updateUrl();
    window.setMapRegion?.('peninsula'); mapInstance()?.fitBounds([[40.5, .1], [42.9, 3.4]]);
    load(true);
  }
  async function focusPoi(poi) {
    if (!poi.categorias) {
      town = ''; $('sv-local-official').replaceChildren();
      favoritesOnly = false; selected = new Set([poi.categoria]); focusedId = poi.id; renderCategories(); syncControls();
      setCenter(poi, 'desde el lugar elegido'); updateUrl();
      const currentNavigation = navigation, currentRevision = revision;
      try {
        const zone = poi.categoria === 'itv' ? servicioTileId(poi.lat, poi.lon) : pointZone(poi);
        const bike = poi.categoria === 'bicis-zaragoza';
        const data = bike ? await fetchBicis() : await json('/api/servicios/' + (poi.categoria === 'itv' ? 'itv/' : 'lugar/') + encodeURIComponent(poi.id) + '?zona=' + zone);
        if (currentNavigation !== navigation || currentRevision !== revision) return;
        if (bike) { acceptBicis(data); render(); sourceText(); }
        else if (data.item && coords(data.item)) { if (poi.categoria === 'itv') itvSource = data; else source = data; records.set(data.item.id, data.item); render(); sourceText(); }
      } catch (error) {
        if (currentNavigation !== navigation || currentRevision !== revision) return;
        if (error.status === 409) { await refreshCatalogs(); notice('El directorio acaba de cambiar de zona. Vuelve a abrir este favorito para consultar su ficha.'); }
        else notice('No se ha encontrado la ficha actual de este favorito. Puedes conservarlo o quitarlo de tus lugares guardados.');
      }
    } else { focusedId = poi.id; const m = mapInstance(); if (m) { m.setView([poi.lat, poi.lon], Math.max(m.getZoom(), 16)); render(); } }
    if (window.isMobile?.()) window.closeMobileSidebar?.();
  }
  async function chooseTown(ine) {
    const currentNavigation = ++navigation;
    try {
      const data = await townInfo(ine);
      if (currentNavigation !== navigation) return;
      if (!coords({ lat: data.lat, lon: data.lng })) throw Error('no_coordinates');
      town = ine; favoritesOnly = false; focusedId = ''; $('sv-query').value = data.nombre; $('sv-suggestions').replaceChildren();
      const official = $('sv-local-official'); official.replaceChildren(el('h3', 'También en ' + data.nombre));
      for (const service of data.servicios || []) if (/^\/(?!\/)/.test(service.url)) official.append(link(service.titulo, service.url));
      const save = button('☆ Guardar municipio', async () => {
        if (!services) return;
        const prefs = services.preferencias();
        try { await services.guardarPreferencias({ ...prefs, municipios: [...new Set([...prefs.municipios, ine])] }); save.textContent = '★ Municipio guardado'; renderSaved(); }
        catch { notice('No se ha podido guardar este municipio.'); }
      }); official.append(save);
      updateUrl(); syncControls(); setCenter({ lat: data.lat, lon: data.lng }, 'desde el centro de ' + data.nombre);
      await remember(); renderHistory();
    } catch { if (currentNavigation === navigation) notice('No se ha podido localizar ese municipio. Prueba de nuevo o mueve el mapa.'); }
  }
  async function search() {
    const text = $('sv-query').value.trim(); searchController?.abort(); const pending = new AbortController(); searchController = pending;
    const box = $('sv-suggestions'); box.replaceChildren(); if (text.length < 2) return;
    const foundCategories = categories.filter(c => (c.total > 0 || c.disponibilidad) && fold(c.nombre).includes(fold(text))).slice(0, 6);
    for (const category of foundCategories) {
      const row = el('li'); row.append(button('Servicio: ' + category.nombre, () => { navigation++; selected = new Set([category.id]); favoritesOnly = false; focusedId = ''; box.replaceChildren(); renderCategories(); updateUrl(); saveCategories(); if (category.id === 'bicis-zaragoza') chooseTown('50297'); else load(true); })); box.append(row);
    }
    try {
      const towns = await json('/api/localidades?q=' + encodeURIComponent(text), pending.signal);
      for (const place of towns) { const row = el('li'); row.append(button(place.nombre + ' · ' + place.provinciaNombre, () => chooseTown(place.ine))); box.append(row); }
      if (!box.children.length) box.append(el('li', 'No encontramos municipios o categorías con ese nombre.'));
    } catch (error) { if (error.name !== 'AbortError') box.append(el('li', 'La búsqueda de municipios no está disponible. Puedes mover el mapa.')); }
  }
  async function renderSaved() {
    const box = $('sv-saved-places'); box.replaceChildren(); const fragment = document.createDocumentFragment();
    for (const ine of services?.preferencias().municipios || []) {
      const row = el('span'), b = button('Municipio ' + ine, () => chooseTown(ine)); row.append(b);
      const remove = button('×', async () => {
        const prefs = services.preferencias();
        try { await services.guardarPreferencias({ ...prefs, municipios: prefs.municipios.filter(v => v !== ine) }); renderSaved(); }
        catch { notice('No se ha podido quitar el municipio guardado.'); }
      });
      remove.setAttribute('aria-label', 'Quitar municipio guardado ' + ine); row.append(remove); fragment.append(row);
      townInfo(ine).then(m => { b.textContent = m.nombre; remove.setAttribute('aria-label', 'Quitar municipio guardado ' + m.nombre); }).catch(() => {});
    }
    box.append(fragment);
  }
  function renderHistory() {
    $('sv-history-enabled').checked = services?.historialActivo() || false;
    const box = $('sv-history-list'); box.replaceChildren();
    for (const item of services?.historial() || []) {
      const row = el('li'); const b = button('Municipio ' + item.municipio + ' · ' + item.categorias.map(catalogName).join(', '), () => { selected = new Set(item.categorias); renderCategories(); chooseTown(item.municipio); }); row.append(b); box.append(row);
      townInfo(item.municipio).then(m => { b.textContent = m.nombre + ' · ' + item.categorias.map(catalogName).join(', '); }).catch(() => {});
    }
    if (!box.children.length) box.append(el('li', $('sv-history-enabled').checked ? 'Todavía no hay búsquedas guardadas.' : 'El historial está desactivado.'));
  }
  function locate() {
    if (!navigator.geolocation) { notice('Este navegador no ofrece ubicación. Busca tu municipio.'); return; }
    const currentNavigation = ++navigation;
    const b = $('sv-near'); b.disabled = true; notice('Esperando tu permiso de ubicación…');
    navigator.geolocation.getCurrentPosition(position => {
      b.disabled = false; const p = { lat: Number(position.coords.latitude.toFixed(5)), lon: Number(position.coords.longitude.toFixed(5)) };
      if (currentNavigation !== navigation) return;
      if (!coords(p)) { notice('Tu ubicación está fuera del territorio cubierto. Busca un municipio de España.'); return; }
      town = ''; focusedId = ''; favoritesOnly = false; $('sv-local-official').replaceChildren(); syncControls(); updateUrl();
      // El fragmento no viaja al servidor ni forma parte del historial guardado.
      const current = new URL(location.href); current.hash = 'near=' + p.lat + ',' + p.lon; history.replaceState(null, '', current.pathname + current.search + current.hash);
      setCenter(p, 'desde tu ubicación');
    }, () => { b.disabled = false; if (currentNavigation === navigation) notice('No se ha podido obtener tu ubicación. Puedes buscar tu municipio sin dar permiso.'); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }
  function showFuel(show) {
    fuelMode = show; $('fuel-content').hidden = !show;
    document.body.classList.toggle('sv-fuel-mode', show);
    $('sv-view-fuel').setAttribute('aria-pressed', String(show)); $('sv-view-services').setAttribute('aria-pressed', String(!show));
    $('sv-results').hidden = show;
    if (!show) { $('loading')?.classList.remove('show'); window.closeStationDetail?.(); }
    const m = mapInstance();
    if (m && window.clusterGroup) show ? m.addLayer(window.clusterGroup) : m.removeLayer(window.clusterGroup);
    if (show) {
      const p = reference(); if (p) { window.setSearchOrigin?.({ lat: p.lat, lng: p.lon }); window.loadStations?.(); }
      $('fuel-content').scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }
  async function findAddress(event) {
    event.preventDefault();
    const output = $('sv-address-results'), status = $('sv-address-status'), submit = $('sv-address-submit');
    output.replaceChildren(); submit.disabled = true; status.textContent = 'Buscando coincidencias en CartoCiudad…';
    const request = new AbortController(), timeout = setTimeout(() => request.abort(), 35000);
    try {
      const response = await fetch('/api/servicios/buscar-direccion', { method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: $('sv-address').value.trim() }) });
      if (!response.ok) throw Error('unavailable');
      const data = await response.json();
      const matches = (data.resultados || []).filter(p => coords({ lat: p.lat, lon: p.lng }));
      status.textContent = matches.length ? 'Comprueba el municipio y elige una coincidencia.' : 'No se encontraron coincidencias. Prueba con calle, número y municipio.';
      for (const result of matches) {
        const row = el('li');
        row.append(button([result.nombre, result.municipio, result.provincia, result.cp, result.precision === 'portal' ? 'Portal' : 'Centro aproximado de la zona'].filter(Boolean).join(' · '), () => {
          town = ''; focusedId = ''; favoritesOnly = false; $('sv-local-official').replaceChildren(); syncControls(); updateUrl();
          const current = new URL(location.href); current.hash = ''; history.replaceState(null, '', current.pathname + current.search);
          setCenter({ lat: result.lat, lon: result.lng }, result.precision === 'portal' ? 'desde el portal elegido' : 'desde el centro aproximado de la zona elegida');
          status.textContent = 'Ubicación elegida: ' + [result.nombre, result.municipio, result.provincia].filter(Boolean).join(' · ');
          output.replaceChildren();
        })); output.append(row);
      }
    } catch { status.textContent = 'No se ha podido comprobar la dirección. Inténtalo de nuevo o busca por municipio.'; }
    finally { clearTimeout(timeout); submit.disabled = false; }
  }
  function guardiasSourceText() {
    const box = $('sv-guardias-sources'); if (!box) return;
    const expanded = new Set([...box.querySelectorAll('details[open]')].map(d => d.dataset.provincia));
    box.replaceChildren(); box.hidden = !selected.has(GUARDIA_CATEGORY.id) || favoritesOnly;
    if (box.hidden) return;
    box.append(el('h3', 'Guardias: fuentes y avisos'), el('p', 'Sólo se dibujan ubicaciones oficiales verificables. Puede haber otras farmacias en los listados de cada provincia.', 'sv-help'));
    const provinces = new Map(); let pending = false;
    for (const data of guardiaSources.values()) {
      if (data.failed || data.deadline <= Date.now()) pending = true;
      for (const source of data.fuentes || []) {
        const old = provinces.get(source.provincia);
        if (!old || Date.parse(source.consultado) > Date.parse(old.consultado)) provinces.set(source.provincia, source);
      }
    }
    if (pending) box.append(el('p', 'Estado pendiente de comprobar. Los turnos anteriores ya no se consideran activos hasta recibir una nueva comprobación.', 'sv-warning'));
    if (!provinces.size) box.append(link('Consultar los listados oficiales de guardias', '/farmacias/guardia'));
    for (const source of provinces.values()) {
      const section = el('details'); section.dataset.provincia = source.provincia;
      section.open = expanded.has(source.provincia) || source.estado !== 'disponible';
      const state = ({ disponible: 'Fuente consultada', sin_coordenadas: 'Guardias sin ubicación verificable en el mapa', sin_actualizar: 'Actualización pendiente', sin_datos: 'Sin listado automático', error: 'No se pudo comprobar la fuente' })[source.estado] || 'Cobertura por confirmar';
      section.append(el('summary', source.nombre + ' · ' + state));
      section.append(el('p', 'Consulta de la fuente: ' + date(source.consultado) + '. Día del calendario: ' + date(source.fechaReferencia) + '.', 'sv-meta'));
      if (source.cobertura) section.append(el('p', source.cobertura, 'sv-help'));
      for (const warning of new Set(source.warnings || [])) section.append(el('p', warning, 'sv-warning'));
      if (Object.keys(source.avisosMunicipales || {}).length) section.append(el('p', 'Hay avisos para municipios de esta provincia. Revísalos en el listado antes de desplazarte.', 'sv-warning'));
      if (/^\/farmacias\/[a-z0-9-]+$/.test(source.directorioUrl || '')) section.append(link('Ver guardias y avisos de ' + source.nombre, source.directorioUrl));
      const official = safeWeb(source.fuenteUrl); if (official) section.append(link('Consultar fuente oficial', official));
      box.append(section);
    }
  }
  function guardiaDetails(poi, popup) {
    const card = el(popup ? 'div' : 'article', null, popup ? 'sv-popup' : 'sv-card'); card.dataset.servicio = poi.id;
    card.append(el('p', 'Farmacia de guardia · fuente oficial', 'sv-kind'), el('h3', poi.nombre));
    const distance = distanciaServicio(reference(), poi);
    if (distance !== null) card.append(el('p', (distance < 1 ? Math.round(distance * 1000) + ' m' : distance.toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' km') + ' ' + originLabel + ' · en línea recta', 'sv-meta'));
    if (poi.municipio) card.append(el('p', poi.municipio));
    card.append(el('p', openLabel(poi).label, 'sv-badge'), el('p', poi.horario || 'Horario por confirmar: llama antes de acudir'));
    card.append(el('p', 'Día del turno: ' + date(poi.fechaTurno) + '. Fuente consultada: ' + date(poi.consultado) + '.', 'sv-meta'));
    card.append(el('p', 'Llama antes de desplazarte. Este turno es temporal y no se guarda como favorito.', 'sv-help'));
    const actions = el('div', null, 'sv-actions'), directions = enlacesServicio(poi);
    if (directions) actions.append(link('Google Maps', directions.google), link('Apple Maps', directions.apple), link('Waze', directions.waze));
    if (poi.telefono) {
      card.append(el('p', 'Teléfono publicado: ' + poi.telefono, 'sv-meta'));
      const numbers = String(poi.telefono).split(/\s*(?:\/|;|,|\s[-–]\s)\s*/).map(value => value.replace(/[^\d+]/g, '').replace(/^0034/, '+34'));
      for (const phone of new Set(numbers.filter(value => /^(?:\+34)?[6789]\d{8}$/.test(value)))) actions.append(link('Llamar ' + phone, 'tel:' + phone));
    }
    if (/^\/farmacias\/[a-z0-9-]+(?:\/[a-z0-9-]+)?$/.test(poi.directorioUrl || '')) actions.append(link('Ficha y avisos del municipio', poi.directorioUrl));
    const official = safeWeb(poi.fuenteUrl); if (official) actions.append(link('Fuente oficial de la guardia', official));
    if (!popup) actions.append(button('Ver en el mapa', () => focusPoi(poi)));
    card.append(actions); return card;
  }
  function guardiaDeadline(value, evaluated, started) {
    const expiry = Date.parse(value), server = Date.parse(evaluated);
    // Una respuesta lenta o un reloj visitante atrasado nunca alargan el turno.
    return Number.isFinite(expiry) && Number.isFinite(server) && expiry >= server ? Math.min(expiry, started + expiry - server) : 0;
  }
  function fetchGuardias(zone, page, signal, serial, round) {
    const key = [serial, round, zone, page, guardiaTurno()].join(':');
    if (!guardiaRequests.has(key)) {
      const started = Date.now(), pending = new AbortController(), abort = () => pending.abort();
      if (signal.aborted) pending.abort(); else signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 15000);
      const promise = (async () => {
        const response = await fetch('/api/servicios/guardias?zona=' + zone + '&turno=' + guardiaTurno() + '&pagina=' + page, { signal: pending.signal, headers: { Accept: 'application/json' } });
        const data = await response.json();
        if ((!response.ok && response.status !== 503) || data.proveedor !== 'guardias-oficiales' || !Array.isArray(data.items) || !Array.isArray(data.fuentes)) throw Error('invalid_guardias');
        return { ...data, _started: started, _failed: !response.ok };
      })().catch(error => { if (error.name === 'AbortError' && !signal.aborted) throw Error('timeout_guardias'); throw error; }).finally(() => { clearTimeout(timeout); signal.removeEventListener('abort', abort); guardiaRequests.delete(key); });
      guardiaRequests.set(key, promise);
    }
    return guardiaRequests.get(key);
  }
  function failGuardias(zone) {
    const old = guardiaSources.get(zone) || {};
    guardiaSources.set(zone, { ...old, failed: true, deadline: 0, retryAt: Date.now() + 30000 });
    scheduleGuardiasExpiry();
  }
  function acceptGuardias(data, zone, page) {
    const deadline = guardiaDeadline(data.revalidarAntes, data.evaluadoEn, data._started);
    guardiaSources.set(zone, { ...data, deadline, failed: data._failed, retryAt: Date.now() + (data._failed ? 30000 : 5000) });
    // Una comprobación de la primera página sustituye el turno anterior entero.
    // Las siguientes páginas sólo completan esta misma lectura.
    if (page === 0) for (const [id, poi] of records) if (poi._guardiaZona === zone) records.delete(id);
    if (!data._failed) for (const poi of data.items.filter(coords)) {
      if (poi.proveedor !== 'guardias-oficiales' || !/^guardia-[a-z]+-[a-f0-9]{32}$/.test(poi.id)) continue;
      records.set(poi.id, { ...poi, guardable: false, categorias: [GUARDIA_CATEGORY.id], _guardiaZona: zone, _guardiaDeadline: Math.min(deadline, guardiaDeadline(poi.estadoHasta, data.evaluadoEn, data._started)) });
    }
    scheduleGuardiasExpiry();
  }
  function scheduleGuardiasExpiry() {
    clearTimeout(guardiaExpiryTimer);
    if (!selected.has(GUARDIA_CATEGORY.id) || favoritesOnly || document.hidden || !guardiaSources.size) return;
    const now = Date.now(), deadlines = [...guardiaSources.values()].map(data => !data.failed && data.deadline > now ? data.deadline : data.retryAt);
    for (const poi of records.values()) if (poi.proveedor === 'guardias-oficiales' && poi._guardiaDeadline > now) deadlines.push(poi._guardiaDeadline);
    const next = Math.min(...deadlines.filter(Number.isFinite));
    if (!Number.isFinite(next)) return;
    guardiaExpiryTimer = setTimeout(() => {
      // Retira lista, pin activo y popup ANTES de esperar la siguiente petición.
      render(); sourceText(); refreshGuardias();
    }, Math.max(1, next - now));
  }
  async function refreshGuardias() {
    if (document.hidden || !selected.has(GUARDIA_CATEGORY.id) || favoritesOnly || !controller || controller.signal.aborted) return;
    if (guardiaRefreshPromise) return guardiaRefreshPromise;
    const zones = zonasServicios(viewport()); if (!zones.length || zones.length > 9) return;
    const round = ++guardiaRound;
    guardiaRefreshPromise = fetchPages(zones.map(zone => ['guardias:' + zone, 0]), controller.signal, revision, round).finally(() => { guardiaRefreshPromise = null; scheduleGuardiasExpiry(); });
    return guardiaRefreshPromise;
  }
  function trafficDetails(poi, popup) {
    const card = el(popup ? 'div' : 'article', null, popup ? 'sv-popup' : 'sv-card'); card.dataset.servicio = poi.id;
    card.append(el('p', 'Tráfico en Cataluña · SCT', 'sv-kind'), el('h3', poi.nombre));
    if (!trafficCurrent()) { card.append(el('p', 'El parte ha caducado. Consulta el estado actual en la fuente.', 'sv-warning'), link('Consultar tráfico', '/trafico/cataluna')); return card; }
    if (poi.descripcion) card.append(el('p', poi.descripcion));
    if (poi.carretera || poi.sentido) card.append(el('p', [poi.carretera, poi.sentido].filter(Boolean).join(' · '), 'sv-meta'));
    card.append(el('p', 'Fecha original de la incidencia: ' + date(poi.fechaIncidencia) + '. Sigue incluida en el parte publicado por la fuente.', 'sv-meta'));
    card.append(link('Parte completo y fuente oficial', '/trafico/cataluna'));
    if (!popup) card.append(button('Ver el punto publicado', () => focusPoi(poi)));
    return card;
  }
  function cameraDetails(poi, popup) {
    const card = el(popup ? 'div' : 'article', null, popup ? 'sv-popup' : 'sv-card'); card.dataset.servicio = poi.id;
    card.append(el('p', 'Cámara de tráfico · ' + poi.fuenteImagen, 'sv-kind'), el('h3', poi.nombre));
    card.append(el('p', 'Hora de imagen sin publicar. Al abrirla, comprueba la fecha que muestre la fuente. No se confirma vídeo ni imagen en directo.'));
    card.append(el('p', 'Ubicación publicada en el directorio del ' + date(cameraSource?.fechaDirectorio) + '.', 'sv-meta'));
    if (cameraError || cameraSource?.estado !== 'actual' || Date.parse(cameraSource?.caduca) <= Date.now()) card.append(el('p', 'Directorio pendiente de actualizar. Confirma la ubicación en la fuente.', 'sv-warning'));
    if (safeWeb(poi.urlCamara)) card.append(link('Ver cámara oficial', poi.urlCamara));
    if (!popup) card.append(button('Ver el punto publicado', () => focusPoi(poi)));
    return card;
  }
  function fetchCameras() {
    if (!cameraPromise) cameraPromise = json('/api/camaras/cataluna').finally(() => { cameraPromise = null; });
    return cameraPromise;
  }
  function acceptCameras(data) {
    cameraSource = data; cameraError = false;
    for (const [id, poi] of records) if (poi.proveedor === 'camara-sct') records.delete(id);
    for (const item of data.items.filter(coords)) records.set(item.id, { ...item, proveedor: 'camara-sct', categorias: ['camaras-cataluna'] });
  }
  async function refreshCameras() {
    if (document.hidden || !selected.has('camaras-cataluna') || favoritesOnly || !cameraError && Date.now() - Date.parse(cameraSource?.consultado) < 3600000) return;
    const serial = revision;
    try {
      const data = await fetchCameras();
      if (serial !== revision || !selected.has('camaras-cataluna') || favoritesOnly) return;
      acceptCameras(data); render(); sourceText();
    } catch { if (serial === revision && selected.has('camaras-cataluna')) { cameraError = true; render(); sourceText(); } }
  }
  function fetchTraffic() {
    if (!trafficPromise) {
      const _inicioWall = Date.now(), _inicioMono = performance.now();
      trafficPromise = json('/api/trafico/cataluna').then(data => ({ ...data, _inicioWall, _inicioMono })).finally(() => { trafficPromise = null; });
    }
    return trafficPromise;
  }
  function acceptTraffic(data) {
    trafficSource = { ...data, _plazo: plazoServicio(data.caduca, data.evaluadoEn, data._inicioWall, data._inicioMono) }; trafficError = false;
    for (const [id, poi] of records) if (poi.proveedor === 'sct') records.delete(id);
    for (const item of data.items.filter(coords)) records.set(item.id, { ...item, proveedor: 'sct', categorias: ['trafico-cataluna'] });
    clearTimeout(trafficExpiryTimer);
    const remaining = restanteServicio(trafficSource._plazo);
    if (remaining > 0) trafficExpiryTimer = setTimeout(() => { if (selected.has('trafico-cataluna') && !favoritesOnly) { render(); sourceText(); } }, remaining + 5);
  }
  async function refreshTraffic() {
    if (document.hidden || !selected.has('trafico-cataluna') || favoritesOnly) return;
    const serial = revision;
    try {
      const data = await fetchTraffic();
      if (serial !== revision || !selected.has('trafico-cataluna') || favoritesOnly) return;
      acceptTraffic(data); render(); sourceText();
    } catch { if (serial === revision && selected.has('trafico-cataluna')) { trafficError = true; render(); sourceText(); } }
  }
  function fetchBicis() {
    if (!biciPromise) {
      const _inicioWall = Date.now(), _inicioMono = performance.now();
      biciPromise = json('/api/bicis/zaragoza').then(data => ({ ...data, _inicioWall, _inicioMono })).finally(() => { biciPromise = null; });
    }
    return biciPromise;
  }
  function acceptBicis(data) {
    biciSource = data; biciError = false;
    for (const [id, poi] of records) if (poi.proveedor === 'gbfs-zaragoza') records.delete(id);
    for (const item of data.items.filter(coords)) records.set(item.id, { ...item, proveedor: 'gbfs-zaragoza', categorias: ['bicis-zaragoza'], gratis: null, accesible: 'desconocido', acceso: 'desconocido', ubicacion: 'punto', _estadoComprobado: biciServicioActual(item, Date.parse(data.evaluadoEn)), _plazo: plazoServicio(item.caduca, data.evaluadoEn, data._inicioWall, data._inicioMono) });
    scheduleBiciExpiry();
  }
  function scheduleBiciExpiry() {
    clearTimeout(biciExpiryTimer);
    const nextExpiry = [...records.values()].filter(p => p.proveedor === 'gbfs-zaragoza').map(p => restanteServicio(p._plazo)).filter(t => Number.isFinite(t) && t > 0).sort((a, b) => a - b)[0];
    if (nextExpiry) biciExpiryTimer = setTimeout(() => {
      // La cifra caducada desaparece incluso si el siguiente refresco falla.
      if (selected.has('bicis-zaragoza') && !favoritesOnly) { render(); sourceText(); }
      scheduleBiciExpiry();
    }, Math.max(1, nextExpiry + 5));
  }
  async function refreshBicis() {
    if (document.hidden || !selected.has('bicis-zaragoza') || favoritesOnly) return;
    const serial = revision;
    try {
      const data = await fetchBicis();
      if (serial !== revision || !selected.has('bicis-zaragoza') || favoritesOnly) return;
      acceptBicis(data); render(); sourceText();
    } catch {
      if (serial !== revision || !selected.has('bicis-zaragoza')) return;
      biciError = true; render(); sourceText();
    }
  }
  async function refreshCatalogs() {
    if (catalogPromise) return catalogPromise;
    catalogPromise = (async () => {
      const results = await Promise.allSettled([json('/api/servicios/categorias'), json('/api/servicios/itv?zona=' + servicioTileId(40.4168, -3.7038))]);
      let ok = false;
      if (results[0].status === 'fulfilled') {
        source = results[0].value; categories = [...(source.categorias || [])]; availableZones = source.zonas || []; ok = true;
      }
      categories = categories.filter(c => ![BICI_CATEGORY.id, TRAFFIC_CATEGORY.id, CAMERA_CATEGORY.id, GUARDIA_CATEGORY.id].includes(c.id));
      categories.push(BICI_CATEGORY, TRAFFIC_CATEGORY, CAMERA_CATEGORY, GUARDIA_CATEGORY);
      if (results[1].status === 'fulfilled') {
        itvSource = results[1].value; ok = true;
        categories = categories.filter(c => c.id !== 'itv');
        if (itvSource.totalConCoordenadas > 0) categories.push({ id: 'itv', nombre: 'Estaciones ITV · fuentes oficiales', grupo: 'movilidad', grupoNombre: 'Movilidad', total: itvSource.totalConCoordenadas });
      }
      lastCatalogCheck = Date.now();
      return ok && categories.length > 0;
    })().finally(() => { catalogPromise = null; });
    return catalogPromise;
  }
  async function refreshVisible() {
    if (document.hidden) return;
    // Los temporizadores pueden suspenderse en una pestaña oculta. Retirar
    // primero las cifras caducadas, sin esperar a ninguna respuesta de red.
    render(); sourceText();
    const guardias = refreshGuardias();
    if (Date.now() - lastCatalogCheck >= 5 * 60000) {
      if (await refreshCatalogs()) { renderCategories(); sourceText(); if (!favoritesOnly) load(true); }
    }
    render(); sourceText();
    await Promise.all([refreshBicis(), refreshTraffic(), refreshCameras(), guardias]);
  }
  async function init() {
    if (!$('sv-results')) return;
    window.EUServiciosMap = { locate };
    await Promise.resolve(window.EUCuenta?.ready).catch(() => {}); services = window.EUCuenta?.servicios;
    const requested = (url.searchParams.get('categorias') || '').split(',').filter(Boolean);
    selected = new Set(requested.length ? requested : services?.preferencias().categorias.length ? services.preferencias().categorias : ['banos', 'agua-potable']);
    $('sv-near').addEventListener('click', locate);
    $('sv-search').addEventListener('submit', event => { event.preventDefault(); clearTimeout(searchTimer); search(); });
    $('sv-address-form').addEventListener('submit', findAddress);
    $('sv-query').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(search, 300); });
    $('sv-favorites').addEventListener('click', () => { navigation++; favoritesOnly = !favoritesOnly; focusedId = ''; syncControls(); updateUrl(); load(true); });
    ['sv-open', 'sv-free', 'sv-accessible'].forEach(id => $(id).addEventListener('change', () => { shown = 60; render(); }));
    $('sv-guardias-turno').addEventListener('change', () => { navigation++; focusedId = ''; load(true); });
    $('sv-view-fuel').addEventListener('click', () => showFuel(true)); $('sv-view-services').addEventListener('click', () => showFuel(false));
    $('sv-more').addEventListener('click', () => {
      shown += 60;
      if (shown > filteredRecords().length && nextPages.size && !loading) { loading = true; $('sv-results').setAttribute('aria-busy', 'true'); fetchPages([...nextPages], controller.signal, revision); }
      render();
    });
    $('sv-history-enabled').addEventListener('change', async () => {
      try { await services?.activarHistorial($('sv-history-enabled').checked); }
      catch { notice('El navegador no permite guardar el historial.'); }
      renderHistory();
    });
    $('sv-history-clear').addEventListener('click', async () => {
      try { await services?.borrarHistorial(); } catch { notice('No se pudo borrar el historial.'); }
      renderHistory();
    });
    window.addEventListener('eu:cuenta', () => { renderSaved(); render(); });
    window.addEventListener('eu:servicios-historial', renderHistory);
    document.addEventListener('visibilitychange', refreshVisible);
    setInterval(refreshVisible, 60000);
    const m = mapInstance();
    if (m) {
      m.on('moveend', () => { clearTimeout(mapTimer); mapTimer = setTimeout(() => load(), 400); });
      m.on('layeradd', event => { if (!fuelMode && event.layer === window.clusterGroup) m.removeLayer(event.layer); });
      if (window.clusterGroup) m.removeLayer(window.clusterGroup);
      window.setChargersVisible?.(false);
    }
    try {
      if (!await refreshCatalogs()) throw Error('unavailable');
      selected = new Set([...selected].filter(id => categories.some(c => c.id === id)));
      renderCategories(); sourceText();
    } catch { $('sv-categories').replaceChildren(el('p', 'No se ha podido cargar el directorio. Vuelve a intentarlo más tarde.')); notice('El directorio de servicios está temporalmente sin comprobar. El mapa de gasolineras sigue disponible.'); }
    renderSaved(); renderHistory(); syncControls();
    if (favoritesOnly) render();
    else if (/^\d{5}$/.test(url.searchParams.get('municipio') || '')) await chooseTown(url.searchParams.get('municipio'));
    else {
      const near = window.readNearLocation?.(location.hash);
      const target = { lat: Number(url.searchParams.get('lat')), lon: Number(url.searchParams.get('lon')) };
      if (focusedId && coords(target)) await focusPoi({ id: focusedId, ...target, categoria: chosen()[0] });
      else if (near) setCenter({ lat: near.lat, lon: near.lng }, 'desde tu ubicación guardada en este enlace');
      else if (selected.size === 1 && selected.has('bicis-zaragoza')) await chooseTown('50297');
      else if (selected.size && chosen().every(id => ['trafico-cataluna', 'camaras-cataluna'].includes(id))) showCataluna();
      else load();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
