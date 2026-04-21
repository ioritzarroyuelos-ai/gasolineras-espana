export const clientUiScript = `

// ---- EVENTOS ----
// Filosofia UX: los cambios en los filtros NO disparan carga ni render. El
// usuario decide cuando mirar resultados pulsando "Buscar" (o "Mi ubicacion").
// Asi evitamos que un usuario indeciso vea la lista bailar mientras ajusta 4
// controles — y ahorramos llamadas innecesarias al Ministerio.
document.getElementById('sel-provincia').addEventListener('change', async function(e) {
  // Cambio manual de provincia = el usuario quiere mirar otra region, asi que
  // salimos del modo geolocalizacion (si estabamos dentro). Sin esto,
  // loadStations() descartaba el municipio y ordenaba por distancia a la GPS
  // vieja — bug reportado.
  clearGeolocationMode();
  // Unica excepcion: al cambiar provincia hay que refrescar el dropdown de
  // municipios (es un selector dependiente). No carga estaciones.
  await loadMunicipios(e.target.value);
});
document.getElementById('sel-municipio').addEventListener('change', function() {
  // Mismo razonamiento: si el usuario elige un municipio concreto, quiere ese
  // municipio — no la provincia entera filtrada por distancia GPS.
  clearGeolocationMode();
  // No-op adicional: el render llega con "Buscar".
});
document.getElementById('sel-combustible').addEventListener('change', function() {
  // No-op: el render llega con "Buscar".
});
document.getElementById('sel-orden').addEventListener('change', function(e) {
  // Mostrar slider de radio solo cuando tiene sentido (cerca / distancia).
  var needsRadius = (e.target.value === 'cerca' || e.target.value === 'dist');
  var rg = document.getElementById('radius-group');
  if (needsRadius && userPos) rg.style.display = 'block';
  else if (!needsRadius) rg.style.display = 'none';
  else if (needsRadius && !userPos) {
    showToast('Pulsa el boton de ubicacion para usar esta ordenacion', 'warning');
  }
  // Excepcion a la regla "nada hasta Buscar": el orden SI se reaplica en vivo
  // si ya hay estaciones cargadas. Motivo: ordenar es una operacion puramente
  // de cliente (reordenar un array en memoria) — no dispara fetch ni cambia
  // el conjunto de resultados, solo el orden. Si el usuario va a la lista y
  // quiere ver "mas barato primero" en lugar de "A-Z", forzarle un click de
  // Buscar extra seria absurdo.
  if (allStations.length) applyFilters();
});

// Filtros avanzados: tambien se aplican en vivo (operan sobre el pool ya
// cargado, no disparan fetch). Actualizar tambien el contador-chip para que el
// usuario vea "Filtros avanzados (2)" cuando tenga varios activos.
function updateAdvCountBadge() {
  var cnt = 0;
  if (document.getElementById('flt-abierto').checked) cnt++;
  if (document.getElementById('flt-24h').checked) cnt++;
  if (document.getElementById('sel-marca').value) cnt++;
  var badge = document.getElementById('adv-filters-count');
  if (cnt > 0) { badge.textContent = String(cnt); badge.classList.add('show'); }
  else { badge.textContent = ''; badge.classList.remove('show'); }
}
function advFilterChanged() {
  updateAdvCountBadge();
  if (allStations.length) applyFilters();
}
document.getElementById('flt-abierto').addEventListener('change', advFilterChanged);
document.getElementById('flt-24h').addEventListener('change', advFilterChanged);
document.getElementById('sel-marca').addEventListener('change', advFilterChanged);

// ---- AUTOCOMPLETADO BUSQUEDA ----
(function() {
  var input  = document.getElementById('search-text');
  var box    = document.getElementById('search-suggestions');
  var selIdx   = -1;

  function normQ(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function showSuggestions(q) {
    if (!q || q.length < 2 || !allStations.length) { box.classList.remove('show'); return; }
    var ql = normQ(q);
    var fuel = document.getElementById('sel-combustible').value;

    var seen = new Set();
    var matches = [];
    for (var i = 0; i < allStations.length; i++) {
      var s = allStations[i];
      var rotulo = normQ(s['Rotulo'] || '');
      if (!rotulo.includes(ql)) continue;
      if (seen.has(rotulo)) continue;
      seen.add(rotulo);
      matches.push(s);
      if (matches.length >= 8) break;
    }

    if (!matches.length) { box.classList.remove('show'); return; }

    selIdx = -1;
    box.innerHTML = matches.map(function(s, i) {
      var price = parsePrice(s[fuel]);
      var color = price ? priceColor(price) : 'gray';
      var nameSafe = esc(s['Rotulo'] || 'Gasolinera');
      // Highlight sobre el texto ya escapado: $1 es siempre texto seguro
      var hl    = nameSafe.replace(new RegExp('(' + q.replace(/[.*+?^{}$()|[\]\\]/g,'\\$&') + ')', 'gi'), '<mark class="suggest-highlight">$1</mark>');
      return '<div class="suggest-item" data-idx="' + i + '">'
        + '<div class="suggest-row">'
        + '  <div class="suggest-name">&#x26FD; ' + hl + '</div>'
        + '  <div class="suggest-sub">&#x1F4CD; ' + esc(s['Municipio']) + '</div>'
        + '</div>'
        + (price ? '<span class="suggest-price suggest-price--' + color + '">' + price.toFixed(3) + ' &#x20AC;</span>' : '')
        + '</div>';
    }).join('');

    box._matches = matches;
    box.classList.add('show');
  }

  function selectItem(s) {
    input.value = s['Rotulo'] || '';
    box.classList.remove('show');
    applyFilters();
    var lat = parseFloat((s['Latitud'] || '').replace(',', '.'));
    var lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',', '.'));
    if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
      map.setView([lat, lng], 17);
      if (clusterGroup) {
        clusterGroup.eachLayer(function(layer) {
          var lp = layer.getLatLng();
          if (Math.abs(lp.lat - lat) < 0.0002 && Math.abs(lp.lng - lng) < 0.0002) layer.openPopup();
        });
      }
    }
  }

  input.addEventListener('input', function() {
    // El autocomplete (dropdown de sugerencias) sigue funcionando en vivo —
    // es una ayuda visual, no cambia el mapa. Pero NO reaplicamos filtros al
    // vuelo: el usuario vera la lista filtrada cuando pulse "Buscar".
    showSuggestions(input.value.trim());
  });

  box.addEventListener('mousedown', function(e) {
    var item = e.target.closest('.suggest-item');
    if (!item) return;
    e.preventDefault();
    selectItem(box._matches[+item.dataset.idx]);
  });

  // Navegacion con teclado arriba abajo Enter Esc
  input.addEventListener('keydown', function(e) {
    var items = box.querySelectorAll('.suggest-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selIdx = Math.min(selIdx + 1, items.length - 1);
      items.forEach(function(el, i) { el.style.background = i === selIdx ? '#f0fdf4' : ''; });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selIdx = Math.max(selIdx - 1, -1);
      items.forEach(function(el, i) { el.style.background = i === selIdx ? '#f0fdf4' : ''; });
    } else if (e.key === 'Enter') {
      if (selIdx >= 0 && box._matches) { selectItem(box._matches[selIdx]); }
      else loadStations();
    } else if (e.key === 'Escape') {
      box.classList.remove('show');
    }
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.form-group')) box.classList.remove('show');
  });

  input.addEventListener('focus', function() {
    if (input.value.trim().length >= 2) showSuggestions(input.value.trim());
  });
})();

document.getElementById('btn-buscar').addEventListener('click', loadStations);

// ---- SIDEBAR TOGGLE ----
var sidebar    = document.getElementById('sidebar');
var backdrop   = document.getElementById('sidebar-backdrop');

function isMobile() { return window.innerWidth < 1024; }

function openMobileSidebar() {
  sidebar.classList.add('open');
  backdrop.classList.add('show');
}
function closeMobileSidebar() {
  sidebar.classList.remove('open');
  backdrop.classList.remove('show');
}
// ---- DESKTOP SIDEBAR: colapso con tira + persistencia ----
function sidebarIcon() {
  var i = document.querySelector('#btn-toggle-sidebar i');
  if (!i) return;
  if (isMobile()) {
    i.className = 'fas fa-bars';
  } else {
    i.className = sidebar.classList.contains('collapsed')
      ? 'fas fa-chevron-right'
      : 'fas fa-chevron-left';
  }
}

function toggleDesktopSidebar() {
  var isCollapsed = sidebar.classList.contains('collapsed');
  sidebar.classList.toggle('collapsed', !isCollapsed);
  localStorage.setItem('gs_sb', isCollapsed ? '1' : '0');
  sidebarIcon();
  setTimeout(function() { if (map) map.invalidateSize(true); }, 300);
}

// Restaurar estado al cargar
(function() {
  if (!isMobile() && localStorage.getItem('gs_sb') === '0') {
    sidebar.classList.add('collapsed');
  }
  sidebarIcon();
})();

document.getElementById('btn-toggle-sidebar').addEventListener('click', function() {
  if (isMobile()) {
    sidebar.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar();
  } else {
    toggleDesktopSidebar();
  }
});

backdrop.addEventListener('click', closeMobileSidebar);

window.addEventListener('resize', function() {
  if (!isMobile()) {
    closeMobileSidebar();
    // Al pasar a desktop, restaurar preferencia guardada
    var pref = localStorage.getItem('gs_sb');
    sidebar.classList.toggle('collapsed', pref === '0');
  } else {
    sidebar.classList.remove('collapsed');
    closeMobileSidebar();
  }
  sidebarIcon();
  if (map) map.invalidateSize(true);
});

// Geocoder del header retirado por decision de producto (usuarios lo usaban
// poco frente al filtro por provincia + geolocalizacion). El modal de ruta
// sigue usando /api/geocode/search internamente para origen/destino.

// ---- MODO OSCURO — siempre arranca en claro, sin persistencia ----
(function() {
  var btn = document.getElementById('btn-dark');
  var icon = btn.querySelector('i');
  function updateIcon() {
    var dark = document.body.classList.contains('dark');
    icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
    btn.title = dark ? 'Modo claro' : 'Modo oscuro';
  }
  updateIcon();
  btn.addEventListener('click', function() {
    document.body.classList.toggle('dark');
    updateIcon();
    // Sincronizar tile del mapa: togglear entre capa clara y oscura.
    if (map && mapLayers.light && mapLayers.dark) {
      var isDark = document.body.classList.contains('dark');
      if (isDark) { map.removeLayer(mapLayers.light); mapLayers.dark.addTo(map); }
      else        { map.removeLayer(mapLayers.dark);  mapLayers.light.addTo(map); }
      // Dark usa raster sin etiquetas — necesita SPAIN_LABELS encima. Light
      // puede ser MapLibre Liberty (trae toponimia filtrada a Espana) o raster
      // voyager_nolabels; en el segundo caso tambien hacen falta labels custom.
      // Criterio: si mapLayers.light sigue siendo un TileLayer (raster, el
      // upgrade MapLibre no llego a aplicarse), mostramos labels en ambos
      // modos; si es MapLibre (vector), solo en modo dark.
      var lightIsRaster = mapLayers.light instanceof L.TileLayer;
      var needLabels = isDark || lightIsRaster;
      if (needLabels) {
        if (!labelLayer) {
          labelLayer = L.layerGroup().addTo(map);
          map.on('zoomend', renderLabels);
        } else if (!map.hasLayer(labelLayer)) {
          labelLayer.addTo(map);
        }
        renderLabels();
      } else {
        if (labelLayer && map.hasLayer(labelLayer)) {
          map.removeLayer(labelLayer);
        }
      }
    }
  });
})();

// ---- INIT ----
// Limpiar cache antigua (datos sin normalizar) si existe
(function() {
  try {
    var keys = Object.keys(localStorage).filter(function(k) { return k.startsWith('gs_v1_'); });
    keys.forEach(function(k) { localStorage.removeItem(k); });
  } catch(e) {}
})();

// ---- URL SYNC + SEO SEED ----
// Dos funcionalidades relacionadas:
//   1) Al cargar, leemos query params (?prov=28&mun=XXX&fuel=...&order=asc
//      &text=...&open=1&h24=1&brand=REPSOL&radius=5) para rehidratar el estado
//      de los controles → habilita enlaces compartibles (?a un compa?ero).
//   2) Tras una busqueda, reescribimos la URL con history.replaceState para
//      que el "Compartir" funcione y refrescar la pagina no pierda contexto.
// La seed via window.__SEO__ (rutas /gasolineras/<slug>) solo rellena la
// provincia; los query params tienen prioridad sobre ella.
var __urlSyncActive = false;   // evita que la rehidratacion dispare loadStations
function readQueryState() {
  var p = new URLSearchParams(location.search);
  // Fallback: si la ruta es /gasolineras/<slug>[/<mun-slug>] y no hay ?prov,
  // usamos __SEO__. Ship 11: soporta municipioId.
  var seo = null;
  try { seo = (window).__SEO__ || null; } catch(_) {}
  return {
    prov:   p.get('prov')   || (seo && seo.provinciaId) || '',
    mun:    p.get('mun')    || (seo && seo.municipioId) || '',
    fuel:   p.get('fuel')   || '',
    order:  p.get('order')  || '',
    text:   p.get('text')   || '',
    brand:  p.get('brand')  || '',
    open:   p.get('open')   === '1',
    h24:    p.get('h24')    === '1',
    radius: p.get('radius') || ''
  };
}
function writeQueryState() {
  try {
    var p = new URLSearchParams();
    var prov  = document.getElementById('sel-provincia').value;
    var mun   = document.getElementById('sel-municipio').value;
    var fuel  = document.getElementById('sel-combustible').value;
    var order = document.getElementById('sel-orden').value;
    var text  = (document.getElementById('search-text').value || '').trim();
    var radius= document.getElementById('in-radius').value;
    var brand = (document.getElementById('sel-marca') || {}).value || '';
    var open  = (document.getElementById('flt-abierto') || {}).checked;
    var h24   = (document.getElementById('flt-24h')     || {}).checked;
    if (prov)  p.set('prov',  prov);
    if (mun)   p.set('mun',   mun);
    // fuel por defecto es "Precio Gasolina 95 E5"; no lo escribimos para URLs limpias
    if (fuel && fuel !== 'Precio Gasolina 95 E5') p.set('fuel', fuel);
    if (order && order !== 'asc') p.set('order', order);
    if (text)  p.set('text',  text);
    if (brand) p.set('brand', brand);
    if (open)  p.set('open',  '1');
    if (h24)   p.set('h24',   '1');
    // Radio solo se guarda en modos cerca/dist
    if (radius && (order === 'cerca' || order === 'dist')) p.set('radius', radius);
    var qs = p.toString();
    var base = location.pathname;
    // En rutas /gasolineras/<slug>[/<mun-slug>], mantener la ruta pero anadir
    // querys para filtros adicionales. La ruta ya codifica la provincia
    // (y opcionalmente el municipio) — no los duplicamos.
    var seo = null; try { seo = (window).__SEO__ || null; } catch(_) {}
    if (seo && seo.provinciaId && prov === seo.provinciaId) {
      p.delete('prov');
      if (seo.municipioId && mun === seo.municipioId) {
        p.delete('mun');
      }
      qs = p.toString();
    }
    history.replaceState(null, '', base + (qs ? '?' + qs : ''));
  } catch(_) {}
}

async function applyQueryState(state) {
  // Orden: provincia (dispara loadMunicipios asincrono) → municipio → resto.
  var selProv = document.getElementById('sel-provincia');
  var selMun  = document.getElementById('sel-municipio');
  var selFuel = document.getElementById('sel-combustible');
  var selOrd  = document.getElementById('sel-orden');
  var txt     = document.getElementById('search-text');
  var selMk   = document.getElementById('sel-marca');
  var fOpen   = document.getElementById('flt-abierto');
  var f24     = document.getElementById('flt-24h');
  var rg      = document.getElementById('radius-group');
  var inR     = document.getElementById('in-radius');
  var lblR    = document.getElementById('lbl-radius');

  if (state.prov && selProv) {
    selProv.value = state.prov;
    // Aguardamos a que el dropdown de municipios se rellene antes de
    // autoselecccionar uno (si procede).
    try { await loadMunicipios(state.prov); } catch(_) {}
  }
  if (state.mun && selMun) {
    // Solo intentamos seleccionar si la opcion existe (municipio del slug).
    var match = false;
    for (var i = 0; i < selMun.options.length; i++) {
      if (selMun.options[i].value === state.mun) { match = true; break; }
    }
    if (match) selMun.value = state.mun;
  }
  if (state.fuel && selFuel)  selFuel.value = state.fuel;
  if (state.order && selOrd)  selOrd.value  = state.order;
  if (state.text && txt)      txt.value     = state.text;
  if (state.brand && selMk)   selMk.value   = state.brand;
  if (fOpen) fOpen.checked = !!state.open;
  if (f24)   f24.checked   = !!state.h24;
  if (state.radius && inR) {
    inR.value = state.radius;
    if (lblR) lblR.textContent = state.radius + ' km';
  }
  // Mostrar radius si order es cerca/dist y tenemos userPos (aunque userPos
  // llega despues; el handler de sel-orden ya lo vuelve a evaluar).
  if ((state.order === 'cerca' || state.order === 'dist') && rg && userPos) {
    rg.style.display = 'block';
  }
  // Refrescamos el contador de filtros avanzados si existe.
  try { if (typeof updateAdvCountBadge === 'function') updateAdvCountBadge(); } catch(_) {}
}

// Inicializar mapa + provincias + (opcional) aplicar query state y buscar.
async function bootApp() {
  initMap();
  loadProvincias();
  var st = readQueryState();
  __urlSyncActive = true;
  if (st.prov) {
    // Rehidratacion completa: aplicamos estado y disparamos busqueda
    // automaticamente para que la URL compartida funcione "en un click".
    await applyQueryState(st);
    try { await loadStations(); } catch(_) {}
  }
  // Ship 4: acciones rapidas desde Manifest shortcuts (?action=...).
  // Soportadas: geolocate (cerca de mi), route (abrir planificador), favs
  // (abrir modal favoritos), cheapest (sort por precio + primera provincia).
  // Se ejecuta despues del bootstrap para que todos los handlers esten
  // registrados. El delay es mas defensivo que necesario pero evita races
  // con initMap/loadProvincias.
  try {
    var action = new URLSearchParams(location.search).get('action');
    if (action) {
      setTimeout(function() {
        if (action === 'geolocate') {
          var btn = document.getElementById('btn-geolocate');
          if (btn) btn.click();
        } else if (action === 'route') {
          var btn = document.getElementById('btn-route');
          if (btn) btn.click();
        } else if (action === 'favs') {
          var btn = document.getElementById('btn-favs');
          if (btn) btn.click();
        } else if (action === 'cheapest') {
          // Ordena por precio y geolocaliza para contextualizar a la zona.
          var sel = document.getElementById('sel-orden');
          if (sel) { sel.value = 'asc'; sel.dispatchEvent(new Event('change')); }
          var gbtn = document.getElementById('btn-geolocate');
          if (gbtn) gbtn.click();
        }
      }, 300);
    }
  } catch (_) { /* no-op */ }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { bootApp(); });
} else {
  bootApp();
}

// Tras cada busqueda, escribimos la URL. Hookeamos en el boton Buscar.
(function() {
  var btn = document.getElementById('btn-buscar');
  if (btn) btn.addEventListener('click', function() {
    // writeQueryState se ejecuta en el siguiente microtask para no interferir
    // con el click handler original (loadStations).
    setTimeout(writeQueryState, 0);
  });
  // Filtros avanzados: al cambiar, reescribimos tambien.
  ['flt-abierto','flt-24h','sel-marca'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', function() { setTimeout(writeQueryState, 0); });
  });
})();

// ---- BOTON SHARE ----
// Usa Web Share API si esta disponible (movil) y cae a copiar-al-clipboard
// en escritorio. Primero nos aseguramos de que la URL refleja el estado actual.
(function() {
  var btn = document.getElementById('btn-share');
  if (!btn) return;
  btn.addEventListener('click', function() {
    writeQueryState();
    var url = location.href;
    var title = document.title;
    var text  = 'Precios de gasolineras actualizados';
    if (navigator.share) {
      navigator.share({ title: title, text: text, url: url }).catch(function(){});
      return;
    }
    // Fallback: copy to clipboard
    try {
      navigator.clipboard.writeText(url).then(function() {
        showToast('Enlace copiado al portapapeles', 'success');
      }).catch(function() {
        // Fallback del fallback: mostramos la URL en un prompt
        try { window.prompt('Copia este enlace:', url); } catch(_) {}
      });
    } catch(_) {
      try { window.prompt('Copia este enlace:', url); } catch(_) {}
    }
  });
})();

// Re-invalidar tamano al cambiar dimensiones de ventana
window.addEventListener('resize', function() { if (map) map.invalidateSize(true); });

// ---- DELEGACION DE CLICKS EN LA LISTA (evita onclick= inline para CSP estricto) ----
// Gestiona: click/enter en tarjeta (zoom) + click en boton favorito
(function() {
  var list = document.getElementById('station-list');
  if (!list) return;

  function handleCardActivation(target) {
    var favBtn = target.closest('.fav-btn');
    if (favBtn) {
      var id = favBtn.getAttribute('data-fav-id');
      var station = null;
      for (var i = 0; i < filteredStations.length; i++) {
        if (stationId(filteredStations[i]) === id) { station = filteredStations[i]; break; }
      }
      if (!station) return;
      var added = toggleFav(station);
      favBtn.classList.toggle('active', added);
      favBtn.textContent = added ? '\u2605' : '\u2606';
      favBtn.setAttribute('aria-pressed', String(added));
      favBtn.setAttribute('aria-label', added ? 'Quitar de favoritas' : 'A\u00f1adir a favoritas');
      showToast(added ? 'Guardada en favoritas \u2605' : 'Eliminada de favoritas', added ? 'success' : 'info');
      renderFavsPanel();
      return true;
    }
    var card = target.closest('[data-zoom]');
    if (!card) return false;
    var idx = parseInt(card.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) {
      // Clic en tarjeta cuenta como "visita" a efectos de historico.
      try {
        var st = filteredStations[idx];
        if (st) markVisited(stationId(st));
      } catch(_) {}
      zoomTo(idx);
    }
    return true;
  }

  list.addEventListener('click', function(e) { handleCardActivation(e.target); });
  // A11y: Enter/Space activa la tarjeta desde teclado
  list.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var card = e.target.closest ? e.target.closest('.station-card') : null;
    if (!card) return;
    e.preventDefault();
    handleCardActivation(card);
  });
})();

// ---- DELEGACION DE ACCIONES EN POPUPS (fav/share/copy) ----
document.addEventListener('click', function(e) {
  var t = e.target;
  if (!t || !t.closest) return;

  // Favorito en popup
  var favBtn = t.closest('[data-pop-fav]');
  if (favBtn) {
    var id = favBtn.getAttribute('data-pop-fav');
    var station = null;
    for (var i = 0; i < filteredStations.length; i++) {
      if (stationId(filteredStations[i]) === id) { station = filteredStations[i]; break; }
    }
    if (!station) return;
    var added = toggleFav(station);
    favBtn.textContent = added ? '\u2605 Favorita' : '\u2606 Guardar';
    favBtn.setAttribute('aria-pressed', String(added));
    showToast(added ? 'Guardada en favoritas \u2605' : 'Eliminada de favoritas', added ? 'success' : 'info');
    // Refrescar lista para actualizar icono tambien alli
    applyFilters();
    return;
  }

  // Compartir
  var shareBtn = t.closest('[data-pop-share]');
  if (shareBtn) {
    var popup = shareBtn.closest('.leaflet-popup-content');
    var title = popup ? (popup.querySelector('[style*="font-weight:800"]') || {}).textContent : '';
    var addr  = popup ? (popup.querySelector('[style*="opacity:0.75"]') || {}).textContent : '';
    var url = window.location.href;
    var textMsg = (title || 'Gasolinera') + ' - ' + (addr || '') + ' - ' + url;
    if (navigator.share) {
      navigator.share({ title: title || 'Gasolinera', text: textMsg, url: url }).catch(function(){});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(textMsg).then(function() {
        showToast('Enlace copiado al portapapeles', 'success');
      });
    } else {
      showToast('Tu navegador no permite compartir', 'warning');
    }
    return;
  }

  // Copiar direccion
  var copyBtn = t.closest('[data-pop-copy]');
  if (copyBtn) {
    var txt = copyBtn.getAttribute('data-pop-copy') || '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(function() {
        showToast('Direccion copiada', 'success');
      }).catch(function() { showToast('No se pudo copiar', 'error'); });
    } else {
      showToast('Tu navegador no permite copiar', 'warning');
    }
    return;
  }

  // Comparar (anadir/quitar + autoopen al llegar a 2)
  // Comportamiento:
  //  - 0 -> 1:  anade, muestra chip ambar. No abre modal (serviria de poco
  //            con una sola estacion).
  //  - 1 -> 2:  anade, muestra chip y ABRE el modal automaticamente —
  //            el usuario ya tiene un par valido para comparar.
  //  - click sobre la misma estacion cuando ya esta: quita (toggle).
  //  - 2 estaciones seleccionadas + click en una 3a: FIFO, echa la mas
  //    antigua y mete la nueva. No abre modal (el usuario ya esta
  //    "rotando", no iniciando comparacion).
  var cmpBtn = t.closest('[data-pop-compare]');
  if (cmpBtn) {
    var cmpId = cmpBtn.getAttribute('data-pop-compare');
    if (!cmpId) return;
    var beforeLen = compareIds.length;
    var result = toggleCompare(cmpId);
    // Actualizar el propio boton (dentro del popup abierto) para reflejar
    // el nuevo estado sin cerrar ni reabrir el popup.
    var nowIn = compareIds.indexOf(cmpId) !== -1;
    cmpBtn.setAttribute('aria-pressed', String(nowIn));
    cmpBtn.textContent = nowIn ? '\u2696\uFE0F En comparativa' : '\u2696\uFE0F Comparar';
    cmpBtn.setAttribute('aria-label', nowIn ? 'Quitar de comparativa' : 'A\u00f1adir a comparativa');
    if (result.action === 'added' && beforeLen === 1 && compareIds.length === 2) {
      openCompareModal();
    } else if (result.action === 'added') {
      showToast(compareIds.length === 1
        ? 'A\u00f1adida al comparador — elige otra'
        : 'Lista actualizada', 'info');
    } else {
      showToast('Quitada del comparador', 'info');
    }
    return;
  }

  // Toggle de rango del historial (7/30/90/1a). Delegado por el mismo
  // listener global — cada toggle lleva data-hist-range y el panel
  // contenedor tiene data-hist-station. Re-fetch ocurre en renderHistoryPanel.
  var rangeBtn = t.closest('[data-hist-range]');
  if (rangeBtn) {
    var panel = rangeBtn.closest('[data-hist-station]');
    if (panel) {
      var range = parseInt(rangeBtn.getAttribute('data-hist-range') || '30', 10);
      if (Number.isFinite(range) && range >= 1 && range <= 365) {
        renderHistoryPanel(panel, range);
      }
    }
    return;
  }
});

// ---- FAVORITOS: BOTON DE HEADER + MODAL ----
// La estrella del header es el unico acceso a favoritas. Abre un modal que
// contiene la lista de gasolineras guardadas. Click en una favorita ->
// cierra modal y navega en el mapa (setea provincia, carga municipios,
// setea municipio, pone el rotulo en la caja de busqueda y hace zoom).
// El modal se re-renderiza en cada apertura y tambien cuando cambia la
// lista (toggleFav). Para compatibilidad con el resto del codigo mantenemos
// el nombre renderFavsPanel() como alias de renderFavs() — asi no hay que
// tocar las llamadas ya existentes (markVisited, toggle de card, etc).

// Busca una estacion por id en allStations (provincia actual) y, si no esta,
// en cualquier cache gs_v2_* de localStorage. Devuelve { station, ts, stale }
// o null. Permite stale hasta 30 dias (CACHE_HARD_TTL en getCache) porque
// para el listado de favoritas "precio viejo con marca visual" es mas util
// que "sin datos". El precio del Ministerio cambia como mucho varias veces
// al dia, asi que un dato de hace 2h suele ser muy representativo.
function lookupStationInCaches(favId) {
  if (!favId) return null;
  // 1) Hot path: provincia que el usuario esta viendo ahora mismo.
  for (var i = 0; i < allStations.length; i++) {
    if (stationId(allStations[i]) === favId) {
      return { station: allStations[i], ts: Date.now(), stale: false };
    }
  }
  // 2) Otras provincias cacheadas en localStorage. Iteramos claves gs_v2_*.
  try {
    for (var k = 0; k < localStorage.length; k++) {
      var key = localStorage.key(k);
      if (!key || key.indexOf('gs_v2_') !== 0) continue;
      var raw = localStorage.getItem(key);
      if (!raw) continue;
      var parsed;
      try { parsed = JSON.parse(raw); } catch(_) { continue; }
      var data = parsed && parsed.data;
      var ts = parsed && parsed.ts;
      if (!Array.isArray(data) || !ts) continue;
      // Si es mayor que CACHE_HARD_TTL, getCache ya lo habria purgado en su
      // proxima llamada; aqui lo ignoramos tambien.
      if (Date.now() - ts > CACHE_HARD_TTL) continue;
      for (var j = 0; j < data.length; j++) {
        if (stationId(data[j]) === favId) {
          return { station: data[j], ts: ts, stale: Date.now() - ts > CACHE_FRESH_TTL };
        }
      }
    }
  } catch(_) {}
  return null;
}

// Set de provinciaIds que ya estamos pre-fetching ahora mismo (para no
// duplicar trabajo si el modal se re-renderiza mientras el fetch esta en
// vuelo). Tambien acumula las que fallaron para no reintentar en bucle.
var favsFetchInFlight = {};
var favsFetchFailed = {};

// Para cada favorita con provinciaId pero sin datos frescos en ningun cache,
// dispara un fetch a /api/estaciones/provincia/{id} en background. Cuando
// responde, guarda en cache y re-renderiza el modal (si sigue abierto). No
// bloquea el render inicial — el usuario ve "Sin datos" unos ms y luego
// aparece el precio. Deduplica por provinciaId para no hacer N fetches si
// tienes varias favs en la misma provincia.
function prefetchFavsPrices(favs) {
  var seen = {};
  for (var i = 0; i < favs.length; i++) {
    var f = favs[i];
    if (!f.provinciaId) continue;
    // Si ya tenemos cache fresco para esa provincia, saltamos.
    var cache = getCache(cacheKey(f.provinciaId, ''));
    if (cache && !cache.stale) continue;
    // Si ya esta en vuelo o fallo recientemente, saltamos.
    if (favsFetchInFlight[f.provinciaId]) continue;
    if (favsFetchFailed[f.provinciaId]) continue;
    seen[f.provinciaId] = true;
  }
  var provIds = Object.keys(seen);
  if (!provIds.length) return;
  // Disparamos en paralelo. Cap implicito = numero de provincias con favs,
  // raramente > 3. fetchJSON ya usa el service worker / red normal.
  provIds.forEach(function(pid) {
    favsFetchInFlight[pid] = true;
    fetchJSON('/api/estaciones/provincia/' + pid).then(function(data) {
      var stations = (data.ListaEESSPrecio || []).map(normalizeStation);
      setCache(cacheKey(pid, ''), stations, data.Fecha || '');
      // Re-render si el modal sigue abierto.
      var modal = document.getElementById('modal-favs');
      if (modal && modal.classList.contains('show')) renderFavsModalList();
    }).catch(function() {
      // Marcamos como fallida para no machacar el servidor. Se limpia en el
      // siguiente refresh de pagina (variable en memoria, no persiste).
      favsFetchFailed[pid] = true;
    }).then(function() {
      delete favsFetchInFlight[pid];
    });
  });
}

// Actualiza el boton estrella del header: color segun tiene/no favoritas,
// insignia numerica solo si hay >=1. Y, si el modal esta abierto, refresca.
function renderFavs() {
  var favs = getFavs();
  var btn = document.getElementById('btn-favs');
  var badge = document.getElementById('fav-badge');
  var icon = document.getElementById('btn-favs-icon');
  if (btn && badge && icon) {
    if (favs.length) {
      btn.classList.add('has-favs');
      icon.className = 'fas fa-star';
      badge.textContent = String(favs.length);
      badge.hidden = false;
    } else {
      btn.classList.remove('has-favs');
      icon.className = 'far fa-star';
      badge.hidden = true;
    }
  }
  // Si el modal esta abierto, refrescamos su lista en vivo.
  var modal = document.getElementById('modal-favs');
  if (modal && modal.classList.contains('show')) renderFavsModalList();
}
// Alias: renderFavsPanel es el nombre historico llamado desde toggle/handlers.
function renderFavsPanel() { renderFavs(); }

// Render de la lista de favoritas dentro del modal. Cada fila muestra rotulo
// + municipio + provincia y, si la gasolinera ya esta cargada en allStations,
// el precio actual (badge). El click navega al mapa via navigateToFav() —
// independientemente de la provincia que se esta viendo ahora mismo.
function renderFavsModalList() {
  var list = document.getElementById('favs-list');
  var empty = document.getElementById('favs-empty');
  var countEl = document.getElementById('favs-modal-count');
  if (!list || !empty) return;
  var favs = getFavs();
  if (countEl) countEl.textContent = String(favs.length);
  list.innerHTML = '';
  if (!favs.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  var fuel = document.getElementById('sel-combustible').value;
  // Disparamos prefetch de las provincias con favs sin datos en background
  // ANTES del render: asi si llega antes de que el usuario cierre el modal,
  // se re-renderiza automaticamente con precios frescos.
  prefetchFavsPrices(favs);
  favs.forEach(function(f) {
    // Busqueda global: allStations (provincia actual) + cualquier cache
    // localStorage gs_v2_* de otras provincias. Permite stale hasta 30d.
    var found = lookupStationInCaches(f.id);
    var live = found ? found.station : null;
    // Enriquecimiento oportunista: si la estacion esta disponible (en la
    // provincia actual o en otra cacheada) y la favorita es legacy,
    // completamos sus IDs silenciosamente para futuras navegaciones.
    if (live && (!f.provinciaId || !f.municipioId)) {
      enrichFav(f.id, {
        provinciaId: live['IDProvincia'] || '',
        municipioId: live['IDMunicipio'] || '',
        provincia:   live['Provincia']   || '',
        municipio:   live['Municipio']   || ''
      });
      if (!f.provinciaId) f.provinciaId = live['IDProvincia'] || '';
      if (!f.municipioId) f.municipioId = live['IDMunicipio'] || '';
      if (!f.provincia)   f.provincia   = live['Provincia']   || '';
      if (!f.municipio)   f.municipio   = live['Municipio']   || '';
    }
    var price = live ? parsePrice(live[fuel]) : null;
    // Si el precio viene de un cache stale (>4h pero <30d), lo marcamos con
    // el mismo icono de "atencion" que usa showCacheIndicator y con un
    // tooltip claro. Asi el usuario no asume que el precio es live.
    var ageHint = (found && found.stale) ? ' title="Precio guardado ' + formatAge(found.ts) + ' (pulsa para actualizar)"' : '';
    var stalePrefix = (found && found.stale) ? '\u26A0 ' : '';
    var priceHtml = price
      ? '<span class="fav-row-price badge badge-' + priceColor(price) + '"' + ageHint + '>' + stalePrefix + fmtPriceUnit(price) + '</span>'
      : '<span class="fav-row-sub fav-row-sub--small">Sin datos</span>';
    // Mostramos municipio (+ provincia si la conocemos) para que el usuario
    // entienda de un vistazo donde vive cada favorita.
    var loc = esc(f.municipio || '');
    if (f.provincia && f.provincia !== f.municipio) loc += (loc ? ', ' : '') + esc(f.provincia);
    var row = document.createElement('div');
    row.className = 'fav-row';
    row.innerHTML =
        '<div class="fav-row-info" role="button" tabindex="0" aria-label="Ver ' + esc(f.rotulo) + ' en el mapa">'
      + '  <div class="fav-row-title">\u2B50 ' + esc(f.rotulo) + '</div>'
      + '  <div class="fav-row-sub">\u{1F4CD} ' + loc + '</div>'
      + '</div>'
      + '<div>' + priceHtml + '</div>'
      + '<button class="fav-row-remove" data-remove-id="' + esc(f.id) + '" aria-label="Quitar de favoritas" title="Quitar"><i class="fas fa-trash" aria-hidden="true"></i></button>';
    // Click en info -> navegar a la favorita (setea provincia, municipio,
    // busqueda por rotulo y zoom). Funciona aunque actualmente estes viendo
    // otra provincia: navigateToFav carga lo que haga falta.
    var info = row.querySelector('.fav-row-info');
    if (info) {
      info.addEventListener('click', function() { navigateToFav(f); });
      info.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          navigateToFav(f);
        }
      });
    }
    // Click en quitar -> toggleFav + re-render.
    row.querySelector('.fav-row-remove').addEventListener('click', function() {
      // Necesitamos una "station-like" para toggleFav; reconstruimos la
      // minima informacion a partir del objeto favorito guardado.
      toggleFav({
        'IDEESS': f.id,
        'Rotulo': f.rotulo,
        'Municipio': f.municipio,
        'Direccion': f.direccion,
        'Latitud': String(f.lat),
        'Longitud (WGS84)': String(f.lng)
      });
      showToast('Eliminada de favoritas', 'info');
      renderFavs();
      // El boton de favorito dentro de la station-card (si esta en el DOM)
      // tambien tiene que sincronizarse.
      var cardBtn = document.querySelector('.fav-btn[data-fav-id="' + f.id + '"]');
      if (cardBtn) {
        cardBtn.classList.remove('active');
        cardBtn.textContent = '\u2606';
        cardBtn.setAttribute('aria-pressed', 'false');
        cardBtn.setAttribute('aria-label', 'A\u00f1adir a favoritas');
      }
    });
    list.appendChild(row);
  });
}

// Mapa manual de nombre -> codigo INE. Nominatim devuelve a veces el nombre
// en castellano y nuestro dropdown en el idioma cooficial (Bizkaia/Vizcaya,
// Gipuzkoa/Guipuzcoa, A Coruna/La Coruna, Ourense/Orense, Illes Balears/
// Baleares). Esta tabla ancla los casos donde el match por 'includes' sobre
// SPAIN_PROVINCIAS podria fallar. Las claves estan ya normalizadas
// (normStr: minusculas, sin acentos, sin signos).
var PROV_NAME_TO_ID = {
  'vizcaya': '48', 'bizkaia': '48',
  'guipuzcoa': '20', 'gipuzkoa': '20',
  'alava': '01', 'araba': '01',
  'la coruna': '15', 'a coruna': '15', 'coruna': '15',
  'orense': '32', 'ourense': '32',
  'gerona': '17', 'girona': '17',
  'lerida': '25', 'lleida': '25',
  'baleares': '07', 'islas baleares': '07', 'illes balears': '07',
  'palmas': '35', 'las palmas': '35',
  'tenerife': '38', 'santa cruz de tenerife': '38',
  'navarra': '31', 'nafarroa': '31',
  'castellon': '12', 'castello': '12'
};

// Resuelve un nombre de provincia (puede venir de Nominatim con acentos,
// en castellano, en euskera...) a su codigo INE de 2 digitos. Usa la tabla
// de aliases primero y luego recorre SPAIN_PROVINCIAS con match por
// inclusion bidireccional. Reutiliza normStr() (ya definida arriba) para
// normalizar ambos lados con el mismo criterio que el resto del cliente.
function provinciaIdByName(name) {
  var n = normStr(name);
  if (!n) return '';
  if (PROV_NAME_TO_ID[n]) return PROV_NAME_TO_ID[n];
  for (var i = 0; i < SPAIN_PROVINCIAS.length; i++) {
    var candidate = normStr(SPAIN_PROVINCIAS[i].Provincia);
    if (candidate === n || candidate.includes(n) || n.includes(candidate)) {
      return SPAIN_PROVINCIAS[i].IDPovincia;
    }
  }
  return '';
}

// Para favoritas legacy (guardadas antes de v1.6.1, sin provinciaId) hacemos
// reverse geocode con Nominatim usando las coordenadas que ya tenemos.
// Devuelve el primer nombre no vacio en el orden que mejor funciona para
// direcciones espanolas (el mismo que ya usa el flujo /btn-geolocate):
// state_district > county > province > state. Si el servicio no responde
// o no hay provincia reconocible, devolvemos ''. El mapeo a codigo INE lo
// hace provinciaIdByName() a continuacion.
async function reverseProvinciaFromLatLng(lat, lng) {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return '';
  try {
    // Va por /api/geocode/reverse → no exponemos la IP del usuario a OSM.
    var url = '/api/geocode/reverse?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng);
    var r = await fetch(url);
    if (!r.ok) return '';
    var data = await r.json();
    var addr = data && data.address || {};
    return addr.state_district || addr.county || addr.province || addr.state || '';
  } catch (_) { return ''; }
}

// Persiste campos enriquecidos en una favorita concreta (por id) sin
// duplicar la entrada. Devuelve true si hubo cambios.
function enrichFav(id, patch) {
  if (!id || !patch) return false;
  var favs = getFavs();
  var changed = false;
  for (var i = 0; i < favs.length; i++) {
    if (favs[i].id !== id) continue;
    for (var k in patch) {
      if (!favs[i][k] && patch[k]) { favs[i][k] = patch[k]; changed = true; }
    }
    break;
  }
  if (changed) setFavs(favs);
  return changed;
}

// Borra los campos de provincia/municipio previamente cacheados en una
// favorita. Se usa cuando descubrimos que eran incorrectos (p.ej. reverse
// geocode devolvio mal la provincia: Nominatim puede devolver la provincia
// mas cercana si el lat/lng cae en un limite administrativo raro). Forzar
// clear permite que el siguiente navigateToFav los vuelva a resolver de cero.
function clearFavProvinceHints(id) {
  if (!id) return;
  var favs = getFavs();
  var changed = false;
  for (var i = 0; i < favs.length; i++) {
    if (favs[i].id !== id) continue;
    if (favs[i].provinciaId || favs[i].municipioId || favs[i].provincia || favs[i].municipio) {
      delete favs[i].provinciaId;
      delete favs[i].municipioId;
      delete favs[i].provincia;
      delete favs[i].municipio;
      changed = true;
    }
    break;
  }
  if (changed) setFavs(favs);
}

// Navega el mapa+sidebar hasta la favorita indicada:
//   1. Cierra el modal.
//   2. Si tenemos provinciaId: fija el select de provincia, carga municipios,
//      fija el select de municipio, rellena la caja "Buscar gasolinera" con
//      el rotulo y dispara loadStations() + applyFilters() — asi el unico
//      resultado visible es la favorita.
//   3. Hace zoom y abre su popup.
// Si la favorita es legacy (sin provinciaId): intentamos resolver la
// provincia con reverse geocoding de Nominatim sobre sus coordenadas, la
// persistimos en localStorage y seguimos con el flujo normal. Asi el
// usuario no tiene que re-guardar nada.
async function navigateToFav(f) {
  closeFavsModal();
  var selProv = document.getElementById('sel-provincia');
  var selMun  = document.getElementById('sel-municipio');
  var inText  = document.getElementById('search-text');

  // Clicar una favorita es un cambio de contexto explicito: olvidamos la
  // GPS anterior (si el usuario habia pulsado "Mi ubicacion" antes en
  // otra provincia, applyFilters despues filtraba por radio contra esas
  // coords viejas y dejaba 0 resultados aunque cargaramos la provincia
  // correcta).
  clearGeolocationMode();

  // Paso 0: centrar el mapa INMEDIATAMENTE sobre la ubicacion real de la
  // favorita. Esto desacopla el feedback visual (siempre funciona si
  // guardamos lat/lng) de la resolucion de provincia (que puede fallar o
  // devolver dato equivocado). Si luego todo va bien, zoomTo() refinara el
  // zoom y abrira el popup.
  var favLat = parseFloat(f.lat);
  var favLng = parseFloat(f.lng);
  var haveFavCoords = !isNaN(favLat) && !isNaN(favLng) && (favLat !== 0 || favLng !== 0);
  if (haveFavCoords) {
    try { map.setView([favLat, favLng], 15); } catch(_) {}
  }

  // --- Resolver provinciaId para favoritas legacy ---
  if (!f.provinciaId) {
    // Atajo 1: si esta en allStations (la provincia actual), cogemos los
    // IDs de ahi sin llamar a Nominatim.
    for (var q = 0; q < allStations.length; q++) {
      if (stationId(allStations[q]) === f.id) {
        var s = allStations[q];
        var pid = s['IDProvincia'] || '';
        var mid = s['IDMunicipio'] || '';
        var pname = s['Provincia'] || '';
        if (pid) {
          enrichFav(f.id, { provinciaId: pid, municipioId: mid, provincia: pname });
          f.provinciaId = pid; f.municipioId = mid; f.provincia = pname;
        }
        break;
      }
    }
  }
  if (!f.provinciaId) {
    // Atajo 2: reverse geocode por lat/lng y mapear nombre -> codigo INE.
    showToast('Resolviendo ubicacion de la favorita\u2026', 'info');
    var provName = await reverseProvinciaFromLatLng(favLat, favLng);
    var provId = provName ? provinciaIdByName(provName) : '';
    if (provId) {
      enrichFav(f.id, { provinciaId: provId, provincia: provName });
      f.provinciaId = provId;
      f.provincia = provName;
    }
  }
  if (!f.provinciaId) {
    // Sin provinciaId: si el mapa ya esta centrado en la favorita (paso 0),
    // al menos el usuario la ve. Quitamos el search text (para no mentir
    // con "Sin resultados") y damos un toast explicativo.
    if (inText) inText.value = '';
    applyFilters();
    if (haveFavCoords) {
      showToast('No pudimos resolver la provincia. Seleccionala manualmente — el mapa ya esta centrado en la favorita.', 'warning');
    } else {
      showToast('No hemos podido ubicar esta favorita. Quitala y guardala otra vez.', 'warning');
    }
    return;
  }

  // Helper interno: carga las estaciones del provinciaId actual y devuelve
  // si la favorita aparece en allStations. Evita repetir el bloque en el
  // primer intento + el reintento de self-healing.
  async function loadAndCheck() {
    if (selProv) selProv.value = f.provinciaId;
    try { await loadMunicipios(f.provinciaId); } catch(_) {}
    if (selMun && f.municipioId) {
      var hasOpt = false;
      for (var o = 0; o < selMun.options.length; o++) {
        if (selMun.options[o].value === f.municipioId) { hasOpt = true; break; }
      }
      selMun.value = hasOpt ? f.municipioId : '';
    } else if (selMun) {
      selMun.value = '';
    }
    try { await loadStations(); } catch(_) {}
    for (var p = 0; p < allStations.length; p++) {
      if (stationId(allStations[p]) === f.id) return true;
    }
    return false;
  }

  // --- A partir de aqui tenemos provinciaId (posiblemente incorrecto de un
  // reverse anterior). Cargamos; si el fav NO aparece, lo tratamos como
  // provinciaId corrupto, lo borramos y reintentamos con reverse fresco.
  if (inText) inText.value = f.rotulo || '';
  var found = await loadAndCheck();

  if (!found && haveFavCoords) {
    // Self-heal: la provinciaId cacheada es incorrecta. La borramos y
    // pedimos un reverse geocode nuevo. Si la API devuelve una provincia
    // distinta, reintentamos loadStations sobre esa.
    var oldProvId = f.provinciaId;
    clearFavProvinceHints(f.id);
    f.provinciaId = '';
    f.municipioId = '';
    showToast('Re-resolviendo ubicacion de la favorita\u2026', 'info');
    var provName2 = await reverseProvinciaFromLatLng(favLat, favLng);
    var provId2 = provName2 ? provinciaIdByName(provName2) : '';
    if (provId2 && provId2 !== oldProvId) {
      enrichFav(f.id, { provinciaId: provId2, provincia: provName2 });
      f.provinciaId = provId2;
      f.provincia = provName2;
      found = await loadAndCheck();
    }
  }

  if (!found) {
    // Ni con self-heal sale. Quitamos el filtro de texto (para que el
    // usuario pueda mirar las de la provincia actual si ya esta), avisamos,
    // y dejamos el mapa centrado en la favorita como hicimos en paso 0.
    if (inText) inText.value = '';
    applyFilters();
    showToast('No encontramos "' + (f.rotulo || 'esta favorita') + '" en los datos actuales. El mapa esta centrado en su ubicacion.', 'warning');
    return;
  }

  // Enriquecer la favorita con los IDs correctos ahora que sabemos que
  // aparece en allStations (caso legacy donde solo teniamos provincia por
  // reverse — ahora tambien capturamos municipio).
  for (var p2 = 0; p2 < allStations.length; p2++) {
    if (stationId(allStations[p2]) === f.id) {
      var st2 = allStations[p2];
      enrichFav(f.id, {
        provinciaId: st2['IDProvincia'] || '',
        municipioId: st2['IDMunicipio'] || '',
        provincia:   st2['Provincia']   || '',
        municipio:   st2['Municipio']   || ''
      });
      break;
    }
  }

  // Buscar la estacion en el resultado filtrado y hacer zoom. Si el filtro
  // de combustible/avanzados la escondio del listado, applyFilters ya ha
  // corrido desde loadStations — pero la favorita SI esta en allStations.
  for (var i = 0; i < filteredStations.length; i++) {
    if (stationId(filteredStations[i]) === f.id) { zoomTo(i); return; }
  }
  showToast('Esa gasolinera existe pero esta oculta por los filtros avanzados', 'info');
}

function openFavsModal() {
  var modal = document.getElementById('modal-favs');
  if (!modal) return;
  renderFavsModalList();
  modal.classList.add('show');
}
function closeFavsModal() {
  var modal = document.getElementById('modal-favs');
  if (modal) modal.classList.remove('show');
}

// ---- WIDGET DE GASTO MENSUAL ----
function updateMonthlyWidget() {
  var prof = getProfile();
  var widget = document.getElementById('monthly-widget');
  if (!prof || !prof.km || !prof.consumo || !currentMedianPrice) {
    widget.classList.remove('show');
    return;
  }
  var litros = (prof.km / 100) * prof.consumo;
  var cost = litros * currentMedianPrice;
  document.getElementById('mw-cost').textContent = cost.toFixed(0) + ' \u20AC / mes';
  // Calcular ahorro potencial si reposta en el top 3
  var tank = parseInt(localStorage.getItem('gs_tank') || '50', 10);
  var repostajes = Math.ceil(litros / tank);
  var topPrice = null;
  for (var id in topCheapIds) { if (topCheapIds[id] === 1) {
    for (var i = 0; i < filteredStations.length; i++) {
      if (stationId(filteredStations[i]) === id) {
        topPrice = parsePrice(filteredStations[i][document.getElementById('sel-combustible').value]);
        break;
      }
    }
  }}
  var saving = topPrice ? (currentMedianPrice - topPrice) * litros : 0;
  document.getElementById('mw-sub').textContent = saving > 1
    ? 'Ahorro potencial: ' + saving.toFixed(0) + ' \u20AC/mes (' + repostajes + ' repostajes)'
    : repostajes + ' repostajes/mes aprox';
  widget.classList.add('show');
}

// ---- ONBOARDING / PERFIL ----
(function() {
  var modal = document.getElementById('modal-profile');
  var chipsFuel = document.getElementById('chips-fuel');
  var chipsKm   = document.getElementById('chips-km');
  var inCons    = document.getElementById('in-consumo');
  var lblCons   = document.getElementById('lbl-consumo');
  var inTankM   = document.getElementById('in-tank-modal');
  var lblTankM  = document.getElementById('lbl-tank-modal');
  var inAuto    = document.getElementById('in-autonomy');

  // Autonomia es un campo INDEPENDIENTE. tmpProfile.autonomy se setea una
  // vez (como default al abrir el modal: deposito/consumo*100) y a partir
  // de ahi solo cambia si el usuario lo edita. Cambiar deposito o consumo
  // NO lo mueve — el usuario ya declaro un valor fijo.
  var tmpProfile = { fuel: '', km: 0, consumo: 6.5, tank: 50, autonomy: 0, strictFuel: true };

  // Autonomia por defecto: si el perfil aun no tiene autonomy guardada, la
  // derivamos de tank+cons para dar un valor de partida razonable. Si ya
  // existe (el usuario la guardo antes), la respetamos tal cual.
  function deriveDefaultAutonomy(cur) {
    var t = (typeof cur.tank === 'number' && cur.tank > 0) ? cur.tank : 50;
    var c = (typeof cur.consumo === 'number' && cur.consumo > 0) ? cur.consumo : 6.5;
    return Math.round((t / c) * 100);
  }

  function openModal() {
    var cur = getProfile() || {};
    // Autonomia: si el perfil ya tiene un valor guardado (>0), lo usamos;
    // si no, la derivamos de tank/cons UNA SOLA VEZ como default inicial.
    // A partir de ese momento vive independiente.
    var savedAuto = (typeof cur.autonomy === 'number' && cur.autonomy > 0) ? cur.autonomy : 0;
    tmpProfile = {
      fuel: cur.fuel || '',
      km: cur.km || 0,
      consumo: cur.consumo || 6.5,
      tank: cur.tank || 50,
      autonomy: savedAuto || deriveDefaultAutonomy(cur),
      strictFuel: cur.strictFuel !== false
    };
    Array.prototype.forEach.call(chipsFuel.querySelectorAll('.chip'), function(c) {
      c.classList.toggle('selected', c.getAttribute('data-fuel') === tmpProfile.fuel);
      c.setAttribute('aria-checked', String(c.getAttribute('data-fuel') === tmpProfile.fuel));
    });
    Array.prototype.forEach.call(chipsKm.querySelectorAll('.chip'), function(c) {
      c.classList.toggle('selected', parseInt(c.getAttribute('data-km'),10) === tmpProfile.km);
      c.setAttribute('aria-checked', String(parseInt(c.getAttribute('data-km'),10) === tmpProfile.km));
    });
    inCons.value = tmpProfile.consumo;
    lblCons.textContent = tmpProfile.consumo.toString().replace('.', ',') + ' L';
    inTankM.value = tmpProfile.tank;
    lblTankM.textContent = tmpProfile.tank + ' L';
    if (inAuto) inAuto.value = String(tmpProfile.autonomy);
    modal.classList.add('show');
  }
  function closeModal() { modal.classList.remove('show'); }

  chipsFuel.addEventListener('click', function(e) {
    var c = e.target.closest('.chip'); if (!c) return;
    tmpProfile.fuel = c.getAttribute('data-fuel');
    Array.prototype.forEach.call(chipsFuel.querySelectorAll('.chip'), function(x) {
      var sel = x === c;
      x.classList.toggle('selected', sel);
      x.setAttribute('aria-checked', String(sel));
    });
  });
  chipsKm.addEventListener('click', function(e) {
    var c = e.target.closest('.chip'); if (!c) return;
    tmpProfile.km = parseInt(c.getAttribute('data-km'), 10);
    Array.prototype.forEach.call(chipsKm.querySelectorAll('.chip'), function(x) {
      var sel = x === c;
      x.classList.toggle('selected', sel);
      x.setAttribute('aria-checked', String(sel));
    });
  });
  // Los sliders de consumo y deposito ya NO tocan la autonomia: son campos
  // independientes. La autonomia es un dato que el usuario declara (y que
  // domina en el planificador de rutas).
  inCons.addEventListener('input', function() {
    tmpProfile.consumo = parseFloat(inCons.value);
    lblCons.textContent = tmpProfile.consumo.toString().replace('.', ',') + ' L';
  });
  inTankM.addEventListener('input', function() {
    tmpProfile.tank = parseInt(inTankM.value, 10);
    lblTankM.textContent = tmpProfile.tank + ' L';
  });

  // Autonomia independiente: el usuario la fija y se queda fija. Solo
  // validamos el rango [50, 2000] para evitar valores absurdos (y para
  // que el planificador de rutas no se rompa). Listener en 'change' (no
  // 'input') para no pelearse con cada tecla intermedia.
  if (inAuto) {
    inAuto.addEventListener('change', function() {
      var km = parseInt(inAuto.value, 10);
      if (!isFinite(km) || km <= 0) {
        // Valor invalido: restauramos lo que habia.
        inAuto.value = String(tmpProfile.autonomy);
        return;
      }
      if (km < 50) km = 50;
      if (km > 2000) km = 2000;
      tmpProfile.autonomy = km;
      inAuto.value = String(km);
    });
  }

  document.getElementById('btn-profile-save').addEventListener('click', function() {
    // Lectura defensiva de autonomia justo antes de guardar: algunos moviles
    // / navegadores no disparan 'change' cuando el usuario teclea un valor y
    // pulsa directamente "Guardar". Si confiamos solo en tmpProfile podemos
    // persistir el default derivado en vez del valor tecleado. Leemos el
    // input directo como ultima palabra.
    if (inAuto) {
      var kmNow = parseInt(inAuto.value, 10);
      if (isFinite(kmNow) && kmNow > 0) {
        if (kmNow < 50) kmNow = 50;
        if (kmNow > 2000) kmNow = 2000;
        tmpProfile.autonomy = kmNow;
      }
    }
    // Defensa extra: coercion a numero por si algun flujo antiguo dejo string.
    if (typeof tmpProfile.autonomy !== 'number' || !isFinite(tmpProfile.autonomy)) {
      tmpProfile.autonomy = parseInt(String(tmpProfile.autonomy), 10) || 0;
    }
    setProfile(tmpProfile);
    try { localStorage.setItem('gs_tank', String(tmpProfile.tank)); } catch(e) {}
    // Sincronizar combustible y slider deposito del sidebar
    if (tmpProfile.fuel) document.getElementById('sel-combustible').value = tmpProfile.fuel;
    var tankInp = document.getElementById('in-tank');
    if (tankInp) { tankInp.value = tmpProfile.tank; document.getElementById('lbl-tank').textContent = tmpProfile.tank + ' L'; }
    document.getElementById('btn-profile-label').textContent = 'Mi perfil \u{1F464}';
    closeModal();
    if (allStations.length) applyFilters();
    showToast('Perfil guardado \u2713', 'success');
  });
  document.getElementById('btn-profile-skip').addEventListener('click', closeModal);
  document.getElementById('btn-profile').addEventListener('click', openModal);

  // Cerrar con Escape o click en backdrop
  modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeModal();
  });

  // Auto-abrir la primera vez
  if (!getProfile() && !localStorage.getItem('gs_onboarded')) {
    setTimeout(function() {
      openModal();
      try { localStorage.setItem('gs_onboarded', '1'); } catch(e) {}
    }, 900);
  } else if (getProfile()) {
    document.getElementById('btn-profile-label').textContent = 'Mi perfil \u{1F464}';
    var p = getProfile();
    if (p.fuel) {
      // Espera a que el select este listo
      setTimeout(function() {
        var sel = document.getElementById('sel-combustible');
        if (sel) sel.value = p.fuel;
      }, 50);
    }
    if (p.tank) {
      try { localStorage.setItem('gs_tank', String(p.tank)); } catch(e) {}
      var tankInp2 = document.getElementById('in-tank');
      if (tankInp2) { tankInp2.value = p.tank; document.getElementById('lbl-tank').textContent = p.tank + ' L'; }
    }
  }
})();

// ---- SLIDER DE DEPOSITO Y RADIO ----
(function() {
  var inTank = document.getElementById('in-tank');
  var lblTank = document.getElementById('lbl-tank');
  var saved = parseInt(localStorage.getItem('gs_tank') || '50', 10);
  inTank.value = saved;
  lblTank.textContent = saved + ' L';
  inTank.addEventListener('input', function() {
    lblTank.textContent = inTank.value + ' L';
    try { localStorage.setItem('gs_tank', inTank.value); } catch(e) {}
    if (allStations.length) renderList(filteredStations);
  });

  var inRad = document.getElementById('in-radius');
  var lblRad = document.getElementById('lbl-radius');
  inRad.addEventListener('input', function() {
    lblRad.textContent = inRad.value + ' km';
    if (userPos && allStations.length) applyFilters();
  });
})();

// Toggle €/centimos retirado: precios siempre se muestran en €/L para evitar
// que los usuarios despistados comparen mentalmente 1.449 con 144.9.

// ---- BANNER OFFLINE ----
(function() {
  var banner = document.getElementById('offline-banner');
  function update() {
    if (navigator.onLine) banner.classList.remove('show');
    else banner.classList.add('show');
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
})();

// ---- ATAJOS DE TECLADO ----
// /  -> foco en buscador
// g  -> geolocalizar
// d  -> dark/light
// Los atajos se ignoran si el usuario esta escribiendo en un input/textarea.
document.addEventListener('keydown', function(e) {
  var tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') {
    e.preventDefault();
    document.getElementById('search-text').focus();
  } else if (e.key === 'g' || e.key === 'G') {
    document.getElementById('btn-geolocate').click();
  } else if (e.key === 'd' || e.key === 'D') {
    document.getElementById('btn-dark').click();
  } else if (e.key === '?') {
    showToast('Atajos: / buscar \u00B7 g ubicacion \u00B7 d tema', 'info');
  }
});

// ---- APP BADGE (PWA): numero de favoritas con precio al minimo de la zona ----
(function() {
  if (!('setAppBadge' in navigator)) return;
  try {
    var fav = getFavs().length;
    if (fav) navigator.setAppBadge(fav).catch(function(){});
  } catch(e) {}
})();

// ---- HANDLERS DEL MODAL DE FAVORITAS ----
// Modal accesible desde la estrella del header. Solo renderiza la lista —
// el click en una fila dispara navigateToFav() (ver arriba) y el user
// acaba con esa gasolinera unica visible en el mapa. Las alertas
// (navegador/email) se dejaron fuera de este release para mantener la UI
// centrada en "ver mis favoritas".
(function() {
  var modal = document.getElementById('modal-favs');
  if (!modal) return;
  var btnOpen   = document.getElementById('btn-favs');
  var btnClose  = document.getElementById('btn-favs-close');
  var btnDone   = document.getElementById('btn-favs-done');

  if (btnOpen)  btnOpen.addEventListener('click', openFavsModal);
  if (btnClose) btnClose.addEventListener('click', closeFavsModal);
  if (btnDone)  btnDone.addEventListener('click', closeFavsModal);
  // Cerrar con click en backdrop o Escape.
  modal.addEventListener('click', function(e) { if (e.target === modal) closeFavsModal(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeFavsModal();
  });

  // Render inicial de la estrella (color + insignia) antes de que se carguen
  // las gasolineras — asi el boton ya refleja las favoritas persistidas.
  renderFavs();
})();

// ---- SERVICE WORKER (PWA) ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  });
}
`
